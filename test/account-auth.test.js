import test from "node:test";
import assert from "node:assert/strict";
import account from "../api/account.js";

function response() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(body) { this.body = JSON.parse(body); },
  };
}

test("broker account data requires an operator token before any broker request", async () => {
  const previous = process.env.STONK_TRADING_SECRET;
  process.env.STONK_TRADING_SECRET = "test-operator-secret";
  try {
    const res = response();
    await account({ method: "GET", headers: {} }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.ok, false);
    assert.match(res.body.error, /Operator authorization required/);
  } finally {
    if (previous === undefined) delete process.env.STONK_TRADING_SECRET;
    else process.env.STONK_TRADING_SECRET = previous;
  }
});
