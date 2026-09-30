import { body, clearOperatorSession, createOperatorSession, fail, operatorSession, send } from "./_lib/http.js";

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      return send(res, 200, { ok: true, ...operatorSession(req) });
    }
    if (req.method === "POST") {
      const payload = await body(req);
      return send(res, 200, { ok: true, ...createOperatorSession(req, res, payload.secret) });
    }
    if (req.method === "DELETE") {
      clearOperatorSession(req, res);
      return send(res, 200, { ok: true, authenticated: false });
    }
    res.setHeader("Allow", "GET, POST, DELETE");
    return send(res, 405, { ok: false, error: "Method not allowed" });
  } catch (error) {
    return fail(res, error);
  }
}
