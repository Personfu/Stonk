import test from "node:test";
import assert from "node:assert/strict";
import screenerHandler, * as screenerExports from "../api/screener.js";

const screener = Object.assign(screenerHandler, screenerExports);

function snapshot(now, offset = 0) {
  const time = new Date(now + offset - 60_000).toISOString();
  return {
    minuteBar: { t: time, o: 100, c: 100.5, v: 2000 },
    latestQuote: { t: time, bp: 100.49, ap: 100.51 },
    dailyBar: { t: new Date(now - 5 * 60_000).toISOString(), h: 100.6, l: 99 },
    prevDailyBar: { c: 99.5 },
  };
}

function bearishSnapshot(now, close = 98.5) {
  const time = new Date(now - 60_000).toISOString();
  return {
    minuteBar: { t: time, o: 100, c: close, v: 2000 },
    latestQuote: { t: time, bp: close - 0.01, ap: close + 0.01 },
    dailyBar: { t: new Date(now - 5 * 60_000).toISOString(), h: 101, l: 98 },
    prevDailyBar: { c: 100.5 },
  };
}

test("discovery universe contains 50 unique listed stocks across themes", () => {
  const candidates = screener.candidates;
  assert.equal(candidates.length, 50);
  assert.equal(new Set(candidates.map((item) => item.ticker)).size, 50);
  assert.equal(new Set(candidates.map((item) => item.cluster)).size, 10);
  assert.deepEqual(new Set(candidates.map((item) => item.scale)),
    new Set(["established", "growing", "specialty"]));
  assert.ok(candidates.every((item) => item.name && item.exchange));
});

test("rankings require fresh snapshots and do not invent profit", () => {
  const now = Date.parse("2026-09-29T17:00:00Z");
  const allFresh = Object.fromEntries(screener.candidates.map((item) => [item.ticker, snapshot(now)]));
  const ranked = screener.rankSnapshots(allFresh, { now, feed: "iex" });
  assert.equal(ranked.status, "ready");
  assert.equal(ranked.ranked.length, 50);
  assert.equal(ranked.picks.length, 12);
  assert.ok(ranked.picks.every((item) => item.recommendation === "buy"));
  assert.ok(ranked.ranked.every((item) => item.metrics.netProfit === null));
  assert.ok(ranked.ranked.every((item) => item.asOf && item.reasons.length));
  const counts = new Map();
  for (const item of ranked.picks) counts.set(item.cluster, (counts.get(item.cluster) || 0) + 1);
  assert.ok([...counts.values()].every((count) => count <= 2));

  allFresh.AAPL = snapshot(now, -90_000);
  const expiring = screener.rankSnapshots(allFresh, { now, feed: "iex" });
  assert.equal(expiring.validUntil, "2026-09-29T17:00:30.000Z");
  assert.equal(expiring.ranked.find((item) => item.ticker === "AAPL").validUntil,
    expiring.validUntil);

  allFresh.AAPL = snapshot(now, -10 * 60_000);
  const partial = screener.rankSnapshots(allFresh, { now, feed: "iex" });
  assert.equal(partial.status, "partial");
  assert.equal(partial.ranked.length, 49);
  assert.ok(!partial.ranked.some((item) => item.ticker === "AAPL"));
  const empty = screener.rankSnapshots({}, { now, feed: "iex" });
  assert.equal(empty.status, "unavailable");
  assert.deepEqual(empty.ranked, []);
  assert.deepEqual(empty.picks, []);
  assert.equal(empty.candidates.length, 50);
});

test("strong bearish SELL screens surface ahead of WATCH entries in the home rail", () => {
  const now = Date.parse("2026-09-29T17:00:00Z");
  const allFresh = Object.fromEntries(screener.candidates.map((item) => {
    const thin = snapshot(now);
    thin.minuteBar.v = 1; // Direction is positive, but volume makes this WATCH.
    return [item.ticker, thin];
  }));
  allFresh.AAPL = snapshot(now);
  allFresh.GM = bearishSnapshot(now);
  const result = screener.rankSnapshots(allFresh, { now, feed: "iex" });
  const sell = result.ranked.find((item) => item.ticker === "GM");
  assert.equal(sell.recommendation, "sell");
  assert.equal(sell.score, 5); // Low means bearish direction, not weak conviction.
  assert.equal(sell.directionalStrength, 45);
  assert.ok(sell.rank <= 12);
  assert.ok(result.ranked.filter((item) => item.recommendation === "watch").every((item) => item.rank > sell.rank));
  assert.ok(result.ranked.slice(0, 2).every((item) => ["buy", "sell"].includes(item.recommendation)));
  assert.ok(result.ranked[0].observedShortAfterCostPct > 0);
});

test("market closure suppresses the entire ranked list even with fresh mock prices", () => {
  const holiday = Date.parse("2026-11-26T15:00:00Z");
  const allFresh = Object.fromEntries(screener.candidates.map((item) => [item.ticker, snapshot(holiday)]));
  const result = screener.rankSnapshots(allFresh, { now: holiday, feed: "iex" });
  assert.equal(result.status, "closed");
  assert.match(result.reason, /regular U\.S\. equity session is closed/i);
  assert.deepEqual(result.ranked, []);
  assert.deepEqual(result.picks, []);
  assert.equal(result.candidates.length, 50);
});

test("unconfigured endpoint returns candidate network without synthetic picks", async () => {
  const priorKey = process.env.ALPACA_API_KEY_ID;
  const priorSecret = process.env.ALPACA_API_SECRET_KEY;
  const priorAltKey = process.env.APCA_API_KEY_ID;
  const priorAltSecret = process.env.APCA_API_SECRET_KEY;
  delete process.env.ALPACA_API_KEY_ID;
  delete process.env.ALPACA_API_SECRET_KEY;
  delete process.env.APCA_API_KEY_ID;
  delete process.env.APCA_API_SECRET_KEY;
  screener.clearCache();
  let body;
  const res = {
    setHeader() {},
    status(code) { assert.equal(code, 200); return this; },
    json(payload) { body = payload; },
  };
  try {
    await screener({ method: "GET" }, res);
    assert.equal(body.status, "unconfigured");
    assert.equal(body.candidates.length, 50);
    assert.deepEqual(body.ranked, []);
    assert.deepEqual(body.picks, []);
    assert.equal(body.asOf, null);
  } finally {
    for (const [name, value] of Object.entries({
      ALPACA_API_KEY_ID: priorKey,
      ALPACA_API_SECRET_KEY: priorSecret,
      APCA_API_KEY_ID: priorAltKey,
      APCA_API_SECRET_KEY: priorAltSecret,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    screener.clearCache();
  }
});

test("configured endpoint requests all candidates in one batch and caches for a minute", async () => {
  const oldFetch = global.fetch;
  const oldNow = Date.now;
  const oldKey = process.env.ALPACA_API_KEY_ID;
  const oldSecret = process.env.ALPACA_API_SECRET_KEY;
  const oldFeed = process.env.ALPACA_MARKET_DATA_FEED;
  let now = Date.parse("2026-09-29T17:00:00Z");
  Date.now = () => now;
  process.env.ALPACA_API_KEY_ID = "unit-test-key";
  process.env.ALPACA_API_SECRET_KEY = "unit-test-secret";
  process.env.ALPACA_MARKET_DATA_FEED = "iex";
  screener.clearCache();
  let calls = 0;
  global.fetch = async (url, options) => {
    calls += 1;
    const parsed = new URL(url);
    assert.equal(parsed.pathname, "/v2/stocks/snapshots");
    assert.equal(parsed.searchParams.get("symbols").split(",").length, 50);
    assert.equal(parsed.searchParams.get("feed"), "iex");
    assert.equal(options.headers["APCA-API-KEY-ID"], "unit-test-key");
    return {
      ok: true,
      async json() { return { snapshots: { AAPL: snapshot(Date.now(), -90_000) } }; },
    };
  };
  let result;
  const res = {
    setHeader() {},
    status(code) { assert.equal(code, 200); return this; },
    json(payload) { result = payload; },
  };
  try {
    await Promise.all([screener({ method: "GET" }, res), screener({ method: "GET" }, res)]);
    assert.equal(calls, 1);
    assert.equal(result.status, "partial");
    assert.deepEqual(result.ranked.map((item) => item.ticker), ["AAPL"]);
    assert.equal(result.picks.length, 1);
    assert.ok(!JSON.stringify(result).includes("unit-test-secret"));
    now += 10_000;
    await screener({ method: "GET" }, res);
    assert.equal(calls, 1);
    now += 21_000; // Source validity expires before the 60-second cache interval.
    await screener({ method: "GET" }, res);
    assert.equal(calls, 2);
  } finally {
    Date.now = oldNow;
    global.fetch = oldFetch;
    for (const [name, value] of Object.entries({
      ALPACA_API_KEY_ID: oldKey,
      ALPACA_API_SECRET_KEY: oldSecret,
      ALPACA_MARKET_DATA_FEED: oldFeed,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    screener.clearCache();
  }
});
