import test from "node:test";
import assert from "node:assert/strict";
import automation from "../api/automation.js";

const keys = [
  "CRON_SECRET", "ALPACA_API_KEY_ID", "ALPACA_API_SECRET_KEY",
  "STONK_ALLOW_LIVE_TRADING", "STONK_AUTOTRADE_ENABLED",
  "STONK_AUTOTRADE_EXECUTE", "STONK_MAX_DAILY_LOSS_USD",
  "STONK_MAX_RISK_PER_TRADE_USD",
];

async function runAutomation(account, overrides = {}) {
  const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const oldFetch = globalThis.fetch;
  const calls = [];
  Object.assign(process.env, {
    CRON_SECRET: "operator-test-secret",
    ALPACA_API_KEY_ID: "test-key",
    ALPACA_API_SECRET_KEY: "test-secret",
    STONK_ALLOW_LIVE_TRADING: "I_UNDERSTAND_REAL_MONEY",
    STONK_AUTOTRADE_ENABLED: "true",
    STONK_AUTOTRADE_EXECUTE: "true",
    STONK_MAX_DAILY_LOSS_USD: "500",
    STONK_MAX_RISK_PER_TRADE_USD: "250",
    ...overrides,
  });
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET" });
    if (String(url).endsWith("/v2/clock")) return Response.json({ is_open: true, timestamp: "2026-09-29T15:00:00Z" });
    if (String(url).endsWith("/v2/account")) return Response.json(account);
    if (String(url).endsWith("/v2/positions") || String(url).includes("/v2/orders?")) return Response.json([]);
    throw new Error("Unexpected provider call");
  };
  const req = { headers: { authorization: "Bearer operator-test-secret" } };
  const res = { statusCode: 0, setHeader() {}, end(value) { this.payload = JSON.parse(value); } };
  try {
    await automation(req, res);
    return { status: res.statusCode, payload: res.payload, calls };
  } finally {
    globalThis.fetch = oldFetch;
    for (const key of keys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
}

test("live automation fails closed when broker daily P&L is unavailable", async () => {
  const result = await runAutomation({ status: "ACTIVE", options_trading_level: 3, equity: "10000" });
  assert.equal(result.status, 503);
  assert.ok(result.calls.every((call) => call.method === "GET"));
});

test("live automation rejects an invalid risk cap before scanning or ordering", async () => {
  const result = await runAutomation(
    { status: "ACTIVE", options_trading_level: 3, equity: "10000", last_equity: "10000" },
    { STONK_MAX_RISK_PER_TRADE_USD: "not-a-number" },
  );
  assert.equal(result.status, 503);
  assert.ok(result.calls.every((call) => call.method === "GET"));
});
