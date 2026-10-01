const PROJECT_URL = "https://rbkcgfxmhqvkzkpfpabf.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_0Oh2W6upXzlCC0zRK-iCOQ_ym_3PPvC";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function reject(message, status) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

export async function customerBrokerBinding(req, { env = process.env, fetchImpl = fetch } = {}) {
  const authorization = String(req.headers?.authorization || "");
  const match = /^Bearer ([A-Za-z0-9._-]{20,4096})$/.exec(authorization);
  if (!match) reject("Customer sign-in required", 401);

  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) reject("Customer brokerage is not configured", 503);

  let identityResponse;
  try {
    identityResponse = await fetchImpl(`${PROJECT_URL}/auth/v1/user`, {
      headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${match[1]}` },
      cache: "no-store", signal: AbortSignal.timeout(10000),
    });
  } catch { reject("Customer identity service did not respond", 503); }
  if (!identityResponse.ok) reject("Customer sign-in expired", 401);
  const identity = await identityResponse.json().catch(() => null);
  if (!UUID.test(identity?.id) || !identity?.email_confirmed_at) reject("Verified customer sign-in required", 401);

  const url = new URL(`${PROJECT_URL}/rest/v1/customer_broker_accounts`);
  url.searchParams.set("select", "broker_account_id,broker_environment");
  url.searchParams.set("user_id", `eq.${identity.id}`);
  url.searchParams.set("limit", "1");
  let bindingResponse;
  try {
    bindingResponse = await fetchImpl(url, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      cache: "no-store", signal: AbortSignal.timeout(10000),
    });
  } catch { reject("Customer account mapping did not respond", 503); }
  if (!bindingResponse.ok) reject("Customer account mapping is unavailable", 503);
  const rows = await bindingResponse.json().catch(() => null);
  if (!Array.isArray(rows) || rows.length > 1) reject("Customer account mapping is invalid", 503);
  if (rows.length === 0) return { userId: identity.id, binding: null };
  const binding = rows[0];
  if (!UUID.test(binding?.broker_account_id) || !["sandbox", "live"].includes(binding?.broker_environment)) {
    reject("Customer account mapping is invalid", 503);
  }
  return { userId: identity.id, binding: {
    accountId: binding.broker_account_id, environment: binding.broker_environment,
  } };
}

