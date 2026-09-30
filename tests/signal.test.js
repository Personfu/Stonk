import test from "node:test";
import assert from "node:assert/strict";
import signalHandler, * as signalExports from "../api/signal.js";

const handler = Object.assign(signalHandler, signalExports);

const NOW = Date.parse("2026-09-29T15:00:00Z");
const barTime = "2026-09-29T14:59:00Z";
const quoteTime = "2026-09-29T14:59:30Z";

function snapshot({ close = 101.5, open = 100.5, high = 102, low = 99,
  volume = 1000, bid = 101.49, ask = 101.51,
  minuteAt = barTime, quoteAt = quoteTime, dayAt = "2026-09-29T04:00:00Z" } = {}) {
  return {
    minuteBar: { t: minuteAt, o: open, h: Math.max(close, open), l: Math.min(close, open), c: close, v: volume },
    dailyBar: { t: dayAt, o: 100, h: high, l: low, c: close, v: 100_000 },
    prevDailyBar: { t: "2026-09-28T04:00:00Z", c: 100 },
    latestQuote: { t: quoteAt, bp: bid, ap: ask },
  };
}

function weeklyBars({ closes = [100, 100.5, 101, 101.5, 102], volume = 100_000 } = {}) {
  const dates = ["2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-28"];
  return dates.map((date, index) => ({ t: `${date}T04:00:00Z`, c: closes[index], v: volume }));
}

test("fresh liquid bullish snapshot yields an explainable low-confidence IEX screen", () => {
  const result = handler.scoreSnapshot("AAPL", snapshot(), { now: NOW, feed: "iex" });
  assert.equal(result.status, "ready");
  assert.equal(result.recommendation, "buy");
  assert.equal(result.confidence, "low");
  assert.equal(result.metrics.changePct, 1.5);
  assert.equal(result.metrics.netProfit, null);
  assert.equal(result.scenario.estimatedFutureNetReturnPct, null);
  assert.ok(result.scenario.observedLongAfterCostPct < result.metrics.momentumPct);
  assert.equal(result.source.feed, "iex");
  assert.equal(result.validUntil, "2026-09-29T15:02:00.000Z");
  assert.ok(result.reasons.some((line) => line.includes("single venue")));
});

test("bearish setup requires momentum, range, volume and a narrow spread", () => {
  const bearish = snapshot({ close: 98, open: 99, high: 102, low: 97,
    bid: 97.99, ask: 98.01 });
  const result = handler.scoreSnapshot("GM", bearish, { now: NOW, feed: "sip" });
  assert.equal(result.recommendation, "sell");
  assert.equal(result.confidence, "moderate");
  assert.ok(result.scenario.observedShortAfterCostPct > 0);
  assert.ok(result.scenario.observedLongAfterCostPct < 0);

  bearish.minuteBar.v = 1;
  assert.equal(handler.scoreSnapshot("GM", bearish, { now: NOW, feed: "sip" }).recommendation, "watch");
  bearish.minuteBar.v = 1000;
  bearish.latestQuote.ap = 99;
  assert.equal(handler.scoreSnapshot("GM", bearish, { now: NOW, feed: "sip" }).recommendation, "watch");
});

test("stale or delayed data never produces a recommendation", () => {
  const old = handler.scoreSnapshot("AAPL", snapshot({ minuteAt: "2026-09-29T14:55:00Z" }), { now: NOW });
  assert.equal(old.status, "stale");
  assert.equal(old.recommendation, null);
  const delayed = handler.scoreSnapshot("AAPL", snapshot(), { now: NOW, feed: "delayed_sip" });
  assert.equal(delayed.status, "stale");
  assert.equal(delayed.recommendation, null);
});

test("NYSE regular-session clock handles premarket, close, holidays, early closes, and DST", () => {
  const session = (stamp) => handler.marketSession(Date.parse(stamp));
  assert.equal(session("2026-09-29T13:29:59Z").open, false); // 09:29 ET
  assert.equal(session("2026-09-29T13:30:00Z").open, true);  // 09:30 ET
  assert.equal(session("2026-09-29T20:00:00Z").open, false); // 16:00 ET
  assert.equal(session("2026-10-03T15:00:00Z").open, false); // Saturday
  assert.equal(session("2026-11-26T15:00:00Z").open, false); // Thanksgiving
  assert.equal(session("2026-11-27T17:59:00Z").open, true);  // 12:59 ET early close
  assert.equal(session("2026-11-27T18:00:00Z").open, false); // 13:00 ET early close
  assert.equal(session("2027-01-04T14:30:00Z").open, true);  // EST
  assert.equal(session("2027-07-06T13:30:00Z").open, true);  // EDT
  assert.equal(session("2029-09-28T15:00:00Z").open, false); // Unverified calendar year
});

test("signal expiry is capped at normal and early session closes", () => {
  const nearClose = Date.parse("2026-09-29T19:59:30Z");
  const regular = snapshot({ minuteAt: "2026-09-29T19:59:00Z", quoteAt: "2026-09-29T19:59:15Z" });
  const scored = handler.scoreSnapshot("AAPL", regular, { now: nearClose });
  assert.equal(scored.status, "ready");
  assert.equal(scored.validUntil, "2026-09-29T20:00:00.000Z");
  const early = snapshot({ minuteAt: "2026-11-27T17:59:00Z",
    quoteAt: "2026-11-27T17:59:15Z", dayAt: "2026-11-27T05:00:00Z" });
  const earlyScore = handler.scoreSnapshot("AAPL", early,
    { now: Date.parse("2026-11-27T17:59:30Z") });
  assert.equal(earlyScore.status, "ready");
  assert.equal(earlyScore.validUntil, "2026-11-27T18:00:00.000Z");
});

test("fresh extended-hours bars never produce day-trade or one-week recommendations", () => {
  const premarket = Date.parse("2026-09-29T13:29:30Z");
  const pre = snapshot({ minuteAt: "2026-09-29T13:28:00Z", quoteAt: "2026-09-29T13:29:00Z" });
  const preResult = handler.scoreSnapshot("AAPL", pre, { now: premarket });
  assert.equal(preResult.status, "closed");
  assert.equal(preResult.recommendation, null);
  assert.equal(preResult.scenario, null);
  const open = Date.parse("2026-09-29T13:30:30Z");
  const oldBar = handler.scoreSnapshot("AAPL", pre, { now: open });
  assert.equal(oldBar.status, "closed"); // Bar and quote are still premarket.
  assert.equal(oldBar.recommendation, null);
  const afterHours = Date.parse("2026-09-29T20:01:30Z");
  const after = snapshot({ minuteAt: "2026-09-29T20:00:00Z", quoteAt: "2026-09-29T20:01:00Z" });
  const intraday = handler.scoreSnapshot("AAPL", after, { now: afterHours });
  assert.equal(intraday.status, "closed");
  const weekly = handler.scoreOneWeek("AAPL", weeklyBars(), after, intraday, { now: afterHours });
  assert.equal(weekly.status, "closed");
  assert.equal(weekly.recommendation, null);
  const holiday = Date.parse("2026-11-26T15:00:00Z");
  const onHoliday = snapshot({ minuteAt: "2026-11-26T14:59:00Z",
    quoteAt: "2026-11-26T14:59:30Z", dayAt: "2026-11-26T05:00:00Z" });
  const holidayResult = handler.scoreSnapshot("AAPL", onHoliday, { now: holiday });
  assert.equal(holidayResult.status, "closed");
  assert.equal(holidayResult.recommendation, null);
});

test("inconsistent quote and missing bar cannot be scored", () => {
  assert.equal(handler.scoreSnapshot("AAPL", snapshot({ bid: 102, ask: 101 }), { now: NOW }).status, "unavailable");
  assert.equal(handler.scoreSnapshot("AAPL", { latestQuote: {} }, { now: NOW }).recommendation, null);
});

test("invalid ticker is rejected before any provider call", async () => {
  const reply = {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  await handler({ method: "GET", query: { ticker: "AAPL/../../" } }, reply);
  assert.equal(reply.code, 400);
  assert.match(reply.payload.error, /valid/);
});

test("five-session screen uses completed historical bars and current quote", () => {
  const live = snapshot({ close: 103, open: 102.5, high: 103.5, low: 100, bid: 102.99, ask: 103.01 });
  const intraday = handler.scoreSnapshot("AAPL", live, { now: NOW });
  const bars = weeklyBars();
  bars.push({ t: "2026-09-29T04:00:00Z", c: 999, v: 100_000 }); // Ignore incomplete current day.
  const result = handler.scoreOneWeek("AAPL", bars, live, intraday, { now: NOW, feed: "iex" });
  assert.equal(result.status, "ready");
  assert.equal(result.recommendation, "buy");
  assert.equal(result.metrics.positiveSessions, 5);
  assert.equal(result.metrics.fiveSessionReturnPct, 3);
  assert.equal(result.historyThrough, "2026-09-28T04:00:00Z");
  assert.equal(result.scenario.estimatedFutureNetReturnPct, null);
  assert.equal(result.validUntil, intraday.validUntil);
  assert.ok(result.scenario.observedLongAfterCostPct < 3);
  assert.equal(handler.withHorizons(intraday, result).horizons.oneWeek.recommendation, "buy");
});

test("bearish weekly gate evaluates after-cost short scenario separately", () => {
  const live = snapshot({ close: 98, open: 99, high: 103, low: 97, bid: 97.99, ask: 98.01 });
  const intraday = handler.scoreSnapshot("GM", live, { now: NOW });
  const week = handler.scoreOneWeek("GM", weeklyBars({ closes: [103, 102, 101, 100, 99] }),
    live, intraday, { now: NOW });
  assert.equal(week.recommendation, "sell");
  assert.equal(week.metrics.positiveSessions, 0);
  assert.ok(week.scenario.observedShortAfterCostPct > 1);
  assert.ok(week.scenario.observedLongAfterCostPct < 0);
});

test("penny and illiquid stocks are analyzed but cannot pass directional gates", () => {
  const penny = snapshot({ close: 0.45, open: 0.42, high: 0.5, low: 0.4,
    volume: 1_000_000, bid: 0.43, ask: 0.47 });
  const intraday = handler.scoreSnapshot("PENNY", penny, { now: NOW });
  assert.equal(intraday.status, "ready");
  assert.equal(intraday.recommendation, "watch");
  assert.ok(intraday.reasons.some((reason) => reason.includes("Sub-$1")));
  const bars = weeklyBars({ closes: [0.38, 0.39, 0.4, 0.41, 0.42], volume: 10_000 });
  const week = handler.scoreOneWeek("PENNY", bars, penny, intraday, { now: NOW });
  assert.equal(week.status, "ready");
  assert.equal(week.recommendation, "watch");
  assert.ok(week.reasons.some((reason) => reason.includes("Thin")));
});

test("one-week screen refuses absent history and stale current feed", () => {
  const live = snapshot();
  const intraday = handler.scoreSnapshot("AAPL", live, { now: NOW });
  assert.equal(handler.scoreOneWeek("AAPL", weeklyBars().slice(0, 3), live, intraday, { now: NOW }).status, "unavailable");
  const repeated = [...weeklyBars().slice(0, 4), { ...weeklyBars()[3] }];
  assert.equal(handler.scoreOneWeek("AAPL", repeated, live, intraday, { now: NOW }).status, "unavailable");
  const stale = handler.scoreSnapshot("AAPL", snapshot({ minuteAt: "2026-09-29T14:54:00Z" }), { now: NOW });
  const week = handler.scoreOneWeek("AAPL", weeklyBars(), live, stale, { now: NOW });
  assert.equal(week.status, "stale");
  assert.equal(week.recommendation, null);
  assert.equal(week.scenario, null);
  const aged = handler.scoreOneWeek("AAPL", weeklyBars(), live, intraday, { now: NOW + 5 * 60_000 });
  assert.equal(aged.status, "stale");
  assert.equal(aged.recommendation, null);
  const closed = handler.scoreOneWeek("AAPL", weeklyBars(), live, intraday,
    { now: Date.parse("2026-09-29T20:01:00Z") });
  assert.equal(closed.status, "closed");
  assert.equal(closed.recommendation, null);
});

test("API assembles both horizons from authenticated provider responses without exposing keys", async () => {
  const priorFetch = global.fetch;
  const priorNow = Date.now;
  const priorKey = process.env.ALPACA_API_KEY_ID;
  const priorSecret = process.env.ALPACA_API_SECRET_KEY;
  const priorFeed = process.env.ALPACA_MARKET_DATA_FEED;
  const now = NOW;
  const currentDay = new Date(now);
  currentDay.setUTCHours(0, 0, 0, 0);
  const live = snapshot({ close: 103, open: 102.5, high: 104, low: 99, bid: 102.99, ask: 103.01,
    minuteAt: new Date(now - 60_000).toISOString(), quoteAt: new Date(now - 30_000).toISOString() });
  live.dailyBar.t = currentDay.toISOString();
  const bars = [100, 100.5, 101, 101.5, 102].map((close, index) => ({
    t: new Date(currentDay.getTime() - (5 - index) * 86_400_000).toISOString(),
    c: close,
    v: 100_000,
  }));
  let calls = 0;
  try {
    Date.now = () => now;
    process.env.ALPACA_API_KEY_ID = "server-only-test-key";
    process.env.ALPACA_API_SECRET_KEY = "server-only-test-secret";
    process.env.ALPACA_MARKET_DATA_FEED = "iex";
    global.fetch = async (input, options) => {
      calls++;
      assert.equal(options.headers["APCA-API-KEY-ID"], "server-only-test-key");
      const url = String(input);
      if (url.includes("/snapshot?")) return { ok: true, json: async () => live };
      if (url.includes("/bars?")) return { ok: true, json: async () => ({ bars }) };
      throw new Error("unexpected provider URL");
    };
    const reply = {
      setHeader() {},
      status(code) { this.code = code; return this; },
      json(payload) { this.payload = payload; return this; },
    };
    await handler({ method: "GET", query: { ticker: "MOCK" } }, reply);
    assert.equal(reply.code, 200);
    assert.equal(reply.payload.horizons.intraday.status, "ready");
    assert.equal(reply.payload.horizons.oneWeek.status, "ready");
    assert.equal(calls, 2);
    assert.doesNotMatch(JSON.stringify(reply.payload), /server-only-test-/);
  } finally {
    Date.now = priorNow;
    global.fetch = priorFetch;
    for (const [name, value] of [["ALPACA_API_KEY_ID", priorKey], ["ALPACA_API_SECRET_KEY", priorSecret],
      ["ALPACA_MARKET_DATA_FEED", priorFeed]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
