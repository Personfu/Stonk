// A research signal, never an order instruction. All market data stays on the server.
// The IEX feed covers one venue; a paid SIP subscription is needed for consolidated live data.
const SNAPSHOT_DOCS = "https://docs.alpaca.markets/us/reference/stocksnapshotsingle";
const HISTORY_DOCS = "https://docs.alpaca.markets/us/v1.4.2/reference/stockbarsingle-1";
const SESSION_DOCS = "https://www.nyse.com/trade/hours-calendars";
const REFRESH_MS = 60_000;
const MAX_BAR_AGE_MS = 180_000;
const MAX_QUOTE_AGE_MS = 180_000;
const cache = new Map();
// NYSE-published full-day holidays and early equity closes, checked 2026-09-29.
// Fail closed outside verified calendar years rather than assume a holiday is open.
const CLOSED_DATES = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
  "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31",
  "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
  "2028-01-17", "2028-02-21", "2028-04-14", "2028-05-29", "2028-06-19",
  "2028-07-04", "2028-09-04", "2028-11-23", "2028-12-25",
]);
const EARLY_CLOSE_DATES = new Set([
  "2026-11-27", "2026-12-24", "2027-11-26", "2028-07-03", "2028-11-24",
]);
const easternClock = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

function marketSession(timestamp) {
  const parts = Object.fromEntries(easternClock.formatToParts(timestamp).map(({ type, value }) => [type, value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  const closeMinute = EARLY_CLOSE_DATES.has(date) ? 13 * 60 : 16 * 60;
  const current = new Date(timestamp);
  const untilCloseMs = (closeMinute - minute) * 60_000 -
    current.getUTCSeconds() * 1_000 - current.getUTCMilliseconds();
  const reason = !["2026", "2027", "2028"].includes(parts.year) ?
    `Exchange holiday calendar for ${parts.year} is unverified; directional signals are paused.` :
    `Regular U.S. equity session is closed; see the NYSE trading calendar (${SESSION_DOCS}).`;
  return {
    open: ["2026", "2027", "2028"].includes(parts.year) &&
      !["Sat", "Sun"].includes(parts.weekday) && !CLOSED_DATES.has(date) &&
      minute >= 9 * 60 + 30 && minute < closeMinute,
    date,
    time: `${parts.hour}:${parts.minute}`,
    earlyClose: EARLY_CLOSE_DATES.has(date),
    closesAt: new Date(Number(timestamp) + untilCloseMs).toISOString(),
    reason,
  };
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pct(numerator, denominator) {
  return denominator > 0 ? 100 * numerator / denominator : null;
}

function age(timestamp, now) {
  const parsed = Date.parse(timestamp || "");
  if (!Number.isFinite(parsed)) return null;
  return now - parsed;
}

function observedScenario(observedPriceMovePct, spreadBps) {
  // Crossing the current spread once plus 10 bps of assumed slippage each side.
  // This is a retrospective sensitivity calculation, not a future return estimate.
  const assumedRoundTripCostPct = (spreadBps + 20) / 100;
  return {
    observedPriceMovePct,
    assumedRoundTripCostPct,
    observedLongAfterCostPct: observedPriceMovePct - assumedRoundTripCostPct,
    observedShortAfterCostPct: -observedPriceMovePct - assumedRoundTripCostPct,
    estimatedFutureNetReturnPct: null,
    description: "Observed past long and short moves after current spread and assumed 10 bps slippage per side; excludes fees, taxes, market impact, short borrow costs, and account P&L.",
  };
}

function unavailable(ticker, reason, now, feed = null, status = "unavailable") {
  return {
    ticker,
    status,
    recommendation: null,
    score: null,
    confidence: null,
    metrics: null,
    asOf: null,
    validUntil: null,
    source: { name: "Alpaca Market Data", url: SNAPSHOT_DOCS, feed },
    reasons: [reason],
    scenario: null,
    refreshedAt: new Date(now).toISOString(),
    nextRefreshAt: new Date(now + REFRESH_MS).toISOString(),
    refreshIntervalMs: REFRESH_MS,
  };
}

function scoreSnapshot(ticker, snapshot, { now = Date.now(), feed = "iex" } = {}) {
  if (!snapshot || typeof snapshot !== "object") {
    return unavailable(ticker, "No market snapshot was returned.", now, feed);
  }
  const bar = snapshot.minuteBar;
  const quote = snapshot.latestQuote;
  const day = snapshot.dailyBar;
  const previous = snapshot.prevDailyBar;
  const barAge = age(bar?.t, now);
  const quoteAge = age(quote?.t, now);
  const dayAge = age(day?.t, now);
  if (barAge === null || quoteAge === null || dayAge === null || !previous) {
    return unavailable(ticker, "A current minute bar, quote, and daily comparison are required.", now, feed);
  }
  if (feed === "delayed_sip" || barAge >= MAX_BAR_AGE_MS || quoteAge >= MAX_QUOTE_AGE_MS ||
      dayAge > 36 * 3_600_000 || barAge < -30_000 || quoteAge < -30_000 || dayAge < -30_000) {
    const result = unavailable(ticker, "Market data is delayed or stale; the signal is paused.", now, feed, "stale");
    result.asOf = bar.t;
    return result;
  }
  const session = marketSession(now);
  if (!session.open || !marketSession(Date.parse(bar.t)).open || !marketSession(Date.parse(quote.t)).open) {
    const result = unavailable(ticker, session.open ?
      "The latest minute bar or quote is outside the regular U.S. equity session." : session.reason,
      now, feed, "closed");
    result.asOf = bar.t;
    result.quoteAsOf = quote.t;
    return result;
  }
  const close = finite(bar.c);
  const open = finite(bar.o);
  const minuteVolume = finite(bar.v);
  const priorClose = finite(previous.c);
  const dayHigh = finite(day.h);
  const dayLow = finite(day.l);
  const bid = finite(quote.bp);
  const ask = finite(quote.ap);
  if (!(close > 0 && open > 0 && minuteVolume >= 0 && priorClose > 0 &&
      dayHigh > 0 && dayLow > 0 && dayHigh >= dayLow && bid > 0 && ask >= bid)) {
    return unavailable(ticker, "Market snapshot contains missing or inconsistent prices.", now, feed);
  }
  const changePct = pct(close - priorClose, priorClose);
  const momentumPct = pct(close - open, open);
  const rangePosition = dayHigh === dayLow ? 0.5 : Math.max(0, Math.min(1, (close - dayLow) / (dayHigh - dayLow)));
  const spreadBps = 10_000 * (ask - bid) / ((ask + bid) / 2);
  const scenario = observedScenario(momentumPct, spreadBps);
  const minuteDollarVolume = close * minuteVolume;
  const liquidityOk = minuteDollarVolume >= 50_000;
  const spreadOk = spreadBps <= 25;
  const direction = (changePct >= 0.4 ? 1 : changePct <= -0.4 ? -1 : 0) +
    (momentumPct >= 0.04 ? 1 : momentumPct <= -0.04 ? -1 : 0) +
    (rangePosition >= 0.7 ? 1 : rangePosition <= 0.3 ? -1 : 0);
  const recommendation = liquidityOk && spreadOk && close >= 1 && direction === 3 &&
    scenario.observedLongAfterCostPct >= 0.1 ? "buy" :
    liquidityOk && spreadOk && close >= 1 && direction === -3 &&
    scenario.observedShortAfterCostPct >= 0.1 ? "sell" : "watch";
  const reasons = [
    `Day change ${changePct.toFixed(2)}% against the previous close.`,
    `Latest minute movement ${momentumPct.toFixed(2)}%; price is ${Math.round(rangePosition * 100)}% through the day's range.`,
    `Minute dollar volume $${Math.round(minuteDollarVolume).toLocaleString("en-US")}; spread ${spreadBps.toFixed(1)} bps.`,
  ];
  if (!liquidityOk) reasons.push("Thin volume: the setup does not pass the liquidity gate.");
  if (!spreadOk) reasons.push("Wide spread: the setup does not pass the execution-cost gate.");
  if (close < 1) reasons.push("Sub-$1 stock: the price-risk gate blocks a directional setup.");
  if (feed === "iex") reasons.push("IEX is a single venue; these figures are not consolidated market totals.");
  reasons.push("Heuristic only: expected net profit and order size require account, fees, and execution data.");
  const validUntil = new Date(Math.min(Date.parse(bar.t) + MAX_BAR_AGE_MS,
    Date.parse(quote.t) + MAX_QUOTE_AGE_MS, Date.parse(session.closesAt))).toISOString();
  return {
    ticker,
    status: "ready",
    recommendation,
    score: Math.min(95, Math.max(5, 50 + direction * 15)),
    confidence: feed === "sip" ? "moderate" : "low",
    metrics: {
      lastPrice: close,
      changePct,
      momentumPct,
      minuteVolume,
      minuteDollarVolume,
      rangePosition,
      spreadBps,
      bid,
      ask,
      netProfit: null,
    },
    asOf: bar.t,
    quoteAsOf: quote.t,
    validUntil,
    source: { name: "Alpaca Market Data", url: SNAPSHOT_DOCS, feed },
    reasons,
    scenario,
    refreshedAt: new Date(now).toISOString(),
    nextRefreshAt: new Date(now + REFRESH_MS).toISOString(),
    refreshIntervalMs: REFRESH_MS,
  };
}

function weekUnavailable(intraday, reason, status = "unavailable") {
  return {
    label: "Five-session trend",
    status,
    recommendation: null,
    score: null,
    confidence: null,
    metrics: null,
    asOf: intraday.asOf,
    validUntil: null,
    historyThrough: null,
    source: { name: "Alpaca Market Data", url: HISTORY_DOCS, feed: intraday.source?.feed || null },
    reasons: [reason],
    scenario: null,
  };
}

function scoreOneWeek(ticker, bars, snapshot, intraday, { now = Date.now(), feed = "iex" } = {}) {
  if (intraday.status !== "ready") {
    return weekUnavailable(intraday, "Current market data is required for a five-session signal.", intraday.status);
  }
  const session = marketSession(now);
  if (!session.open) return weekUnavailable(intraday, session.reason, "closed");
  const barAge = age(intraday.asOf, now);
  const quoteAge = age(intraday.quoteAsOf, now);
  if (barAge === null || quoteAge === null || barAge >= MAX_BAR_AGE_MS ||
      quoteAge >= MAX_QUOTE_AGE_MS || barAge < -30_000 || quoteAge < -30_000 ||
      Date.parse(intraday.validUntil || "") <= now) {
    return weekUnavailable(intraday, "Current minute bar or quote is stale; the five-session signal is paused.", "stale");
  }
  const todayStart = Date.parse(snapshot?.dailyBar?.t || "");
  if (!Number.isFinite(todayStart) || !Array.isArray(bars)) {
    return weekUnavailable(intraday, "Five completed daily bars are required.");
  }
  const valid = bars.filter((bar) => {
    const stamp = Date.parse(bar?.t || "");
    return Number.isFinite(stamp) && stamp < todayStart && finite(bar.c) > 0 && finite(bar.v) >= 0;
  }).sort((a, b) => Date.parse(b.t) - Date.parse(a.t));
  const seenSessions = new Set();
  const completed = valid.filter((bar) => {
    const day = bar.t.slice(0, 10);
    if (seenSessions.has(day)) return false;
    seenSessions.add(day);
    return true;
  }).slice(0, 5);
  if (completed.length < 5 || age(completed[0].t, now) > 5 * 86_400_000 ||
      age(completed[4].t, now) > 14 * 86_400_000) {
    return weekUnavailable(intraday, "Five recent completed trading sessions are unavailable.");
  }
  const chronological = completed.reverse();
  const current = intraday.metrics.lastPrice;
  const baseline = chronological[0].c;
  const observedReturnPct = pct(current - baseline, baseline);
  const spreadBps = intraday.metrics.spreadBps;
  const scenario = observedScenario(observedReturnPct, spreadBps);
  const prices = [...chronological.map((bar) => bar.c), current];
  const positiveSessions = prices.slice(1).filter((price, index) => price > prices[index]).length;
  const averageDailyDollarVolume = chronological.reduce((sum, bar) => sum + bar.c * bar.v, 0) / 5;
  const liquidityOk = averageDailyDollarVolume >= 1_000_000;
  const spreadOk = spreadBps <= 50;
  const priceOk = current >= 1;
  const recommendation = liquidityOk && spreadOk && priceOk && observedReturnPct >= 2 &&
    positiveSessions >= 4 && scenario.observedLongAfterCostPct >= 1 ? "buy" :
    liquidityOk && spreadOk && priceOk && observedReturnPct <= -2 &&
    positiveSessions <= 1 && scenario.observedShortAfterCostPct >= 1 ? "sell" : "watch";
  const reasons = [
    `Five-session observed move ${observedReturnPct.toFixed(2)}%; ${positiveSessions} of 5 closing steps rose.`,
    `Average completed-session dollar volume $${Math.round(averageDailyDollarVolume).toLocaleString("en-US")}; current spread ${spreadBps.toFixed(1)} bps.`,
    `Observed long/short moves after assumed round-trip costs ${scenario.observedLongAfterCostPct.toFixed(2)}% / ${scenario.observedShortAfterCostPct.toFixed(2)}%; these are not future return estimates.`,
  ];
  if (!liquidityOk) reasons.push("Thin five-session volume blocks a directional setup.");
  if (!spreadOk) reasons.push("Current spread blocks the execution-cost gate.");
  if (!priceOk) reasons.push("Sub-$1 stock: the price-risk gate blocks a directional setup.");
  if (feed === "iex") reasons.push("IEX is a single venue; historical volume is not a consolidated market total.");
  return {
    label: "Five-session trend",
    status: "ready",
    recommendation,
    score: Math.min(95, Math.max(5, Math.round(50 + observedReturnPct * 5 + (positiveSessions - 2.5) * 5))),
    confidence: feed === "sip" ? "moderate" : "low",
    metrics: {
      lastPrice: current,
      fiveSessionReturnPct: observedReturnPct,
      positiveSessions,
      averageDailyDollarVolume,
      spreadBps,
      netProfit: null,
    },
    asOf: intraday.asOf,
    validUntil: intraday.validUntil,
    historyThrough: chronological[4].t,
    source: { name: "Alpaca Market Data", url: HISTORY_DOCS, feed },
    reasons,
    scenario,
  };
}

function withHorizons(intraday, oneWeek = null) {
  const week = oneWeek || weekUnavailable(intraday, intraday.reasons[0], intraday.status);
  return {
    ...intraday,
    horizons: {
      intraday: { ...intraday, label: "Intraday pulse" },
      oneWeek: week,
    },
  };
}

async function fetchSignal(ticker) {
  const now = Date.now();
  const key = process.env.ALPACA_API_KEY_ID || process.env.APCA_API_KEY_ID;
  const secret = process.env.ALPACA_API_SECRET_KEY || process.env.APCA_API_SECRET_KEY;
  const feed = (process.env.ALPACA_STOCK_DATA_FEED || process.env.ALPACA_MARKET_DATA_FEED || "iex").toLowerCase();
  if (!key || !secret) return withHorizons(unavailable(ticker, "Minute screens resume when a licensed live feed is available.", now, feed));
  if (!/^(iex|sip)$/.test(feed)) return withHorizons(unavailable(ticker, "Minute screens resume when a licensed live feed is available.", now, feed));
  const endpoint = `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(ticker)}/snapshot?feed=${feed}`;
  const headers = {
    "APCA-API-KEY-ID": key,
    "APCA-API-SECRET-KEY": secret,
    Accept: "application/json",
  };
  try {
    const response = await fetch(endpoint, {
      headers,
      signal: AbortSignal.timeout(7_000),
    });
    if (!response.ok) {
      const reason = response.status === 429 ? "Market-data rate limit reached; the signal is paused." :
        response.status === 401 || response.status === 403 ? "Market-data authorization or feed entitlement failed." :
        "Market data is temporarily unavailable.";
      return withHorizons(unavailable(ticker, reason, now, feed));
    }
    const snapshot = await response.json();
    const intraday = scoreSnapshot(ticker, snapshot, { now: Date.now(), feed });
    if (intraday.status !== "ready") return withHorizons(intraday);
    const start = new Date(Date.now() - 28 * 86_400_000).toISOString();
    const end = new Date().toISOString();
    const historyUrl = new URL(`https://data.alpaca.markets/v2/stocks/${encodeURIComponent(ticker)}/bars`);
    historyUrl.search = new URLSearchParams({ timeframe: "1Day", start, end, limit: "20", sort: "desc", adjustment: "split", feed }).toString();
    try {
      const history = await fetch(historyUrl, { headers, signal: AbortSignal.timeout(7_000) });
      if (!history.ok) return withHorizons(intraday, weekUnavailable(intraday, "Historical market data is unavailable."));
      const payload = await history.json();
      return withHorizons(intraday, scoreOneWeek(ticker, payload?.bars, snapshot, intraday, { now: Date.now(), feed }));
    } catch {
      return withHorizons(intraday, weekUnavailable(intraday, "Historical market data is temporarily unavailable."));
    }
  } catch {
    return withHorizons(unavailable(ticker, "Market data is temporarily unavailable.", now, feed));
  }
}

async function signalFor(ticker) {
  const saved = cache.get(ticker);
  if (saved && Date.now() - saved.at < REFRESH_MS) {
    const result = await saved.promise;
    const barAge = age(result.asOf, Date.now());
    const quoteAge = age(result.quoteAsOf, Date.now());
    const open = marketSession(Date.now()).open;
    if (result.status !== "ready" && !(result.status === "closed" && open)) return result;
    if (result.status === "ready" && open && barAge !== null && barAge < MAX_BAR_AGE_MS &&
        quoteAge !== null && quoteAge < MAX_QUOTE_AGE_MS &&
        Date.parse(result.validUntil || "") > Date.now()) return result;
  }
  const promise = fetchSignal(ticker);
  cache.set(ticker, { at: Date.now(), promise });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return promise;
}

async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const params = req.query || Object.fromEntries(new URL(req.url, "http://localhost").searchParams);
  const ticker = String(params.ticker || "").trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.\-]{0,14}$/.test(ticker)) {
    return res.status(400).json({ error: "Enter a valid U.S. stock ticker" });
  }
  // A proxy must never replay a once-current recommendation after its source ages out.
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json(await signalFor(ticker));
}

export { scoreSnapshot, marketSession, scoreOneWeek, withHorizons, unavailable };
export default handler;
