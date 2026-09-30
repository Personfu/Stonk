const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"]/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
}[character]));
const safeTicker = (value) => /^[A-Z0-9][A-Z0-9.\-]{0,14}$/.test(String(value || "").toUpperCase())
  ? String(value).toUpperCase() : null;
const initialTicker = safeTicker(new URLSearchParams(location.search).get("ticker"));
let symbol = initialTicker || "SPY";
let operatorSession = { authenticated: false, csrfToken: null, expiresAt: null };
let sessionExpiryTimer = null;
let sessionRequestVersion = 0;
let authEpoch = 0;
const loaded = new Set();

function money(value) {
  const number = Number(value);
  return value === null || value === undefined || !Number.isFinite(number) ? "—" :
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(number);
}

function number(value, digits = 2) {
  const parsed = Number(value);
  return value === null || value === undefined || !Number.isFinite(parsed) ? "—" : parsed.toFixed(digits);
}

function tone(value) {
  const parsed = Number(value);
  return !Number.isFinite(parsed) || parsed === 0 ? "" : parsed > 0 ? "positive" : "negative";
}

function metric(label, value, className = "") {
  return `<div class="metric"><span>${escapeHtml(label)}</span><b class="${className}">${escapeHtml(value)}</b></div>`;
}

function rows(items, formatter, empty = "No data available") {
  return (items || []).map(formatter).join("") || `<div class="empty-state">${escapeHtml(empty)}</div>`;
}

function errorText(error) {
  const message = String(error?.message || "Unable to load data");
  if (message.includes("credentials") || message.includes("not configured") || message.includes("Upstream or server error")) {
    return "Data unavailable. Configure the live Alpaca credentials and refresh.";
  }
  return message;
}

async function api(path, options = {}) {
  const { headers = {}, ...requestOptions } = options;
  const response = await fetch(path, {
    ...requestOptions,
    credentials: "same-origin",
    headers: { accept: "application/json", ...headers },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function setStatus(label, state) {
  const target = $("#status");
  target.textContent = label;
  target.dataset.state = state;
}

function showOperatorSession(payload, message) {
  const wasAuthenticated = operatorSession.authenticated;
  const previousToken = operatorSession.csrfToken;
  operatorSession = {
    authenticated: payload?.authenticated === true,
    csrfToken: payload?.authenticated === true && typeof payload.csrfToken === "string" ? payload.csrfToken : null,
    expiresAt: payload?.authenticated === true ? payload.expiresAt || null : null,
  };
  if (wasAuthenticated !== operatorSession.authenticated || previousToken !== operatorSession.csrfToken) {
    authEpoch += 1;
    loaded.delete("automation");
  }
  clearTimeout(sessionExpiryTimer);
  sessionExpiryTimer = null;
  const authenticated = operatorSession.authenticated;
  $("#operatorLogin").hidden = authenticated;
  $("#operatorConnected").hidden = !authenticated;
  $("#operatorMessage").textContent = message || (authenticated
    ? "Desk unlocked for this browser session. Account data is fetched from the server."
    : "Private desk locked. Sign in to view the live account and scan options.");
  const expiry = operatorSession.expiresAt && new Date(operatorSession.expiresAt);
  $("#operatorExpiry").textContent = expiry && Number.isFinite(expiry.getTime())
    ? `Session expires ${expiry.toLocaleString()}` : "Session active";
  if (authenticated && expiry && Number.isFinite(expiry.getTime())) {
    const remaining = expiry.getTime() - Date.now();
    if (remaining <= 0) {
      showOperatorSession({ authenticated: false }, "Your desk session expired. Sign in again.");
      return;
    }
    sessionExpiryTimer = setTimeout(() => {
      showOperatorSession({ authenticated: false }, "Your desk session expired. Sign in again.");
    }, remaining + 50);
  }
  if (!authenticated) {
    $("#operatorSecret").value = "";
    $("#accountCards").innerHTML = '<div class="empty-state">Private desk locked. Unlock above to check the live broker account.</div>';
    showLockedOptions();
    loaded.delete("account");
    loaded.delete("options");
    setStatus("DESK LOCKED", "locked");
  } else {
    setStatus("ACCOUNT UNVERIFIED", "unverified");
  }
}

async function refreshOperatorSession() {
  const requestVersion = ++sessionRequestVersion;
  try {
    const result = await api("/api/operator-session");
    if (requestVersion !== sessionRequestVersion) return operatorSession.authenticated;
    showOperatorSession(result);
    return operatorSession.authenticated;
  } catch {
    if (requestVersion !== sessionRequestVersion) return operatorSession.authenticated;
    showOperatorSession({ authenticated: false }, "Operator session unavailable. Check the server connection and try again.");
    return false;
  }
}

function showLockedOptions() {
  $("#optionSummary").innerHTML = metric("Access", "DESK LOCKED");
  $("#candidates").innerHTML = '<tr><td colspan="7">Unlock the private desk in Broker account to scan options.</td></tr>';
}

function setTab(id) {
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.id === id));
  document.querySelectorAll(".tabs button").forEach((button) => button.classList.toggle("active", button.dataset.tab === id));
  if (loaded.has(id)) return;
  loaded.add(id);
  ({ market: loadMarket, options: loadOptions, intelligence: loadIntelligence,
    research: loadResearch, account: loadAccount, automation: loadHealth }[id])?.();
}

async function loadHealth() {
  try {
    await api("/api/health");
    $("#automationState").innerHTML =
      metric("Service", "ONLINE") +
      metric("Operator desk", operatorSession.authenticated ? "UNLOCKED" : "LOCKED") +
      metric("Broker status", "CHECK ACCOUNT") +
      metric("Execution", "SERVER CONTROLLED");
  } catch {
    setStatus("SERVER UNAVAILABLE", "offline");
    $("#automationState").innerHTML = metric("Server", "UNAVAILABLE");
  }
}

async function loadMarket() {
  for (const selector of ["#gainers", "#losers", "#actives"]) $(selector).innerHTML = '<div class="muted">Checking market feed…</div>';
  try {
    const result = await api("/api/market");
    $("#gainers").innerHTML = rows(result.movers?.gainers, (item) =>
      `<div class="row"><b>${escapeHtml(item.symbol)}</b><span class="positive">+${number(item.percent_change)}%</span></div>`);
    $("#losers").innerHTML = rows(result.movers?.losers, (item) =>
      `<div class="row"><b>${escapeHtml(item.symbol)}</b><span class="negative">${number(item.percent_change)}%</span></div>`);
    $("#actives").innerHTML = rows(result.actives?.most_actives, (item) =>
      `<div class="row"><b>${escapeHtml(item.symbol)}</b><span>${Number(item.volume || 0).toLocaleString()}</span></div>`);
  } catch (error) {
    const message = `<div class="empty-state">${escapeHtml(errorText(error))}</div>`;
    for (const selector of ["#gainers", "#losers", "#actives"]) $(selector).innerHTML = message;
  }
}

async function loadOptions() {
  $("#candidates").innerHTML = '<tr><td colspan="7">Scanning option chain…</td></tr>';
  if (!await refreshOperatorSession()) {
    showLockedOptions();
    return;
  }
  const requestEpoch = authEpoch;
  try {
    const result = await api(`/api/options?symbol=${encodeURIComponent(symbol)}&minDte=7&maxDte=45`);
    if (requestEpoch !== authEpoch || !operatorSession.authenticated) return;
    const signal = result.signal || {};
    $("#optionSummary").innerHTML =
      metric("Ticker", result.symbol) +
      metric("Trend", String(signal.direction || "neutral").toUpperCase()) +
      metric("Signal confidence", `${signal.confidence ?? 0}%`) +
      metric("5D return", signal.return5 == null ? "—" : `${number(signal.return5 * 100)}%`, tone(signal.return5)) +
      metric("20D return", signal.return20 == null ? "—" : `${number(signal.return20 * 100)}%`, tone(signal.return20)) +
      metric("Realized vol", signal.realizedVol == null ? "—" : `${number(signal.realizedVol * 100, 1)}%`) +
      metric("Contracts", result.contractCount ?? "—") +
      metric("Candidates", result.candidates?.length ?? 0);
    $("#candidates").innerHTML = (result.candidates || []).slice(0, 30).map((candidate) =>
      `<tr><td><b>${escapeHtml(candidate.score)}</b></td><td>${escapeHtml(candidate.strategy)}</td><td>${escapeHtml(candidate.expiry)} (${escapeHtml(candidate.dte)}d)</td><td>${money(candidate.limitPrice)}</td><td>${money(candidate.maxLoss)}</td><td>${money(candidate.maxProfit)}</td><td>${escapeHtml(candidate.rewardRisk ?? "—")}</td></tr>`).join("") ||
      '<tr><td colspan="7">No liquid defined-risk candidates found.</td></tr>';
  } catch (error) {
    if (requestEpoch !== authEpoch) return;
    if (error.status === 401) {
      showOperatorSession({ authenticated: false }, "Your desk session ended. Sign in again to scan options.");
      showLockedOptions();
      return;
    }
    $("#candidates").innerHTML = `<tr><td colspan="7">${escapeHtml(errorText(error))}</td></tr>`;
  }
}

async function loadIntelligence() {
  $("#news").innerHTML = '<div class="muted">Loading events…</div>';
  try {
    const result = await api(`/api/intelligence?symbol=${encodeURIComponent(symbol)}`);
    $("#macroCards").innerHTML = result.macro
      ? Object.values(result.macro).map((item) => metric(item.label, item.observation ? `${item.observation.value} · ${item.observation.date}` : "—")).join("")
      : metric("FRED macro", result.macroConfigured ? (result.macroError || "Unavailable") : "Not configured");
    $("#news").innerHTML = rows(result.news, (item) =>
      `<div class="row"><div><b>${escapeHtml(item.headline || "Untitled")}</b><div class="muted">${escapeHtml(item.source || "")}</div></div><span>${escapeHtml(String(item.created_at || "").slice(0, 10))}</span></div>`);
    const actions = Object.entries(result.corporateActions || {}).flatMap(([type, items]) =>
      (items || []).map((item) => ({ type, ...item })));
    $("#actions").innerHTML = rows(actions.slice(0, 25), (item) =>
      `<div class="row"><b>${escapeHtml(item.type.replaceAll("_", " "))}</b><span>${escapeHtml(item.ex_date || item.process_date || item.declaration_date || "")}</span></div>`);
  } catch (error) {
    const message = `<div class="empty-state">${escapeHtml(errorText(error))}</div>`;
    $("#news").innerHTML = message;
    $("#actions").innerHTML = message;
  }
}

async function loadResearch() {
  $("#filings").innerHTML = "Loading SEC filings…";
  try {
    const result = await api(`/api/research?symbol=${encodeURIComponent(symbol)}`);
    const measures = result.metrics || {};
    $("#facts").innerHTML =
      metric("Company", result.name) +
      metric("Revenue", measures.revenue ? money(measures.revenue.value) : "—") +
      metric("Net income", measures.netIncome ? money(measures.netIncome.value) : "—", tone(measures.netIncome?.value)) +
      metric("Assets", measures.assets ? money(measures.assets.value) : "—") +
      metric("Cash", measures.cash ? money(measures.cash.value) : "—");
    $("#filings").innerHTML = rows(result.filings, (filing) =>
      `<div class="row"><b>${escapeHtml(filing.form)}</b><span>${escapeHtml(filing.filed || "")} · ${escapeHtml(filing.reportDate || "")}</span></div>`);
  } catch (error) {
    $("#filings").innerHTML = `<div class="empty-state">${escapeHtml(errorText(error))}</div>`;
  }
}

async function loadAccount() {
  if (!await refreshOperatorSession()) {
    $("#accountCards").innerHTML = '<div class="empty-state">Private desk locked. Unlock above to check the live broker account.</div>';
    return;
  }
  const requestEpoch = authEpoch;
  $("#accountCards").innerHTML = '<div class="empty-state">Verifying the live broker account…</div>';
  try {
    const result = await api("/api/account");
    if (requestEpoch !== authEpoch || !operatorSession.authenticated) return;
    const account = result.account;
    if (!account || account.mode !== "live") throw new Error("Live account data unavailable");
    setStatus("LIVE ACCOUNT CONNECTED", "connected");
    $("#accountCards").innerHTML =
      metric("Mode", "LIVE") +
      metric("Equity", money(account.equity)) +
      metric("Day P/L", money(account.dayPnL), tone(account.dayPnL)) +
      metric("Cash", money(account.cash)) +
      metric("Buying power", money(account.buyingPower)) +
      metric("Options BP", money(account.optionsBuyingPower)) +
      metric("Options level", account.optionsTradingLevel ?? "—") +
      metric("Trading blocked", String(account.tradingBlocked));
  } catch (error) {
    if (requestEpoch !== authEpoch) return;
    if (error.status === 401) {
      showOperatorSession({ authenticated: false }, "Your desk session ended. Sign in again to view the account.");
      $("#accountCards").innerHTML = '<div class="empty-state">Private desk locked. Unlock above to check the live broker account.</div>';
      return;
    }
    setStatus("BROKER DISCONNECTED", "disconnected");
    $("#accountCards").innerHTML = `<div class="empty-state">Broker disconnected: ${escapeHtml(errorText(error))}</div>`;
  }
}

$("#symbol").value = symbol;
document.querySelectorAll(".tabs button").forEach((button) => button.addEventListener("click", () => setTab(button.dataset.tab)));
$("#symbolForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const next = safeTicker($("#symbol").value.trim());
  if (!next) { $("#symbol").setCustomValidity("Enter a valid ticker"); $("#symbol").reportValidity(); return; }
  $("#symbol").setCustomValidity("");
  symbol = next;
  history.replaceState({}, "", `/trading.html?ticker=${encodeURIComponent(symbol)}`);
  for (const section of ["options", "intelligence", "research"]) loaded.delete(section);
  setTab("options");
});
$("#refreshMarket").addEventListener("click", loadMarket);
$("#scanOptions").addEventListener("click", loadOptions);
$("#loadIntelligence").addEventListener("click", loadIntelligence);
$("#loadResearch").addEventListener("click", loadResearch);
$("#loadAccount").addEventListener("click", loadAccount);
$("#operatorLogin").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("#operatorSecret");
  const secret = input.value;
  input.value = "";
  if (!secret) return;
  const button = $("#operatorLoginButton");
  button.disabled = true;
  sessionRequestVersion += 1;
  $("#operatorMessage").textContent = "Unlocking private desk…";
  try {
    const result = await api("/api/operator-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret }),
    });
    sessionRequestVersion += 1;
    showOperatorSession(result);
    loaded.delete("account");
    loaded.delete("options");
    await loadAccount();
  } catch (error) {
    sessionRequestVersion += 1;
    const message = error.status === 503 ? "Operator access is not configured on this server." :
      error.status === 401 ? "Sign-in failed. Check the operator password and try again." :
      "Could not unlock the private desk. Check the server connection and try again.";
    showOperatorSession({ authenticated: false }, message);
    $("#accountCards").innerHTML = '<div class="empty-state">Private desk locked. Unlock above to check the live broker account.</div>';
  } finally {
    button.disabled = false;
    input.value = "";
  }
});
$("#operatorLogout").addEventListener("click", async () => {
  const button = $("#operatorLogout");
  button.disabled = true;
  const csrfToken = operatorSession.csrfToken;
  sessionRequestVersion += 1;
  showOperatorSession({ authenticated: false }, "Locking private desk…");
  try {
    if (!csrfToken) throw new Error("Missing session token");
    await api("/api/operator-session", {
      method: "DELETE",
      headers: { "X-CSRF-Token": csrfToken },
    });
    sessionRequestVersion += 1;
    showOperatorSession({ authenticated: false }, "Private desk locked. Sign in to view the live account and scan options.");
  } catch {
    sessionRequestVersion += 1;
    await refreshOperatorSession();
    $("#operatorMessage").textContent = operatorSession.authenticated
      ? "Could not lock the desk. Try again." : "Private desk locked.";
  } finally {
    button.disabled = false;
  }
});
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible" || !operatorSession.authenticated) return;
  const accountVisible = $("#account").classList.contains("active");
  const optionsVisible = $("#options").classList.contains("active");
  if (accountVisible) $("#accountCards").innerHTML = '<div class="empty-state">Checking your desk session…</div>';
  if (optionsVisible) {
    $("#optionSummary").innerHTML = "";
    $("#candidates").innerHTML = '<tr><td colspan="7">Checking your desk session…</td></tr>';
  }
  const authenticated = await refreshOperatorSession();
  if (authenticated && accountVisible) await loadAccount();
  if (authenticated && optionsVisible) await loadOptions();
});

await loadHealth();
await refreshOperatorSession();
setTab("market");
