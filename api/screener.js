// The home screen's fixed universe is for discovery. Only fresh market data
// produces rankings; scores are descriptive heuristics, not expected returns.
import { createRequire } from "node:module";
import { scoreSnapshot, marketSession } from "./signal.js";

const require = createRequire(import.meta.url);
const universe = require("../data/universe.json");
const directory = require("../data/us_symbols.json");

const REFRESH_MS = 60_000;
const SNAPSHOT_DOCS = "https://docs.alpaca.markets/us/reference/stocksnapshots-1";
const listing = new Map(directory.rows.map(([ticker, name, exchange, kind]) =>
  [ticker, { ticker, name, exchange, kind }]));

const candidates = universe.candidates.map(([ticker, cluster, scale]) => {
  const row = listing.get(ticker);
  if (!row || row.kind !== "security") {
    throw new Error(`Screener candidate ${ticker} is absent from the Nasdaq Trader security directory`);
  }
  return Object.freeze({ ticker, name: row.name, exchange: row.exchange, cluster, scale });
});
if (candidates.length !== 50 || new Set(candidates.map((item) => item.ticker)).size !== 50) {
  throw new Error("Screener universe must contain 50 unique securities");
}

const universeSource = {
  name: universe.source.name,
  url: universe.source.url,
  asOf: directory.asOf,
};
let cache = null;

function baseResult(status, reason, now, feed = null) {
  return {
    status,
    reason,
    asOf: null,
    validUntil: null,
    refreshedAt: new Date(now).toISOString(),
    nextRefreshAt: new Date(now + REFRESH_MS).toISOString(),
    refreshIntervalMs: REFRESH_MS,
    source: {
      universe: universeSource,
      marketData: feed ? { name: "Alpaca Stock Snapshots", url: SNAPSHOT_DOCS, feed } : null,
    },
    methodology: "Fixed discovery universe; fresh BUY and SELL screens rank before WATCH. Directional strength is the distance of the score from neutral 50; observed after-cost movement breaks ties. Neither is a forecast or profit probability.",
    candidates,
    ranked: [],
    picks: [],
  };
}

function rankSnapshots(snapshots, { now = Date.now(), feed = "iex" } = {}) {
  const result = baseResult("unavailable", "No fresh market snapshots qualified.", now, feed);
  const session = marketSession(now);
  if (!session.open) return baseResult("closed", session.reason, now, feed);
  if (!snapshots || typeof snapshots !== "object" || Array.isArray(snapshots)) return result;

  const ranked = [];
  for (const candidate of candidates) {
    const signal = scoreSnapshot(candidate.ticker, snapshots[candidate.ticker], { now, feed });
    if (signal.status !== "ready") continue;
    ranked.push({
      ...candidate,
      recommendation: signal.recommendation,
      score: signal.score,
      scoreLabel: "Directional scale: below 50 bearish, above 50 bullish; not a profit probability",
      directionalStrength: Math.abs(signal.score - 50),
      asOf: signal.asOf,
      quoteAsOf: signal.quoteAsOf,
      validUntil: signal.validUntil,
      metrics: {
        lastPrice: signal.metrics.lastPrice,
        changePct: signal.metrics.changePct,
        momentumPct: signal.metrics.momentumPct,
        minuteDollarVolume: signal.metrics.minuteDollarVolume,
        spreadBps: signal.metrics.spreadBps,
        netProfit: null,
      },
      observedLongAfterCostPct: signal.scenario.observedLongAfterCostPct,
      observedShortAfterCostPct: signal.scenario.observedShortAfterCostPct,
      reasons: signal.reasons,
      source: signal.source,
    });
  }
  const order = { buy: 0, sell: 0, watch: 1 };
  const afterCostMove = (entry) => entry.recommendation === "sell" ?
    entry.observedShortAfterCostPct : entry.observedLongAfterCostPct;
  ranked.sort((a, b) =>
    order[a.recommendation] - order[b.recommendation] ||
    b.directionalStrength - a.directionalStrength ||
    (a.recommendation !== "watch" ? afterCostMove(b) - afterCostMove(a) : 0) ||
    Math.abs(b.metrics.momentumPct) - Math.abs(a.metrics.momentumPct) ||
    a.ticker.localeCompare(b.ticker));
  ranked.forEach((entry, index) => { entry.rank = index + 1; });

  result.ranked = ranked;
  const byCluster = new Map();
  result.picks = ranked.filter((entry) => {
    if (entry.recommendation !== "buy") return false;
    const count = byCluster.get(entry.cluster) || 0;
    if (count >= 2) return false;
    byCluster.set(entry.cluster, count + 1);
    return true;
  }).slice(0, 12);
  if (ranked.length > 0) {
    result.status = ranked.length === candidates.length ? "ready" : "partial";
    result.reason = ranked.length === candidates.length ?
      "All 50 candidates have fresh market snapshots." :
      `${ranked.length} of 50 candidates have fresh market snapshots; others are omitted.`;
    // Earliest included bar is the honest freshness bound for a mixed batch.
    result.asOf = ranked.reduce((oldest, entry) =>
      !oldest || entry.asOf < oldest ? entry.asOf : oldest, null);
    result.validUntil = ranked.reduce((earliest, entry) =>
      !earliest || entry.validUntil < earliest ? entry.validUntil : earliest, null);
  }
  return result;
}

async function fetchScreener() {
  const now = Date.now();
  const key = process.env.ALPACA_API_KEY_ID || process.env.APCA_API_KEY_ID;
  const secret = process.env.ALPACA_API_SECRET_KEY || process.env.APCA_API_SECRET_KEY;
  const feed = (process.env.ALPACA_STOCK_DATA_FEED || process.env.ALPACA_MARKET_DATA_FEED || "iex").toLowerCase();
  if (!key || !secret) {
    return baseResult("unconfigured", "Live rankings resume when a licensed market feed is available.", now);
  }
  if (!/^(iex|sip)$/.test(feed)) {
    return baseResult("unavailable", "Live rankings resume when a licensed market feed is available.", now, feed);
  }
  const session = marketSession(now);
  if (!session.open) return baseResult("closed", session.reason, now, feed);

  const url = new URL("https://data.alpaca.markets/v2/stocks/snapshots");
  url.search = new URLSearchParams({
    symbols: candidates.map((item) => item.ticker).join(","),
    feed,
  }).toString();
  try {
    const response = await fetch(url, {
      headers: {
        "APCA-API-KEY-ID": key,
        "APCA-API-SECRET-KEY": secret,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      const reason = response.status === 429 ? "Market-data rate limit reached; rankings are paused." :
        response.status === 401 || response.status === 403 ?
          "Market-data authorization or feed entitlement failed." :
          "Market snapshots are temporarily unavailable.";
      return baseResult("unavailable", reason, Date.now(), feed);
    }
    const payload = await response.json();
    return rankSnapshots(payload?.snapshots, { now: Date.now(), feed });
  } catch {
    return baseResult("unavailable", "Market snapshots are temporarily unavailable.", Date.now(), feed);
  }
}

async function screener() {
  const now = Date.now();
  if (cache && now - cache.at < REFRESH_MS) {
    const result = await cache.promise;
    const open = marketSession(now).open;
    if (result.status === "closed" && open) {
      // The opening bell invalidates a closed-session response immediately.
    } else if ((result.status === "ready" || result.status === "partial") && !open) {
      return baseResult("closed", marketSession(now).reason, now,
        result.source.marketData?.feed || null);
    } else if ((result.status === "ready" || result.status === "partial") &&
        Date.parse(result.validUntil || "") <= now) {
      // A source expired before the next scheduled poll.
    } else return result;
  }
  const promise = fetchScreener();
  cache = { at: now, promise };
  return promise;
}

async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json(await screener());
}

export { candidates, rankSnapshots, baseResult };
export function clearCache() { cache = null; }
export default handler;
