import test from "node:test";
import assert from "node:assert/strict";
import orderHandler from "../api/order.js";

const validOrder = {
  order_class: "mleg", qty: "2", type: "limit", limit_price: "1.25", time_in_force: "day",
  legs: [
    { symbol: "AAPL250117C00200000", side: "buy", position_intent: "buy_to_open", ratio_qty: "1" },
    { symbol: "AAPL250117C00210000", side: "sell", position_intent: "sell_to_open", ratio_qty: "1" },
  ],
};

function response() {
  return {
    statusCode: 200, headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(value) { this.body = JSON.parse(value); },
  };
}

function request(order, execute = true, authorized = true, requestId) {
  return { method: "POST", headers: authorized ? { authorization: "Bearer test-operator-secret" } : {},
    body: { order, execute, requestId } };
}

test("manual live order endpoint rejects unsafe shapes before any broker request", async () => {
  const previousSecret = process.env.STONK_TRADING_SECRET;
  const previousFetch = global.fetch;
  process.env.STONK_TRADING_SECRET = "test-operator-secret";
  let brokerCalls = 0;
  global.fetch = async () => { brokerCalls++; throw new Error("Broker must not be contacted"); };
  try {
    const unsafe = [
      { ...validOrder, legs: validOrder.legs.map((leg) => ({ ...leg, side: "sell", position_intent: "sell_to_open" })) },
      { ...validOrder, legs: [validOrder.legs[0], { ...validOrder.legs[1], ratio_qty: "2" }] },
      { ...validOrder, limit_price: "-1.25" },
      { ...validOrder, qty: "0" },
      { ...validOrder, legs: [{ ...validOrder.legs[0], symbol: validOrder.legs[1].symbol },
        { ...validOrder.legs[1], symbol: validOrder.legs[0].symbol }] },
    ];
    for (const proposed of unsafe) {
      const res = response();
      await orderHandler(request(proposed), res);
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.ok, false);
    }
    const unauthorized = response();
    await orderHandler(request(validOrder, true, false), unauthorized);
    assert.equal(unauthorized.statusCode, 401);
    assert.equal(brokerCalls, 0);
  } finally {
    if (previousSecret === undefined) delete process.env.STONK_TRADING_SECRET;
    else process.env.STONK_TRADING_SECRET = previousSecret;
    global.fetch = previousFetch;
  }
});

test("valid debit vertical is canonicalized before a mocked live submission", async () => {
  const names = ["STONK_TRADING_SECRET", "STONK_ALLOW_LIVE_TRADING", "STONK_SINGLE_OWNER_ACCOUNT", "ALPACA_API_KEY_ID",
    "ALPACA_API_SECRET_KEY", "STONK_MAX_RISK_PER_TRADE_USD"];
  const prior = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const previousFetch = global.fetch;
  Object.assign(process.env, {
    STONK_TRADING_SECRET: "test-operator-secret",
    STONK_ALLOW_LIVE_TRADING: "I_UNDERSTAND_REAL_MONEY",
    STONK_SINGLE_OWNER_ACCOUNT: "I_UNDERSTAND_ONE_SHARED_ACCOUNT",
    ALPACA_API_KEY_ID: "mock-key",
    ALPACA_API_SECRET_KEY: "mock-secret",
    STONK_MAX_RISK_PER_TRADE_USD: "250",
  });
  const brokerRequests = [];
  global.fetch = async (url, options) => {
    brokerRequests.push({ url: String(url), options });
    const payload = String(url).endsWith("/v2/account")
      ? { status: "ACTIVE", equity: "10000", cash: "10000", buying_power: "10000",
          options_buying_power: "1000", options_trading_level: 3, trading_blocked: false }
      : { id: "mock-order", status: "new" };
    return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
  };
  try {
    const proposed = { ...validOrder, notional: "100000000", client_order_id: "caller-supplied",
      legs: validOrder.legs.map((leg) => ({ ...leg, extra: "ignored" })) };
    const preview = response();
    await orderHandler(request(proposed, false), preview);
    assert.equal(preview.statusCode, 200);
    assert.equal(preview.body.preview, true);
    assert.equal(preview.body.risk.maxLoss, 250);
    assert.equal(brokerRequests.length, 1);
    assert.equal(preview.body.order.notional, undefined);
    assert.equal(preview.body.order.legs[0].extra, undefined);
    assert.match(preview.body.requestId, /^[0-9a-f-]{36}$/);

    const missingId = response();
    await orderHandler(request(proposed, true), missingId);
    assert.equal(missingId.statusCode, 400);
    assert.equal(brokerRequests.length, 1);

    const execution = response();
    await orderHandler(request(proposed, true, true, preview.body.requestId), execution);
    assert.equal(execution.statusCode, 200);
    assert.equal(execution.body.preview, false);
    assert.equal(brokerRequests.length, 3);
    const sent = JSON.parse(brokerRequests[2].options.body);
    assert.equal(sent.notional, undefined);
    assert.equal(sent.legs[0].extra, undefined);
    assert.match(sent.client_order_id, /^stonk-[0-9a-f-]{36}$/);
    assert.notEqual(sent.client_order_id, "caller-supplied");
    assert.equal(sent.client_order_id, `stonk-${preview.body.requestId}`);
    assert.equal(sent.limit_price, "1.25");

    const retry = response();
    await orderHandler(request(proposed, true, true, preview.body.requestId), retry);
    assert.equal(retry.statusCode, 200);
    const retried = JSON.parse(brokerRequests.at(-1).options.body);
    assert.equal(retried.client_order_id, sent.client_order_id);
  } finally {
    for (const name of names) {
      if (prior[name] === undefined) delete process.env[name];
      else process.env[name] = prior[name];
    }
    global.fetch = previousFetch;
  }
});
