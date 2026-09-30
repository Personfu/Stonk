import test from "node:test";
import assert from "node:assert/strict";
import lookup from "../api/lookup.js";

function request(query, method = "GET") {
  return new Promise((resolve) => {
    const res = {
      code: 200,
      headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      status(code) { this.code = code; return this; },
      json(body) { resolve({ status: this.code, body, headers: this.headers }); },
    };
    lookup({ method, query }, res);
  });
}

test("exact ticker lookup returns a listed-security identity offline", async () => {
  const result = await request({ ticker: "gm" });
  assert.equal(result.status, 200);
  assert.equal(result.body.company.ticker, "GM");
  assert.match(result.body.company.name, /General Motors/i);
  assert.equal(result.body.company.exchange, "NYSE");
  assert.equal(result.body.company.asOf, "2026-09-29");
});

test("search spans companies beyond the seeded GM profile", async () => {
  const result = await request({ q: "Tesla" });
  assert.equal(result.status, 200);
  assert.equal(result.body.companies[0].ticker, "TSLA");
  assert.equal(result.body.asOf, "2026-09-29");
});

test("invalid ticker and method are rejected", async () => {
  assert.equal((await request({ ticker: "GM/../../" })).status, 400);
  assert.equal((await request({ ticker: "GM" }, "POST")).status, 405);
});
