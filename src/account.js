// Customer identity and watchlists use Supabase Auth and owner-scoped RLS only.
// The publishable key is public by design; no broker credentials live here.
const PROJECT_URL = "https://rbkcgfxmhqvkzkpfpabf.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_0Oh2W6upXzlCC0zRK-iCOQ_ym_3PPvC";
const SESSION_KEY = "stonk.customer.session.v1";
const TICKER_PATTERN = /^[A-Z0-9][A-Z0-9.\-]{0,14}$/;
const $ = (selector) => document.querySelector(selector);

let session = null;
let user = null;
let watchlist = [];
let watchlistReady = false;
let refreshPromise = null;
let recoveryMode = false;

class RequestError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function setNotice(selector, message = "", tone = "") {
  const element = $(selector);
  element.textContent = message;
  element.hidden = !message;
  if (tone) element.dataset.tone = tone;
  else delete element.dataset.tone;
}

function markInvalid(input, invalid) {
  if (invalid) input.setAttribute("aria-invalid", "true");
  else input.removeAttribute("aria-invalid");
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  if (busy) {
    button.dataset.originalLabel = button.innerHTML;
    button.textContent = label;
  } else if (button.dataset.originalLabel) {
    button.innerHTML = button.dataset.originalLabel;
    delete button.dataset.originalLabel;
  }
}

function saveSession(value) {
  session = {
    access_token: value.access_token,
    refresh_token: value.refresh_token || session?.refresh_token,
    expires_at: Date.now() + Number(value.expires_in || 3600) * 1000,
    user: value.user || session?.user || null,
  };
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* In-memory session still works for this page. */ }
}

function clearSession() {
  session = null;
  user = null;
  watchlist = [];
  watchlistReady = false;
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* Storage can be disabled. */ }
}

function readSession() {
  try {
    const value = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
    if (value?.access_token && value?.refresh_token && Number.isFinite(value.expires_at)) return value;
  } catch { /* Ignore damaged or blocked tab storage. */ }
  return null;
}

async function request(path, { method = "GET", body, token, headers = {} } = {}) {
  let response;
  try {
    response = await fetch(`${PROJECT_URL}${path}`, {
      method,
      headers: {
        apikey: PUBLISHABLE_KEY,
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
      credentials: "omit",
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new RequestError("Could not reach the account service. Check your connection and try again.", 0, "network_error");
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new RequestError(payload?.msg || payload?.message || payload?.error_description || payload?.error || `Request failed (${response.status}).`, response.status, payload?.error_code || payload?.code || "");
  }
  return payload;
}

function friendlyError(error) {
  if (error.status === 429) return "Too many attempts. Please wait a little and try again.";
  if (error.code === "invalid_credentials" || /invalid login credentials/i.test(error.message)) return "Email or password is incorrect.";
  if (error.code === "email_not_confirmed" || /email not confirmed/i.test(error.message)) return "Please confirm your email before signing in.";
  if (error.code === "user_already_exists" || /already registered/i.test(error.message)) return "This email may already have an account. Try signing in.";
  if (error.code === "email_address_not_authorized" || /email address not authorized/i.test(error.message)) return "Account email cannot be sent right now. Please try again later.";
  if (error.code === "signup_disabled") return "New account creation is unavailable right now.";
  return error.message || "Something went wrong. Please try again.";
}

function showAuthMode(mode) {
  const isLogin = mode === "login";
  $("#loginForm").hidden = !isLogin;
  $("#signupForm").hidden = mode !== "signup";
  $("#recoveryForm").hidden = mode !== "recovery";
  $("#resetForm").hidden = mode !== "reset";
  $("#authTabs").hidden = mode === "recovery" || mode === "reset";
  $("#showLogin").setAttribute("aria-pressed", String(isLogin));
  $("#showSignup").setAttribute("aria-pressed", String(mode === "signup"));
  $("#auth-title").textContent = mode === "recovery" ? "Reset your password" : mode === "reset" ? "Choose a new password" : "Welcome to Stonk";
  setNotice("#authNotice");
}

function renderAccount() {
  const signedIn = Boolean(user && session && !recoveryMode);
  $("#signedOut").hidden = signedIn;
  $("#signedIn").hidden = !signedIn;
  if (signedIn) {
    $("#accountEmail").textContent = user.email || "Email unavailable";
    $("#watchCount").textContent = watchlistReady ? String(watchlist.length) : "—";
  }
}

async function refreshSession() {
  if (!session?.refresh_token) throw new RequestError("Your session has ended. Please sign in again.", 401, "session_expired");
  if (!refreshPromise) {
    refreshPromise = request("/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      body: { refresh_token: session.refresh_token },
    }).then((payload) => {
      if (!payload?.access_token) throw new RequestError("Your session has ended. Please sign in again.", 401, "session_expired");
      saveSession(payload);
      return session.access_token;
    }).finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

async function accessToken() {
  if (!session) throw new RequestError("Please sign in to use your watchlist.", 401, "session_missing");
  if (Date.now() >= session.expires_at - 60000) return refreshSession();
  return session.access_token;
}

async function authenticatedRequest(path, options = {}) {
  let token = await accessToken();
  try { return await request(path, { ...options, token }); }
  catch (error) {
    if (error.status !== 401 || error.code === "42501") throw error;
    token = await refreshSession();
    return request(path, { ...options, token });
  }
}

async function verifyUser() {
  const verified = await authenticatedRequest("/auth/v1/user");
  if (!verified?.id) throw new RequestError("Could not verify this session. Please sign in again.", 401, "session_invalid");
  user = verified;
  if (session) saveSession({ ...session, user: verified, expires_in: Math.max(1, Math.floor((session.expires_at - Date.now()) / 1000)) });
}

function showSessionError(error) {
  if (error.status === 400 || error.status === 401 || error.status === 403) {
    clearSession();
    renderAccount();
    setNotice("#authNotice", "Your session ended. Please sign in again.", "error");
    return;
  }
  setNotice("#globalNotice", friendlyError(error), "error");
}

function watchlistUnavailable(error) {
  if (error.code === "PGRST205" || error.status === 404) return "Cloud watchlists are not ready for this project yet. Your account sign-in still works.";
  if (error.status === 403 || error.code === "42501") return "This watchlist is unavailable because access has not been granted to your account.";
  if (error.status === 401) return "Your session ended. Please sign in again.";
  return `Could not load your watchlist. ${friendlyError(error)}`;
}

function renderWatchlist() {
  const container = $("#watchList");
  container.replaceChildren();
  $("#watchCount").textContent = watchlistReady ? String(watchlist.length) : "—";
  if (!watchlistReady) {
    const empty = document.createElement("div");
    empty.className = "empty-watch";
    empty.textContent = "Watchlist unavailable. Try reloading this page later.";
    container.append(empty);
    return;
  }
  if (!watchlist.length) {
    const empty = document.createElement("div");
    empty.className = "empty-watch";
    empty.textContent = "No symbols saved yet. Add a ticker above to start your research list.";
    container.append(empty);
    return;
  }
  for (const item of watchlist) {
    const ticker = item.ticker;
    const row = document.createElement("div");
    row.className = "watch-row";
    const icon = document.createElement("span");
    icon.className = "ticker-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = ticker.slice(0, 1);
    const detail = document.createElement("div");
    const link = document.createElement("a");
    link.href = `/?ticker=${encodeURIComponent(ticker)}`;
    link.textContent = ticker;
    const sub = document.createElement("small");
    sub.textContent = "Open research ↗";
    detail.append(link, sub);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-button";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${ticker} from watchlist`);
    remove.addEventListener("click", () => removeTicker(ticker, remove));
    row.append(icon, detail, remove);
    container.append(row);
  }
}

async function loadWatchlist() {
  try {
    const rows = await authenticatedRequest("/rest/v1/user_watchlist?select=ticker,created_at&order=created_at.desc");
    if (!Array.isArray(rows)) throw new RequestError("The watchlist response was incomplete.", 0, "bad_response");
    watchlist = rows.filter((row) => typeof row.ticker === "string" && TICKER_PATTERN.test(row.ticker));
    watchlistReady = true;
    setNotice("#watchNotice");
    renderWatchlist();
  } catch (error) {
    watchlistReady = false;
    renderWatchlist();
    setNotice("#watchNotice", watchlistUnavailable(error), "error");
    if (error.status === 401 && error.code !== "42501") showSessionError(error);
  }
}

async function addTicker(event) {
  event.preventDefault();
  const input = $("#watchTicker");
  const ticker = input.value.trim().toUpperCase();
  markInvalid(input, false);
  if (!TICKER_PATTERN.test(ticker)) {
    markInvalid(input, true);
    setNotice("#watchNotice", "Enter a ticker using 1–15 letters, numbers, periods, or hyphens.", "error");
    input.focus();
    return;
  }
  if (watchlist.some((item) => item.ticker === ticker)) {
    setNotice("#watchNotice", `${ticker} is already on your watchlist.`, "error");
    return;
  }
  if (!user?.id) {
    setNotice("#watchNotice", "Please sign in again before saving a symbol.", "error");
    return;
  }
  const button = $("#watchSubmit");
  setBusy(button, true, "Saving…");
  try {
    let lookup;
    try {
      lookup = await fetch(`/api/lookup?ticker=${encodeURIComponent(ticker)}`, {
        cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new RequestError("Could not verify this symbol against the U.S. listings directory. Try again shortly.", 0, "lookup_unavailable");
    }
    if (!lookup.ok) throw new RequestError("Could not verify this symbol against the U.S. listings directory. Try again shortly.", lookup.status, "lookup_unavailable");
    const listing = await lookup.json().catch(() => null);
    if (listing?.company?.ticker !== ticker) throw new RequestError(`${ticker} is not in the supported U.S. listings directory.`, 400, "unsupported_ticker");
    await authenticatedRequest("/rest/v1/user_watchlist", {
      method: "POST",
      body: { user_id: user.id, ticker },
      headers: { Prefer: "return=minimal" },
    });
    input.value = "";
    await loadWatchlist();
    if (watchlistReady) setNotice("#watchNotice", `${ticker} added to your watchlist.`, "success");
  } catch (error) {
    if (error.code === "23505") setNotice("#watchNotice", `${ticker} is already on your watchlist.`, "error");
    else setNotice("#watchNotice", `Could not save ${ticker}. ${friendlyError(error)}`, "error");
    if (error.status === 401 && error.code !== "42501") showSessionError(error);
  } finally { setBusy(button, false); }
}

async function removeTicker(ticker, button) {
  setBusy(button, true, "Removing…");
  try {
    const filter = `user_id=eq.${encodeURIComponent(user.id)}&ticker=eq.${encodeURIComponent(ticker)}`;
    await authenticatedRequest(`/rest/v1/user_watchlist?${filter}`, { method: "DELETE" });
    await loadWatchlist();
    if (watchlistReady) setNotice("#watchNotice", `${ticker} removed from your watchlist.`, "success");
  } catch (error) {
    setNotice("#watchNotice", `Could not remove ${ticker}. ${friendlyError(error)}`, "error");
    if (error.status === 401 && error.code !== "42501") showSessionError(error);
  } finally { setBusy(button, false); }
}

async function signIn(event) {
  event.preventDefault();
  const email = $("#loginEmail");
  const password = $("#loginPassword");
  const value = email.value.trim();
  markInvalid(email, false); markInvalid(password, false);
  if (!email.validity.valid || !value) {
    markInvalid(email, true);
    setNotice("#authNotice", "Enter a valid email address.", "error");
    email.focus();
    return;
  }
  if (!password.value) {
    markInvalid(password, true);
    setNotice("#authNotice", "Enter your password.", "error");
    password.focus();
    return;
  }
  const button = $("#loginSubmit");
  setBusy(button, true, "Signing in…");
  setNotice("#authNotice");
  try {
    const payload = await request("/auth/v1/token?grant_type=password", {
      method: "POST", body: { email: value, password: password.value },
    });
    if (!payload?.access_token || !payload?.refresh_token) throw new RequestError("Sign-in did not return a session. Please try again.", 0, "bad_response");
    saveSession(payload);
    password.value = "";
    await verifyUser();
    renderAccount();
    setNotice("#globalNotice", "Signed in. Your watchlist is ready for research.", "success");
    await loadWatchlist();
  } catch (error) {
    password.value = "";
    if (session && !user) clearSession();
    setNotice("#authNotice", friendlyError(error), "error");
  } finally { setBusy(button, false); }
}

async function signUp(event) {
  event.preventDefault();
  const email = $("#signupEmail");
  const password = $("#signupPassword");
  const confirm = $("#signupConfirm");
  const value = email.value.trim();
  [email, password, confirm].forEach((field) => markInvalid(field, false));
  if (!email.validity.valid || !value) {
    markInvalid(email, true);
    setNotice("#authNotice", "Enter a valid email address.", "error");
    email.focus();
    return;
  }
  if (password.value.length < 8) {
    markInvalid(password, true);
    setNotice("#authNotice", "Choose a password with at least 8 characters.", "error");
    password.focus();
    return;
  }
  if (password.value !== confirm.value) {
    markInvalid(confirm, true);
    setNotice("#authNotice", "The passwords do not match.", "error");
    confirm.focus();
    return;
  }
  const button = $("#signupSubmit");
  setBusy(button, true, "Creating account…");
  setNotice("#authNotice");
  try {
    const redirect = encodeURIComponent(`${window.location.origin}/account.html`);
    const payload = await request(`/auth/v1/signup?redirect_to=${redirect}`, {
      method: "POST", body: { email: value, password: password.value },
    });
    password.value = ""; confirm.value = "";
    if (payload?.access_token && payload?.refresh_token) {
      saveSession(payload);
      await verifyUser();
      renderAccount();
      setNotice("#globalNotice", "Account created. Your watchlist is ready for research.", "success");
      await loadWatchlist();
    } else if (payload?.user?.id) {
      showAuthMode("login");
      $("#loginEmail").value = value;
      setNotice("#authNotice", "Check your email for a confirmation link if one is required, then return here to sign in.", "success");
    } else {
      throw new RequestError("Account creation did not complete. Please try again.", 0, "bad_response");
    }
  } catch (error) {
    password.value = ""; confirm.value = "";
    if (session && !user) clearSession();
    setNotice("#authNotice", friendlyError(error), "error");
  } finally { setBusy(button, false); }
}

async function signOut() {
  const token = session?.access_token;
  const button = $("#logoutButton");
  setBusy(button, true, "Signing out…");
  clearSession();
  renderAccount();
  setNotice("#globalNotice", "Signed out of this tab.", "success");
  try {
    if (token) await request("/auth/v1/logout", { method: "POST", token });
  } catch {
    setNotice("#globalNotice", "Signed out of this tab. Server sign-out could not be confirmed; close any other signed-in tabs.", "error");
  } finally { setBusy(button, false); }
}

async function sendRecovery(event) {
  event.preventDefault();
  const email = $("#recoveryEmail");
  const value = email.value.trim();
  markInvalid(email, false);
  if (!email.validity.valid || !value) {
    markInvalid(email, true);
    setNotice("#authNotice", "Enter a valid email address.", "error");
    email.focus();
    return;
  }
  const button = $("#recoverySubmit");
  setBusy(button, true, "Sending link…");
  setNotice("#authNotice");
  try {
    const redirect = encodeURIComponent(`${window.location.origin}/account.html`);
    await request(`/auth/v1/recover?redirect_to=${redirect}`, {
      method: "POST", body: { email: value },
    });
    showAuthMode("login");
    $("#loginEmail").value = value;
    setNotice("#authNotice", "If this email has an account, check your inbox for a password reset link. The link may take a few minutes to arrive.", "success");
  } catch (error) {
    setNotice("#authNotice", friendlyError(error), "error");
  } finally { setBusy(button, false); }
}

async function updatePassword(event) {
  event.preventDefault();
  const password = $("#resetPassword");
  const confirm = $("#resetConfirm");
  markInvalid(password, false); markInvalid(confirm, false);
  if (password.value.length < 8) {
    markInvalid(password, true);
    setNotice("#authNotice", "Choose a password with at least 8 characters.", "error");
    password.focus();
    return;
  }
  if (password.value !== confirm.value) {
    markInvalid(confirm, true);
    setNotice("#authNotice", "The passwords do not match.", "error");
    confirm.focus();
    return;
  }
  const button = $("#resetSubmit");
  setBusy(button, true, "Updating…");
  try {
    await authenticatedRequest("/auth/v1/user", { method: "PUT", body: { password: password.value } });
    password.value = ""; confirm.value = "";
    try { await authenticatedRequest("/auth/v1/logout", { method: "POST" }); } catch { /* Local credentials are cleared below. */ }
    clearSession();
    recoveryMode = false;
    renderAccount();
    showAuthMode("login");
    setNotice("#authNotice", "Password updated. Sign in with your new password.", "success");
  } catch (error) {
    password.value = ""; confirm.value = "";
    setNotice("#authNotice", friendlyError(error), "error");
    if (error.status === 401) showSessionError(error);
  } finally { setBusy(button, false); }
}

async function restore() {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const redirectType = fragment.get("type");
  const redirectError = fragment.get("error") || fragment.get("error_code");
  if (redirectError) {
    history.replaceState(null, "", window.location.pathname + window.location.search);
    renderAccount();
    showAuthMode("recovery");
    setNotice("#authNotice", "This account link is invalid or expired. Request a new password reset link.", "error");
    return;
  }
  if (["recovery", "signup", "email"].includes(redirectType) && fragment.get("access_token") && fragment.get("refresh_token")) {
    const redirectSession = {
      access_token: fragment.get("access_token"), refresh_token: fragment.get("refresh_token"),
      expires_in: Number(fragment.get("expires_in")) || 3600,
    };
    history.replaceState(null, "", window.location.pathname + window.location.search);
    recoveryMode = redirectType === "recovery";
    saveSession(redirectSession);
    try {
      await verifyUser();
      renderAccount();
      if (recoveryMode) {
        showAuthMode("reset");
        setNotice("#authNotice", "Your reset link is verified. Choose a new password below.", "success");
      } else {
        setNotice("#globalNotice", "Email confirmed. Your account is ready.", "success");
        await loadWatchlist();
      }
    } catch (error) { showSessionError(error); }
    return;
  }
  session = readSession();
  if (!session) { renderAccount(); return; }
  try {
    await verifyUser();
    renderAccount();
    await loadWatchlist();
  } catch (error) { showSessionError(error); }
}

$("#showLogin").addEventListener("click", () => showAuthMode("login"));
$("#showSignup").addEventListener("click", () => showAuthMode("signup"));
$("#showRecovery").addEventListener("click", () => {
  showAuthMode("recovery");
  $("#recoveryEmail").value = $("#loginEmail").value.trim();
});
$("#backToLogin").addEventListener("click", () => showAuthMode("login"));
$("#loginForm").addEventListener("submit", signIn);
$("#signupForm").addEventListener("submit", signUp);
$("#recoveryForm").addEventListener("submit", sendRecovery);
$("#resetForm").addEventListener("submit", updatePassword);
$("#watchForm").addEventListener("submit", addTicker);
$("#logoutButton").addEventListener("click", signOut);
restore();
