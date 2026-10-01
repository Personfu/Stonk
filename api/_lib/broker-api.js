// Alpaca Broker API is a separate correspondent integration from the private
// single-owner Alpaca Trading API in alpaca.js. Never reuse Trading API keys here.
const HOSTS = Object.freeze({
  sandbox: "https://broker-api.sandbox.alpaca.markets",
  live: "https://broker-api.alpaca.markets",
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SYMBOL = /^[A-Z][A-Z0-9.\-]{0,9}$/;

export class BrokerApiError extends Error {
  constructor(message, status = 503) {
    super(message);
    this.name = "BrokerApiError";
    this.status = status;
  }
}

function accountId(value) {
  if (typeof value !== "string" || !UUID.test(value)) throw new BrokerApiError("Invalid broker account ID", 400);
  return value;
}

function relationshipId(value) {
  if (typeof value !== "string" || !UUID.test(value)) throw new BrokerApiError("Invalid bank relationship ID", 400);
  return value;
}

function positiveUsd(value, max) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > max || !/^\d+(?:\.\d{1,2})?$/.test(String(value))) {
    throw new BrokerApiError("Invalid USD amount", 400);
  }
  return amount.toFixed(2);
}

export function brokerConfiguration(env = process.env) {
  const mode = env.ALPACA_BROKER_ENV || "sandbox";
  if (!Object.hasOwn(HOSTS, mode)) throw new BrokerApiError("Broker environment is invalid");
  if (mode === "live" && (
    env.STONK_PUBLIC_BROKER_LIVE !== "I_UNDERSTAND_CUSTOMER_FUNDS" ||
    env.STONK_BROKER_PARTNER_APPROVED !== "true"
  )) throw new BrokerApiError("Public live brokerage is not approved and enabled");
  const key = env.ALPACA_BROKER_API_KEY;
  const secret = env.ALPACA_BROKER_API_SECRET;
  if (!key || !secret) throw new BrokerApiError("Broker API credentials are not configured");
  return { baseUrl: HOSTS[mode], mode, key, secret };
}

export function createBrokerClient({ env = process.env, fetchImpl = fetch } = {}) {
  const config = brokerConfiguration(env);
  async function request(path, { method = "GET", payload } = {}) {
    let response;
    try {
      response = await fetchImpl(`${config.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Basic ${Buffer.from(`${config.key}:${config.secret}`).toString("base64")}`,
          Accept: "application/json",
          ...(payload === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        signal: AbortSignal.timeout(12000),
        cache: "no-store",
      });
    } catch {
      throw new BrokerApiError("Broker service did not respond");
    }
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      // Broker errors may echo PII or banking details. Never forward them to a browser.
      throw new BrokerApiError("Broker request failed", response.status >= 500 ? 503 : response.status);
    }
    if (!result || typeof result !== "object") throw new BrokerApiError("Broker returned an incomplete response");
    return result;
  }

  return Object.freeze({
    mode: config.mode,
    getAccount(id) {
      return request(`/v1/accounts/${accountId(id)}`);
    },
    getTradingAccount(id) {
      return request(`/v1/trading/accounts/${accountId(id)}/account`);
    },
    getBankRelationships(id) {
      return request(`/v1/accounts/${accountId(id)}/ach_relationships`);
    },
    linkBankWithPlaid(id, processorToken) {
      if (typeof processorToken !== "string" || !/^processor-[A-Za-z0-9-]{8,200}$/.test(processorToken)) {
        throw new BrokerApiError("Invalid Plaid processor token", 400);
      }
      return request(`/v1/accounts/${accountId(id)}/ach_relationships`, {
        method: "POST", payload: { processor_token: processorToken },
      });
    },
    deposit(id, bankId, amount) {
      return request(`/v1/accounts/${accountId(id)}/transfers`, {
        method: "POST", payload: {
          transfer_type: "ach", relationship_id: relationshipId(bankId),
          amount: positiveUsd(amount, 100000), direction: "INCOMING",
        },
      });
    },
    getOrders(id) {
      return request(`/v1/trading/accounts/${accountId(id)}/orders?status=all&limit=50`);
    },
    submitEquityLimitOrder(id, order) {
      if (!order || typeof order !== "object" || !SYMBOL.test(order.symbol) ||
          !["buy", "sell"].includes(order.side) || !Number.isSafeInteger(order.qty) ||
          order.qty < 1 || order.qty > 10000 || !UUID.test(order.requestId)) {
        throw new BrokerApiError("Invalid equity order", 400);
      }
      const limitPrice = positiveUsd(order.limitPrice, 100000);
      return request(`/v1/trading/accounts/${accountId(id)}/orders`, {
        method: "POST", payload: {
          symbol: order.symbol, qty: String(order.qty), side: order.side,
          type: "limit", time_in_force: "day", limit_price: limitPrice,
          client_order_id: `stonk-${order.requestId}`,
        },
      });
    },
  });
}

