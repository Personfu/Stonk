import assert from "node:assert/strict";
import { test } from "node:test";
import { BrokerApiError, brokerConfiguration, createBrokerClient } from "../api/_lib/broker-api.js";

const ACCOUNT = "d0dfef6c-3413-4acf-8985-1415ea5295ce";
const BANK = "f87cc72f-5130-4e6a-9899-40654d7c3a88";
const REQUEST = "683a1b92-445b-4c96-8ce6-97c96ca7c79f";
const sandbox = {
  ALPACA_BROKER_API_KEY: "test-key",
  ALPACA_BROKER_API_SECRET: "test-secret",
};

test("Broker API fails closed without separate correspondent credentials", () => {
  assert.throws(() => brokerConfiguration({}), /credentials are not configured/);
  assert.throws(() => brokerConfiguration({ ...sandbox, ALPACA_BROKER_ENV: "paper" }), /environment is invalid/);
  assert.throws(() => brokerConfiguration({ ...sandbox, ALPACA_BROKER_ENV: "live" }), /not approved/);
  assert.equal(brokerConfiguration(sandbox).baseUrl, "https://broker-api.sandbox.alpaca.markets");
});

test("Broker API uses the customer-account path and separate Basic credentials", async () => {
  const calls = [];
  const client = createBrokerClient({ env: sandbox, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ status: "ACTIVE" }) };
  } });
  await client.getAccount(ACCOUNT);
  await client.getTradingAccount(ACCOUNT);
  assert.deepEqual(calls.map(({ url }) => url), [
    `https://broker-api.sandbox.alpaca.markets/v1/accounts/${ACCOUNT}`,
    `https://broker-api.sandbox.alpaca.markets/v1/trading/accounts/${ACCOUNT}/account`,
  ]);
  assert.equal(calls[0].options.headers.Authorization, "Basic dGVzdC1rZXk6dGVzdC1zZWNyZXQ=");
  assert.throws(() => client.getAccount("another-user"), /Invalid broker account ID/);
});

test("Bank link and deposit use an account-scoped Plaid processor token", async () => {
  const calls = [];
  const client = createBrokerClient({ env: sandbox, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ id: BANK }) };
  } });
  await client.linkBankWithPlaid(ACCOUNT, "processor-sandbox-12345678");
  await client.deposit(ACCOUNT, BANK, "25.40");
  assert.equal(calls[0].url, `https://broker-api.sandbox.alpaca.markets/v1/accounts/${ACCOUNT}/ach_relationships`);
  assert.deepEqual(JSON.parse(calls[0].options.body), { processor_token: "processor-sandbox-12345678" });
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    transfer_type: "ach", relationship_id: BANK, amount: "25.40", direction: "INCOMING",
  });
  assert.throws(() => client.deposit(ACCOUNT, BANK, "100e3"), /Invalid USD amount/);
});

test("Equity orders use a deterministic broker ID and omit market orders", async () => {
  const calls = [];
  const client = createBrokerClient({ env: sandbox, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ id: REQUEST }) };
  } });
  await client.submitEquityLimitOrder(ACCOUNT, {
    symbol: "GM", side: "buy", qty: 2, limitPrice: "45.20", requestId: REQUEST,
  });
  assert.equal(calls[0].url, `https://broker-api.sandbox.alpaca.markets/v1/trading/accounts/${ACCOUNT}/orders`);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    symbol: "GM", side: "buy", qty: "2", type: "limit", time_in_force: "day",
    limit_price: "45.20", client_order_id: `stonk-${REQUEST}`,
  });
  assert.throws(() => client.submitEquityLimitOrder(ACCOUNT, {
    symbol: "GM", side: "buy", qty: 2, limitPrice: "45.20", requestId: "bad",
  }), /Invalid equity order/);
});

test("Broker errors do not reveal provider bodies containing sensitive details", async () => {
  const client = createBrokerClient({ env: sandbox, fetchImpl: async () => ({
    ok: false, status: 422, json: async () => ({ message: "SSN 123-45-6789" }),
  }) });
  await assert.rejects(() => client.getAccount(ACCOUNT), (error) => {
    assert.ok(error instanceof BrokerApiError);
    assert.equal(error.status, 422);
    assert.equal(error.message, "Broker request failed");
    return true;
  });
});

