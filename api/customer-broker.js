import { createBrokerClient } from "./_lib/broker-api.js";
import { customerBrokerBinding } from "./_lib/customer-broker-auth.js";
import { fail, method, send } from "./_lib/http.js";

export default async function handler(req, res) {
  try {
    method(req, ["GET"]);
    const { binding } = await customerBrokerBinding(req);
    if (!binding) return send(res, 200, { ok: true, state: "not_opened" });
    const broker = createBrokerClient();
    if (binding.environment !== broker.mode) {
      const error = new Error("Customer broker environment does not match deployment");
      error.status = 503;
      throw error;
    }
    const account = await broker.getAccount(binding.accountId);
    const status = typeof account?.status === "string" ? account.status : null;
    if (!status) {
      const error = new Error("Broker account status is incomplete");
      error.status = 503;
      throw error;
    }
    if (status !== "ACTIVE") return send(res, 200, { ok: true, state: "pending", status,
      environment: broker.mode });
    const trading = await broker.getTradingAccount(binding.accountId);
    return send(res, 200, { ok: true, state: "active", status,
      environment: broker.mode, tradingBlocked: trading?.trading_blocked === true,
      transfersBlocked: trading?.transfers_blocked === true });
  } catch (error) { fail(res, error); }
}

