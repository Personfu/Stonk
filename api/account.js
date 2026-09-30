import { accountSummary } from "./_lib/alpaca.js";
import { fail, method, requireOperator, send } from "./_lib/http.js";

export default async function handler(req, res) {
  try {
    method(req, ["GET"]);
    requireOperator(req);
    send(res, 200, { ok: true, account: await accountSummary() });
  } catch (error) {
    fail(res, error);
  }
}
