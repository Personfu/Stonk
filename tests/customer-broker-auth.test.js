import assert from "node:assert/strict";
import { test } from "node:test";
import { customerBrokerBinding } from "../api/_lib/customer-broker-auth.js";

const USER = "9c70bc6a-af19-4bdf-bbfb-6e18540008f5";
const ACCOUNT = "4e902967-cb7e-4a5d-a30a-bf9b93d5e1c9";
const env = { SUPABASE_SERVICE_ROLE_KEY: "test-service-key" };
const req = { headers: { authorization: `Bearer ${"a".repeat(80)}` } };

test("customer broker binding requires a verified session and server credential", async () => {
  await assert.rejects(() => customerBrokerBinding({ headers: {} }, { env }), /sign-in required/);
  await assert.rejects(() => customerBrokerBinding(req, { env: {} }), /not configured/);
  await assert.rejects(() => customerBrokerBinding(req, { env, fetchImpl: async () => ({
    ok: true, json: async () => ({ id: USER }),
  }) }), /Verified customer sign-in required/);
});

test("customer broker lookup is scoped to the identity returned by Supabase", async () => {
  const calls = [];
  const result = await customerBrokerBinding(req, { env, fetchImpl: async (url, options) => {
    calls.push({ url: String(url), options });
    return calls.length === 1 ? { ok: true, json: async () => ({
      id: USER, email_confirmed_at: "2026-09-30T00:00:00Z",
    }) } : { ok: true, json: async () => [{
      broker_account_id: ACCOUNT, broker_environment: "sandbox",
    }] };
  } });
  assert.deepEqual(result, { userId: USER, binding: { accountId: ACCOUNT, environment: "sandbox" } });
  const mapping = new URL(calls[1].url);
  assert.equal(mapping.searchParams.get("user_id"), `eq.${USER}`);
  assert.equal(calls[1].options.headers.apikey, env.SUPABASE_SERVICE_ROLE_KEY);
  assert.equal(calls[0].options.headers.Authorization, req.headers.authorization);
});

test("customer broker lookup rejects malformed or cross-environment mappings", async () => {
  let count = 0;
  await assert.rejects(() => customerBrokerBinding(req, { env, fetchImpl: async () => {
    count++;
    return count === 1 ? { ok: true, json: async () => ({
      id: USER, email_confirmed_at: "2026-09-30T00:00:00Z",
    }) } : { ok: true, json: async () => [{
      broker_account_id: "someone-else", broker_environment: "live",
    }] };
  } }), /mapping is invalid/);
});

