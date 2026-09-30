import { randomUUID } from "node:crypto";
import { accountSummary, submitOrder, tradingMode } from "./_lib/alpaca.js";
import { requiredOptionsLevel, validateLongDebitVertical } from "./_lib/strategy.js";
import { body, fail, method, requireOperator, send } from "./_lib/http.js";

function rejection(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function riskCap() {
  const cap = Number(process.env.STONK_MAX_RISK_PER_TRADE_USD ?? 250);
  if (!Number.isFinite(cap) || cap <= 0) rejection("Risk cap is not configured correctly", 503);
  return cap;
}

export default async function handler(req, res) {
  try {
    method(req, ["POST"]);
    requireOperator(req, { mutation: true });
    const payload = await body(req);
    const validated = validateLongDebitVertical(payload.order);
    if (!validated) rejection("Only 1:1 long debit call or put verticals with a positive limit price are accepted");

    const cap = riskCap();
    const risk = { bounded: true, maxLoss: validated.maxLoss };
    if (risk.maxLoss > cap) rejection(`Estimated max loss ${risk.maxLoss} exceeds configured cap ${cap}`);

    const order = validated.order;
    const requiredLevel = requiredOptionsLevel(order);
    const account = await accountSummary();
    if (account.tradingBlocked || account.status !== "ACTIVE") {
      rejection("Broker account is not active for trading", 403);
    }
    if (Number(account.optionsTradingLevel || 0) < requiredLevel) {
      rejection(`Order requires options level ${requiredLevel}`, 403);
    }
    const buyingPower = Number(account.optionsBuyingPower);
    if (!Number.isFinite(buyingPower) || buyingPower < risk.maxLoss) {
      rejection("Insufficient verified options buying power", 403);
    }

    if (payload.execute !== true) {
      return send(res, 200, { ok: true, preview: true, mode: tradingMode(), risk,
        requiredOptionsLevel: requiredLevel, account, order });
    }
    const brokerOrder = { ...order, client_order_id: `stonk-${randomUUID()}` };
    const placed = await submitOrder(brokerOrder);
    return send(res, 200, { ok: true, preview: false, mode: tradingMode(), risk,
      requiredOptionsLevel: requiredLevel, order: placed });
  } catch (error) {
    return fail(res, error);
  }
}
