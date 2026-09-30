import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "stonk_operator_session";
const SESSION_MS = 8 * 60 * 60 * 1000;

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

export function method(req, allowed) {
  if (!allowed.includes(req.method)) {
    const error = new Error(`Method ${req.method} not allowed`);
    error.status = 405;
    throw error;
  }
}

export async function body(req) {
  if (req.body && typeof req.body === "object") return req.body;
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 16_384) {
      const error = new Error("Request body is too large");
      error.status = 413;
      throw error;
    }
  }
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch {
    const error = new Error("Invalid JSON body");
    error.status = 400;
    throw error;
  }
}

export function query(req) { return new URL(req.url, "http://localhost").searchParams; }

export function fail(res, error) {
  const status = Number(error?.status) || 500;
  send(res, status, { ok: false,
    error: status >= 500 ? "Upstream or server error" : error.message,
    detail: process.env.NODE_ENV === "development" ? String(error?.stack || error) : undefined });
}

function authError(message, status = 401) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function operatorSecret() {
  const secret = process.env.STONK_TRADING_SECRET;
  if (!secret) authError("Trading endpoint is not configured", 503);
  return secret;
}

function equalSecret(a, b) {
  const left = createHash("sha256").update(String(a)).digest();
  const right = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(left, right);
}

function sign(value, secret) {
  return createHmac("sha256", secret).update(`stonk:operator:v1:${value}`).digest("base64url");
}

function cookieValue(req) {
  const cookies = String(req.headers?.cookie || "").split(";");
  const found = cookies.find((entry) => entry.trim().startsWith(`${COOKIE_NAME}=`));
  return found ? found.trim().slice(COOKIE_NAME.length + 1) : null;
}

function sessionFromCookie(req, secret) {
  const value = cookieValue(req);
  if (!value || value.length > 2048) return null;
  const [encoded, signature, extra] = value.split(".");
  if (!encoded || !signature || extra) return null;
  if (!equalSecret(signature, sign(encoded, secret))) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (payload?.v !== 1 || typeof payload.nonce !== "string" || payload.nonce.length < 16 ||
        !Number.isFinite(payload.exp) || payload.exp <= Date.now() ||
        payload.exp > Date.now() + SESSION_MS) return null;
    return { ...payload, csrfToken: sign(`${encoded}.${signature}:csrf`, secret) };
  } catch { return null; }
}

function originOf(req) {
  const host = String(req.headers?.host || "");
  const forwarded = String(req.headers?.["x-forwarded-proto"] || "").split(",")[0].trim();
  const protocol = forwarded || (req.socket?.encrypted ? "https" : "http");
  if (!host || !["http", "https"].includes(protocol)) return null;
  try { return new URL(`${protocol}://${host}`).origin; }
  catch { return null; }
}

function requireSameOrigin(req) {
  const expected = originOf(req);
  if (!expected || req.headers?.origin !== expected) authError("Same-origin request required", 403);
  if (!expected.startsWith("https://") && !/^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(expected)) {
    authError("HTTPS is required for operator login", 403);
  }
}

function sessionCookie(req, value, maxAge) {
  const origin = originOf(req);
  const secure = origin?.startsWith("https://") ? "; Secure" : "";
  return `${COOKIE_NAME}=${value}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

export function createOperatorSession(req, res, suppliedSecret) {
  requireSameOrigin(req);
  const secret = operatorSecret();
  if (typeof suppliedSecret !== "string" || !equalSecret(suppliedSecret, secret)) {
    authError("Invalid operator secret");
  }
  const exp = Date.now() + SESSION_MS;
  const payload = { v: 1, exp, nonce: randomBytes(24).toString("base64url") };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(encoded, secret);
  res.setHeader("Set-Cookie", sessionCookie(req, `${encoded}.${signature}`, Math.floor(SESSION_MS / 1000)));
  return { authenticated: true, csrfToken: sign(`${encoded}.${signature}:csrf`, secret),
    expiresAt: new Date(exp).toISOString() };
}

export function operatorSession(req) {
  const secret = process.env.STONK_TRADING_SECRET;
  if (!secret) return { authenticated: false };
  const session = sessionFromCookie(req, secret);
  return session ? { authenticated: true, csrfToken: session.csrfToken,
    expiresAt: new Date(session.exp).toISOString() } : { authenticated: false };
}

export function clearOperatorSession(req, res) {
  requireSameOrigin(req);
  requireOperator(req, { mutation: true });
  res.setHeader("Set-Cookie", sessionCookie(req, "", 0));
}

export function requireOperator(req, { mutation = false } = {}) {
  const secret = operatorSecret();
  const authorization = String(req.headers?.authorization || "");
  if (authorization) {
    if (!equalSecret(authorization, `Bearer ${secret}`)) authError("Operator authorization required");
    return { type: "bearer" };
  }
  const session = sessionFromCookie(req, secret);
  if (!session) authError("Operator authorization required");
  if (mutation) {
    requireSameOrigin(req);
    const supplied = String(req.headers?.["x-csrf-token"] || "");
    if (!supplied || !equalSecret(supplied, session.csrfToken)) authError("CSRF token required", 403);
  }
  return { type: "session", expiresAt: session.exp };
}
