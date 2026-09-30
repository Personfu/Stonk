import { method, fail, send } from "./_lib/http.js";

export default async function handler(req, res) {
  try {
    method(req, ["GET"]);
    return send(res, 200, { ok: true, service: "stonk", time: new Date().toISOString() });
  } catch (error) {
    return fail(res, error);
  }
}
