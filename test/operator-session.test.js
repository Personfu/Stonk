import test from "node:test";
import assert from "node:assert/strict";
import sessionHandler from "../api/operator-session.js";
import optionsHandler from "../api/options.js";
import orderHandler from "../api/order.js";
import { requireOperator } from "../api/_lib/http.js";

function response() {
  return {
    statusCode: 200, headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(value) { this.body = JSON.parse(value); },
  };
}

function req(method, { body, cookie, csrfToken, origin = "http://localhost:3000", authorization } = {}) {
  return { method, url: "/api/operator-session", body, headers: {
    host: "localhost:3000", origin,
    ...(cookie ? { cookie } : {}),
    ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
    ...(authorization ? { authorization } : {}),
  } };
}

test("operator login signs a bounded HttpOnly cookie; CSRF and origin gate mutation", async () => {
  const previous = process.env.STONK_TRADING_SECRET;
  process.env.STONK_TRADING_SECRET = "a-test-operator-secret-that-is-long-enough";
  try {
    const badOrigin = response();
    await sessionHandler(req("POST", { body: { secret: process.env.STONK_TRADING_SECRET },
      origin: "https://attacker.example" }), badOrigin);
    assert.equal(badOrigin.statusCode, 403);
    assert.equal(badOrigin.headers["set-cookie"], undefined);

    const wrong = response();
    await sessionHandler(req("POST", { body: { secret: "wrong" } }), wrong);
    assert.equal(wrong.statusCode, 401);
    assert.equal(wrong.headers["set-cookie"], undefined);

    const login = response();
    await sessionHandler(req("POST", { body: { secret: process.env.STONK_TRADING_SECRET } }), login);
    assert.equal(login.statusCode, 200);
    assert.equal(login.body.authenticated, true);
    assert.ok(login.body.csrfToken);
    assert.match(login.headers["set-cookie"], /HttpOnly; SameSite=Strict; Max-Age=28800/);
    assert.match(login.headers["set-cookie"], /Path=\/api/);
    assert.doesNotMatch(JSON.stringify(login.body), /a-test-operator-secret/);

    const cookie = login.headers["set-cookie"].split(";")[0];
    const current = response();
    await sessionHandler(req("GET", { cookie }), current);
    assert.equal(current.body.authenticated, true);
    assert.equal(current.body.csrfToken, login.body.csrfToken);

    const tampered = response();
    await sessionHandler(req("GET", { cookie: cookie.replace(/.$/, "X") }), tampered);
    assert.equal(tampered.body.authenticated, false);

    const cookieRequest = req("POST", { cookie, csrfToken: login.body.csrfToken });
    assert.equal(requireOperator(cookieRequest, { mutation: true }).type, "session");
    assert.throws(() => requireOperator(req("POST", { cookie }), { mutation: true }), /CSRF/);
    assert.throws(() => requireOperator(req("POST", { cookie, csrfToken: login.body.csrfToken,
      origin: "https://attacker.example" }), { mutation: true }), /Same-origin/);
    assert.equal(requireOperator(req("POST", {
      authorization: `Bearer ${process.env.STONK_TRADING_SECRET}`,
    }), { mutation: true }).type, "bearer");

    const logout = response();
    await sessionHandler(req("DELETE", { cookie, csrfToken: login.body.csrfToken }), logout);
    assert.equal(logout.statusCode, 200);
    assert.match(logout.headers["set-cookie"], /Max-Age=0/);
  } finally {
    if (previous === undefined) delete process.env.STONK_TRADING_SECRET;
    else process.env.STONK_TRADING_SECRET = previous;
  }
});

test("costly option scan and cookie-based order reject unauthenticated or CSRF-free requests before broker calls", async () => {
  const previous = process.env.STONK_TRADING_SECRET;
  const previousFetch = global.fetch;
  process.env.STONK_TRADING_SECRET = "a-test-operator-secret-that-is-long-enough";
  let calls = 0;
  global.fetch = async () => { calls++; throw new Error("Broker should not be contacted"); };
  try {
    const options = response();
    await optionsHandler({ method: "GET", url: "/api/options?symbol=AAPL", headers: {} }, options);
    assert.equal(options.statusCode, 401);

    const login = response();
    await sessionHandler(req("POST", { body: { secret: process.env.STONK_TRADING_SECRET } }), login);
    const cookie = login.headers["set-cookie"].split(";")[0];
    const unsafeOrder = { order_class: "mleg", type: "limit", qty: "1", limit_price: "1.00",
      time_in_force: "day", legs: [] };
    const noCsrf = response();
    await orderHandler({ ...req("POST", { cookie }), url: "/api/order",
      body: { order: unsafeOrder, execute: true } }, noCsrf);
    assert.equal(noCsrf.statusCode, 403);
    assert.equal(calls, 0);
  } finally {
    if (previous === undefined) delete process.env.STONK_TRADING_SECRET;
    else process.env.STONK_TRADING_SECRET = previous;
    global.fetch = previousFetch;
  }
});
