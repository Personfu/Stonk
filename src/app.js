/* Stonk research workspace. Public company records come from /data/{ticker}.json.
   Rule drafts and watchlist choices stay in this browser; this file never places orders. */

const SECTION_META = {
  suppliers: { title: "Suppliers", label: "Upstream", kicker: "UPSTREAM NETWORK" },
  customers: { title: "Customers", label: "Downstream", kicker: "DOWNSTREAM NETWORK" },
  indices: { title: "Indices", label: "Index exposure", kicker: "MARKET EXPOSURE" },
  competitors: { title: "Competitors", label: "Peer company", kicker: "INDUSTRY PEERS" },
  holders: { title: "Holders", label: "Institutional holder", kicker: "OWNERSHIP" },
  analysts: { title: "Analysts", label: "Analyst coverage", kicker: "STREET COVERAGE" },
  board: { title: "Board", label: "Board member", kicker: "GOVERNANCE" },
  leadership: { title: "Public leadership", label: "Publicly named leader", kicker: "PUBLIC LEADERSHIP" },
};
const RESEARCH_SECTIONS = ["indices", "competitors", "holders", "analysts", "board", "leadership"];
const ALL_SECTIONS = Object.keys(SECTION_META);
const WATCHLIST_KEY = "stonk.watchlist.v1";
const RULES_KEY = "stonk.ruleDrafts.v1";
const SCREENER_MAX_AGE_MS = 60_000;
const SIGNAL_INPUT_MAX_AGE_MS = 180_000;
const FUTURE_TOLERANCE_MS = 30_000;

const $ = (selector) => document.querySelector(selector);
const state = {
  ticker: readTickerFromUrl(),
  data: null,
  profileFound: false,
  loading: false,
  search: "",
  focus: "overview",
  research: "indices",
  suggestions: [],
  watchlist: readLocal(WATCHLIST_KEY, []),
  rules: readLocal(RULES_KEY, []),
  lastDrawerTrigger: null,
};
const terminal = { payload: null, history: [], checkedAt: null, loading: false, requestId: 0 };
const screener = { payload: null, checkedAt: null, loading: false, requestId: 0, search: "", selectedTicker: null, mapCentered: false };
let terminalExpiryTimer;
let screenerExpiryTimer;

function readLocal(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return Array.isArray(value) ? value : fallback;
  } catch { return fallback; }
}

function writeLocal(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}

function safeTicker(value) {
  const ticker = String(value || "").trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9.\-]{0,14}$/.test(ticker) ? ticker : null;
}

function readTickerFromUrl() {
  return safeTicker(new URLSearchParams(window.location.search).get("ticker"));
}

function text(selector, value) {
  const element = $(selector);
  if (element) element.textContent = value;
}

function el(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined && content !== null) node.textContent = String(content);
  return node;
}

function validSource(url) {
  if (!url) return null;
  try {
    const parsed = new URL(String(url));
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : null;
  } catch { return null; }
}

function formatDate(value) {
  if (!value) return "Date unavailable";
  const raw = String(value);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00Z`) : new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(parsed);
}

function formatTime(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" }).format(parsed);
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function signedPercent(value) {
  if (!finiteNumber(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function marketPrice(value) {
  return finiteNumber(value) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value) : "—";
}

function compactNumber(value) {
  return finiteNumber(value) ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value) : "—";
}

function rowArray(section) {
  const rows = state.data?.sections?.[section];
  return Array.isArray(rows) ? rows.filter((row) => row && typeof row === "object" && row.name) : [];
}

function matches(row, section) {
  if (!state.search) return true;
  const haystack = [row.name, row.ticker, row.detail, row.sourceLabel, row.status, SECTION_META[section].title]
    .filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(state.search.toLowerCase());
}

function initials(name, ticker) {
  const symbol = safeTicker(ticker);
  if (symbol && symbol.length <= 4) return symbol.slice(0, 3);
  return String(name || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
}

function statusTone(status) {
  return !status || /unverified|pending|candidate|estimated|unknown|not disclosed|not stated|reported|historical/i.test(String(status)) ? "caution" : "normal";
}

function makeMeta(row) {
  const meta = el("div", "record-meta");
  const status = el("span", "status-pill", row.status || "Status not stated");
  status.dataset.tone = statusTone(row.status);
  meta.append(status);

  const source = validSource(row.sourceUrl);
  if (source) {
    const link = el("a", "source-pill", `${row.sourceLabel || "Source"} ↗`);
    link.href = source;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", `Open source for ${row.name}: ${row.sourceLabel || "Source"}`);
    meta.append(link);
  } else {
    meta.append(el("span", "source-pill", "Source unavailable"));
  }
  return meta;
}

function emptyMessage(section, searched = false) {
  const empty = el("div", "empty-state");
  empty.append(el("strong", "", searched ? "No matching records" : "Coverage pending"));
  empty.append(el("span", "", searched
    ? "Try a different name or ticker."
    : `No verified ${SECTION_META[section].title.toLowerCase()} listed yet.`));
  return empty;
}

function renderRelationshipList(section) {
  const container = $(`#${section}-list`);
  const all = rowArray(section);
  const visible = all.filter((row) => matches(row, section));
  text(`#${section}-count`, visible.length);
  $(`#${section}-count`).title = state.search ? `${visible.length} of ${all.length} records match` : `${all.length} records`;
  container.replaceChildren();
  if (!visible.length) { container.append(emptyMessage(section, Boolean(state.search))); return; }

  visible.forEach((row) => {
    const item = el("article", "relationship-item");
    const button = el("button", "relationship-primary");
    button.type = "button";
    button.setAttribute("aria-label", `View ${row.name} relationship details`);
    button.append(el("span", "entity-avatar", initials(row.name, row.ticker)));
    const copy = el("span", "entity-copy");
    copy.append(el("span", "entity-name", row.name));
    copy.append(el("span", "entity-sub", row.ticker || SECTION_META[section].label));
    button.append(copy, el("span", "entity-arrow", "↗"));
    button.addEventListener("click", () => openDrawer(section, row, button));
    item.append(button);
    if (row.detail) item.append(el("p", "relationship-detail", row.detail));
    item.append(makeMeta(row));
    container.append(item);
  });
}

function renderCoverage() {
  const container = $("#coverage-grid");
  container.replaceChildren();
  [
    ["suppliers", "Suppliers"], ["customers", "Customers"],
    ["indices", "Indices"], ["holders", "Holders"],
  ].forEach(([section, label]) => {
    const card = el("div", "coverage-card");
    card.append(el("strong", "", rowArray(section).length), el("span", "", label));
    container.append(card);
  });
}

function renderNetwork() {
  const container = $("#network-map");
  container.replaceChildren();
  const addSide = (section) => {
    const side = el("div", "network-side");
    side.append(el("span", "network-side-label", SECTION_META[section].title));
    const rows = rowArray(section).filter((row) => matches(row, section)).slice(0, 3);
    if (!rows.length) side.append(el("span", "network-node", "No sourced records"));
    rows.forEach((row) => {
      const node = el("button", "network-node", row.name);
      node.type = "button";
      node.addEventListener("click", () => openDrawer(section, row, node));
      side.append(node);
    });
    return side;
  };
  const center = el("div", "network-center");
  center.append(el("strong", "", state.ticker));
  container.append(addSide("suppliers"), center, addSide("customers"));
}

function renderResearchTabs() {
  RESEARCH_SECTIONS.forEach((section) => {
    const count = rowArray(section).filter((row) => matches(row, section)).length;
    text(`#tab-count-${section}`, count);
    const button = document.querySelector(`[data-research-tab="${section}"]`);
    const active = section === state.research;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
}

function renderResearchList() {
  const section = state.research;
  $("#research-list").setAttribute("aria-labelledby", `research-tab-${section}`);
  const meta = SECTION_META[section];
  text("#research-kicker", meta.kicker);
  text("#research-title", meta.title);
  const all = rowArray(section);
  const visible = all.filter((row) => matches(row, section));
  text("#research-visible-count", `${visible.length}${state.search ? ` / ${all.length}` : ""} ${visible.length === 1 ? "record" : "records"}`);
  const container = $("#research-list");
  container.replaceChildren();
  if (!visible.length) { container.append(emptyMessage(section, Boolean(state.search))); return; }

  visible.forEach((row) => {
    const card = el("article", "research-card");
    const button = el("button", "research-card-main");
    button.type = "button";
    button.setAttribute("aria-label", `View ${row.name} details`);
    const title = el("span", "research-card-title");
    title.append(el("strong", "", row.name), el("small", "", row.detail || row.ticker || meta.label));
    button.append(title, el("span", "research-card-arrow", "↗"));
    button.addEventListener("click", () => openDrawer(section, row, button));
    card.append(button);
    const recordMeta = makeMeta(row);
    recordMeta.className = "research-card-meta";
    card.append(recordMeta);
    container.append(card);
  });
}

function renderSearchResults() {
  const container = $("#search-results");
  container.replaceChildren();
  if (!state.search) { container.hidden = true; return; }
  container.hidden = false;
  container.append(el("div", "search-results-heading", "SEARCH / OPEN WORKSPACE"));
  const suggestions = state.suggestions.slice(0, 6);
  suggestions.forEach((company) => {
    const result = el("button", "search-result");
    result.type = "button";
    const label = el("span");
    label.append(el("strong", "", company.name), el("small", "", `${company.ticker} · SEC issuer listing`));
    result.append(label, el("em", "", "COMPANY ↗"));
    result.addEventListener("click", () => loadTicker(company.ticker));
    container.append(result);
  });
  const ticker = safeTicker(state.search);
  if (ticker && !suggestions.some((company) => company.ticker === ticker)) {
    const open = el("button", "search-result");
    open.type = "button";
    const label = el("span");
    label.append(el("strong", "", `Open ${ticker} workspace`), el("small", "", ticker === state.ticker ? "Current ticker" : "Loads this ticker’s own research profile"));
    open.append(label, el("em", "", "TICKER ↗"));
    open.addEventListener("click", () => loadTicker(ticker));
    container.append(open);
  }
  let matchesFound = 0;
  for (const section of ALL_SECTIONS) {
    for (const row of rowArray(section)) {
      if (!matches(row, section)) continue;
      matchesFound++;
      if (matchesFound > 8) continue;
      const result = el("button", "search-result");
      result.type = "button";
      const label = el("span");
      label.append(el("strong", "", row.name), el("small", "", row.detail || row.ticker || SECTION_META[section].label));
      result.append(label, el("em", "", SECTION_META[section].title.toUpperCase()));
      result.addEventListener("click", () => {
        if (RESEARCH_SECTIONS.includes(section)) selectResearch(section);
        container.hidden = true;
        openDrawer(section, row, result);
      });
      container.append(result);
    }
  }
  if (!matchesFound && !ticker && !suggestions.length) container.append(el("div", "search-empty", "No matching records. Enter a stock ticker to open its workspace."));
  if (matchesFound > 8) container.append(el("div", "search-results-heading", `+ ${matchesFound - 8} more matches in this workspace`));
}

function renderWatchlist() {
  const watching = state.watchlist.includes(state.ticker);
  const button = $("#watch-button");
  button.setAttribute("aria-pressed", String(watching));
  text("#watch-label", watching ? `Watching ${state.ticker}` : `Watch ${state.ticker}`);
  button.title = watching ? `Remove ${state.ticker} from your local watchlist` : `Add ${state.ticker} to your local watchlist`;
}

function renderSignalHistory() {
  const container = $("#signal-history");
  container.replaceChildren();
  text("#signal-history-count", terminal.history.length);
  if (!terminal.history.length) {
    container.append(el("p", "", "New scans appear here while this terminal is open."));
    return;
  }
  terminal.history.forEach((entry) => {
    const row = el("div", "signal-history-row");
    const top = el("div", "signal-history-top");
    const action = el("strong", `history-action action-${entry.recommendation}`, entry.recommendation.toUpperCase());
    top.append(action, el("span", "", entry.horizon === "oneWeek" ? "ONE WEEK" : "INTRADAY"), el("time", "", formatTime(entry.refreshedAt)));
    row.append(top, el("p", "", entry.reason));
    container.append(row);
  });
}

function horizonScreen(payload, key) {
  const provided = payload?.horizons?.[key];
  if (provided && typeof provided === "object") return provided;
  if (key === "intraday" && payload) return payload;
  return { status: "unavailable", recommendation: null, reasons: ["A sourced one-week trend screen is not available yet."] };
}

function screenReasons(screen) {
  return Array.isArray(screen?.reasons) ? screen.reasons.filter((reason) => typeof reason === "string" && reason.trim()) : [];
}

function marketInputExpiry(screen, quoteFallback = null) {
  const barTime = Date.parse(screen?.asOf || "");
  const quoteTime = Date.parse(screen?.quoteAsOf || quoteFallback || "");
  if (!Number.isFinite(barTime) || !Number.isFinite(quoteTime)) return null;
  const explicit = Date.parse(screen?.validUntil || "");
  return Math.min(barTime + SIGNAL_INPUT_MAX_AGE_MS, quoteTime + SIGNAL_INPUT_MAX_AGE_MS,
    Number.isFinite(explicit) ? explicit : Infinity);
}

function marketInputsFresh(screen, quoteFallback = null) {
  const barTime = Date.parse(screen?.asOf || "");
  const quoteTime = Date.parse(screen?.quoteAsOf || quoteFallback || "");
  const now = Date.now();
  return [barTime, quoteTime].every((timestamp) => Number.isFinite(timestamp)
    && timestamp - now <= FUTURE_TOLERANCE_MS) && now < marketInputExpiry(screen, quoteFallback);
}

function readyScreen(screen) {
  return screen?.status === "ready" && marketInputsFresh(screen, terminal.payload?.quoteAsOf)
    && ["buy", "sell", "watch"].includes(String(screen.recommendation || "").toLowerCase()) && screenReasons(screen).length > 0;
}

function screenDate(value) {
  if (!value) return "—";
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? formatDate(value) : formatTime(value);
}

function renderHorizon(key, screen, commonSource) {
  const prefix = key === "oneWeek" ? "one-week" : "intraday";
  const agedOut = screen?.status === "ready" && !marketInputsFresh(screen, terminal.payload?.quoteAsOf);
  const status = agedOut ? "stale"
    : ["ready", "stale", "closed"].includes(screen?.status) ? screen.status : "unavailable";
  const reasons = screenReasons(screen);
  const ready = readyScreen(screen);
  const recommendation = String(screen?.recommendation || "").toLowerCase();
  const metrics = screen?.metrics && typeof screen.metrics === "object" ? screen.metrics : {};
  const scenario = screen?.scenario && typeof screen.scenario === "object" ? screen.scenario : null;
  const source = screen?.source && typeof screen.source === "object" ? screen.source : commonSource;
  text(`#${prefix}-state`, terminal.loading && !terminal.payload ? "CHECKING" : status.toUpperCase());
  $(`#${prefix}-state`).dataset.status = status;
  const action = $(`#${prefix}-action`);
  action.textContent = ready ? recommendation.toUpperCase() : status === "stale" ? "STALE" : status === "closed" ? "CLOSED" : "NO SIGNAL";
  action.className = `horizon-action ${ready ? `action-${recommendation}` : status === "stale" ? "action-stale" : "action-none"}`;
  const score = finiteNumber(screen?.score) ? ` · score ${screen.score.toFixed(0)}` : "";
  text(`#${prefix}-confidence`, ready ? `${screen.confidence || "unrated"} data confidence${score}` : status === "stale" ? "Fresh data required" : status === "closed" ? "Regular session only" : "Waiting for data");
  const fallback = key === "oneWeek" ? "A sourced weekly trend is required." : "A current minute scan is required.";
  text(`#${prefix}-short-reason`, agedOut ? "Market bar or quote aged out; waiting for fresh inputs." : reasons[0] || fallback);
  const list = $(`#${prefix}-reasons`);
  list.replaceChildren();
  (reasons.length ? reasons : [fallback]).slice(0, 8).forEach((reason) => list.append(el("li", "", reason)));
  text(`#${prefix}-reason-count`, reasons.length);

  const inputs = $(`#${prefix}-inputs`);
  inputs.replaceChildren();
  const addInput = (label, value) => { if (value !== "—") inputs.append(el("span", "", `${label} ${value}`)); };
  if (key === "intraday") {
    addInput("DAY RANGE", finiteNumber(metrics.rangePosition) ? `${(metrics.rangePosition * 100).toFixed(0)}%` : "—");
    addInput("1M MOVE", signedPercent(metrics.momentumPct));
    addInput("SPREAD", finiteNumber(metrics.spreadBps) ? `${metrics.spreadBps.toFixed(1)} BPS` : "—");
  } else {
    addInput("5 SESSIONS", signedPercent(metrics.fiveSessionReturnPct));
    addInput("UP SESSIONS", finiteNumber(metrics.positiveSessions) ? String(metrics.positiveSessions) : "—");
    addInput("AVG DAY $ VOL", finiteNumber(metrics.averageDailyDollarVolume) ? `$${compactNumber(metrics.averageDailyDollarVolume)}` : "—");
  }
  if (scenario && finiteNumber(scenario.assumedRoundTripCostPct)) addInput("ASSUMED COST", `${scenario.assumedRoundTripCostPct.toFixed(2)}%`);
  if (!inputs.childNodes.length) inputs.append(el("span", "", "No verified inputs available"));

  const net = $(`#${prefix}-net`);
  const directional = ready && (recommendation === "buy" || recommendation === "sell");
  const observed = directional ? scenario?.[recommendation === "sell" ? "observedShortAfterCostPct" : "observedLongAfterCostPct"] : null;
  text(`#${prefix}-net-label`, directional ? `PAST ${recommendation === "sell" ? "SHORT" : "LONG"} AFTER ASSUMED COSTS` : "PAST MOVE AFTER ASSUMED COSTS");
  net.textContent = finiteNumber(observed) ? signedPercent(observed) : "—";
  const note = directional && finiteNumber(observed) ? "Past observed move; not a forecast or account P&L" : "No directional cost scenario";
  text(`#${prefix}-net-note`, note);
  $(`#${prefix}-net-note`).title = note;
  text(`#${prefix}-asof`, screenDate(screen?.historyThrough || screen?.asOf));
  text(`#${prefix}-source`, source?.name ? `${source.name}${source.feed ? ` · ${source.feed}` : ""}` : "Source unavailable");
}

function renderSignal() {
  const payload = terminal.payload;
  const intraday = horizonScreen(payload, "intraday");
  const oneWeek = horizonScreen(payload, "oneWeek");
  const commonSource = payload?.source && typeof payload.source === "object" ? payload.source : {};
  const dayReady = readyScreen(intraday);
  const dayMetrics = dayReady && intraday.metrics && typeof intraday.metrics === "object" ? intraday.metrics : {};
  const change = dayMetrics.changePct;
  text("#tape-price", dayReady ? marketPrice(dayMetrics.lastPrice) : "—");
  text("#tape-change", dayReady ? signedPercent(change) : "—");
  text("#tape-volume", dayReady ? compactNumber(dayMetrics.minuteVolume) : "—");
  text("#tape-signal", dayReady ? String(intraday.recommendation).toUpperCase() : "—");
  text("#tape-price-foot", dayReady && intraday.asOf ? `As of ${screenDate(intraday.asOf)}` : "Market feed unavailable");
  text("#tape-change-foot", dayReady ? "Versus previous close" : "Awaiting data");
  text("#tape-volume-foot", dayReady ? "Latest minute bar" : "Awaiting data");
  text("#tape-signal-foot", dayReady ? `${intraday.confidence || "unrated"} data confidence` : "No current screen");
  $("#tape-signal").className = dayReady ? `action-${String(intraday.recommendation).toLowerCase()}` : "";

  renderHorizon("intraday", intraday, commonSource);
  renderHorizon("oneWeek", oneWeek, commonSource);
  const clientStale = [intraday, oneWeek].some((screen) => screen.status === "ready" && !marketInputsFresh(screen, payload?.quoteAsOf));
  const status = [intraday, oneWeek].some(readyScreen) ? "ready"
    : [intraday, oneWeek].some((screen) => screen.status === "closed") ? "closed"
      : clientStale || [intraday, oneWeek].some((screen) => screen.status === "stale") ? "stale" : "unavailable";
  text("#signal-state", terminal.loading && !payload ? "CHECKING" : status.toUpperCase());
  $("#signal-state").dataset.status = status;
  $("#signal-refresh").disabled = terminal.loading;
  text("#signal-refreshed", formatTime(payload?.refreshedAt || terminal.checkedAt));
  text("#signal-next", formatTime(payload?.nextRefreshAt));
  const sourceLink = $("#signal-source");
  const sourceUrl = validSource(commonSource.url);
  sourceLink.hidden = !sourceUrl;
  if (sourceUrl) sourceLink.href = sourceUrl;
  text("#signal-source-label", commonSource.name ? `${commonSource.name}${commonSource.feed ? ` · ${commonSource.feed}` : ""}` : "Source unavailable");
  const banner = $("#feed-banner");
  banner.dataset.status = status;
  text("#feed-status-text", status === "ready" ? "Research screens available" : status === "closed" ? "Regular session closed" : status === "stale" ? "Market inputs stale" : terminal.loading ? "Checking market screen" : "Market screen unavailable");
  const feedCaveat = String(commonSource.feed || "").toLowerCase().includes("iex") ? "IEX single venue; prices may differ from the consolidated tape." : "Heuristic screens are information, not orders.";
  text("#feed-status-detail", status === "ready" ? feedCaveat : clientStale ? "Market bar or quote aged out; waiting for fresh inputs." : screenReasons(intraday)[0] || screenReasons(oneWeek)[0] || "Research screens require fresh market inputs.");
  renderSignalHistory();
  scheduleTerminalExpiry(intraday, oneWeek);
}

function scheduleTerminalExpiry(intraday, oneWeek) {
  clearTimeout(terminalExpiryTimer);
  if ($("#main-content").hidden) return;
  const expires = [intraday, oneWeek].filter((screen) => screen?.status === "ready")
    .map((screen) => marketInputExpiry(screen, terminal.payload?.quoteAsOf))
    .filter((timestamp) => Number.isFinite(timestamp) && timestamp > Date.now());
  if (!expires.length) return;
  terminalExpiryTimer = setTimeout(() => {
    if ($("#main-content").hidden) return;
    renderSignal();
    if (!terminal.loading) fetchSignal(state.ticker);
  }, Math.max(1, Math.min(...expires) - Date.now() + 10));
}

async function fetchSignal(ticker) {
  if (!safeTicker(ticker)) return;
  const requestId = ++terminal.requestId;
  terminal.loading = true;
  renderSignal();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(`/api/signal?ticker=${encodeURIComponent(ticker)}`, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`Signal endpoint ${response.status}`);
    const payload = await response.json();
    if (terminal.requestId !== requestId || state.ticker !== ticker) return;
    if (!payload || String(payload.ticker || "").toUpperCase() !== ticker || !["ready", "unavailable", "stale", "closed"].includes(payload.status)) throw new Error("Invalid signal response");
    terminal.payload = payload;
    terminal.checkedAt = new Date().toISOString();
    for (const horizon of ["intraday", "oneWeek"]) {
      const screen = horizonScreen(payload, horizon);
      if (!readyScreen(screen)) continue;
      const scanId = `${horizon}-${payload.refreshedAt || screen.asOf}`;
      if (!terminal.history.some((entry) => entry.scanId === scanId)) {
        terminal.history.unshift({ scanId, horizon, refreshedAt: payload.refreshedAt || screen.asOf,
          recommendation: String(screen.recommendation).toLowerCase(), reason: screenReasons(screen)[0] });
      }
    }
    terminal.history = terminal.history.slice(0, 12);
  } catch {
    if (terminal.requestId !== requestId || state.ticker !== ticker) return;
    terminal.payload = { status: "unavailable", ticker,
      reasons: ["Market screen could not be reached. Try refreshing when the feed is available."] };
    terminal.checkedAt = new Date().toISOString();
  } finally {
    clearTimeout(timeout);
    if (terminal.requestId === requestId && state.ticker === ticker) { terminal.loading = false; renderSignal(); }
  }
}

const SVG_NS = "http://www.w3.org/2000/svg";
function svgEl(tag, attributes = {}, content) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  if (content !== undefined) node.textContent = String(content);
  return node;
}

function candidateArray() {
  const rows = screener.payload?.candidates;
  return Array.isArray(rows) ? rows.filter((item) => item && safeTicker(item.ticker) && item.name) : [];
}

async function loadCandidateFallback() {
  const response = await fetch("/data/universe.json", { cache: "no-store" });
  if (!response.ok) throw new Error("Candidate universe unavailable");
  const universe = await response.json();
  if (!Array.isArray(universe.candidates)) throw new Error("Candidate universe invalid");
  return {
    status: "unavailable", candidates: universe.candidates.map(([ticker, cluster, scale]) =>
      ({ ticker, name: ticker, cluster, scale })), ranked: [],
    reason: "Market screen could not be reached. The saved candidate map remains available.",
    source: { universe: { name: universe.source?.name, url: universe.source?.url, asOf: universe.asOf }, marketData: null },
  };
}

function matchingCandidates() {
  const query = screener.search.toLowerCase();
  return candidateArray().filter((item) => !query || [item.ticker, item.name, item.cluster, item.scale]
    .filter(Boolean).join(" ").toLowerCase().includes(query));
}

function selectCandidate(ticker, restoreFocus = false) {
  screener.selectedTicker = safeTicker(ticker);
  renderStockWeb(screener.selectedTicker);
  renderCandidateList();
  renderCandidateDetail();
  if (restoreFocus) [...$("#stock-network").querySelectorAll(".web-stock-node")]
    .find((node) => node.dataset.ticker === screener.selectedTicker)?.focus({ preventScroll: true });
}

function renderStockWeb(focusTicker = null) {
  const svg = $("#stock-network");
  svg.replaceChildren();
  const candidates = candidateArray();
  $("#network-unavailable").hidden = candidates.length > 0;
  if (!candidates.length) return;

  svg.append(svgEl("title", {}, "50 U.S. stock candidates grouped by editorial cluster; these are not recommendations"));
  const background = svgEl("g", { class: "web-background", "aria-hidden": "true" });
  for (const [rx, ry] of [[435, 232], [355, 188], [275, 145], [195, 102]]) {
    background.append(svgEl("ellipse", { cx: 500, cy: 270, rx, ry }));
  }
  background.append(svgEl("line", { x1: 65, y1: 270, x2: 935, y2: 270 }));
  background.append(svgEl("line", { x1: 500, y1: 38, x2: 500, y2: 502 }));
  svg.append(background);
  const edges = svgEl("g", { class: "web-edges", "aria-hidden": "true" });
  const hubs = svgEl("g", { class: "web-hubs", "aria-hidden": "true" });
  const nodes = svgEl("g", { class: "web-nodes" });
  const groups = new Map();
  candidates.forEach((candidate) => {
    const cluster = String(candidate.cluster || "Other");
    if (!groups.has(cluster)) groups.set(cluster, []);
    groups.get(cluster).push(candidate);
  });
  const clusters = [...groups.keys()];
  clusters.forEach((cluster, groupIndex) => {
    const centerAngle = -Math.PI / 2 + groupIndex * 2 * Math.PI / clusters.length;
    const hubX = 500 + Math.cos(centerAngle) * 210;
    const hubY = 270 + Math.sin(centerAngle) * 108;
    edges.append(svgEl("line", { x1: 500, y1: 270, x2: hubX, y2: hubY, class: "hub-link" }));
    const hub = svgEl("g", { class: "web-hub" });
    hub.append(svgEl("circle", { cx: hubX, cy: hubY, r: 5 }));
    hub.append(svgEl("text", { x: hubX, y: hubY - 11, "text-anchor": "middle" }, cluster.toUpperCase().slice(0, 17)));
    hubs.append(hub);

    const group = groups.get(cluster);
    const sectorWidth = 2 * Math.PI / clusters.length;
    const step = Math.min(.12, sectorWidth * .76 / (group.length + 1));
    group.forEach((candidate, index) => {
      const angle = centerAngle + (index - (group.length - 1) / 2) * step;
      const outer = index % 2 === 0;
      const x = 500 + Math.cos(angle) * (outer ? 425 : 343);
      const y = 270 + Math.sin(angle) * (outer ? 224 : 180);
      edges.append(svgEl("line", { x1: hubX, y1: hubY, x2: x, y2: y, class: "stock-link" }));
      const ticker = safeTicker(candidate.ticker);
      const visible = !screener.search || matchingCandidates().some((item) => item.ticker === ticker);
      const selected = screener.selectedTicker === ticker;
      const node = svgEl("g", { class: `web-stock-node${visible ? "" : " dimmed"}${selected ? " selected" : ""}`,
        tabindex: "0", role: "button", "aria-label": `Inspect ${candidate.name} (${ticker})`, "data-ticker": ticker });
      node.append(svgEl("circle", { cx: x, cy: y, r: 19 }));
      node.append(svgEl("text", { x, y: y + 3, "text-anchor": "middle", "font-size": ticker.length > 4 ? 8 : 9 }, ticker));
      node.append(svgEl("title", {}, `${candidate.name} (${ticker}) · ${cluster}`));
      node.addEventListener("click", () => selectCandidate(ticker));
      node.addEventListener("dblclick", () => loadTicker(ticker));
      node.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectCandidate(ticker, true); }
      });
      nodes.append(node);
    });
  });
  const center = svgEl("g", { class: "web-center", "aria-hidden": "true" });
  center.append(svgEl("circle", { cx: 500, cy: 270, r: 47 }));
  center.append(svgEl("text", { x: 500, y: 266, "text-anchor": "middle" }, "STONK"));
  center.append(svgEl("text", { x: 500, y: 281, "text-anchor": "middle" }, `${candidates.length} CANDIDATES`));
  svg.append(edges, hubs, center, nodes);
  if (window.matchMedia("(max-width: 680px)").matches) {
    const frame = svg.parentElement;
    const selectedNode = focusTicker ? [...nodes.children].find((node) => node.dataset.ticker === focusTicker) : null;
    if (selectedNode) {
      const x = Number(selectedNode.querySelector("circle")?.getAttribute("cx"));
      if (Number.isFinite(x)) frame.scrollLeft = Math.max(0, x * svg.clientWidth / 1000 - frame.clientWidth / 2);
    } else if (!screener.mapCentered) {
      frame.scrollLeft = (frame.scrollWidth - frame.clientWidth) / 2;
      screener.mapCentered = true;
    }
  }
}

function renderCandidateList() {
  const container = $("#candidate-list");
  container.replaceChildren();
  const visible = matchingCandidates();
  text("#home-search-count", `${visible.length} / ${candidateArray().length} candidates`);
  text("#candidate-visible-count", `${visible.length} shown`);
  if (!visible.length) { container.append(el("p", "rail-empty", "No candidate matches. You can still open any valid ticker above.")); return; }
  visible.forEach((candidate) => {
    const button = el("button", `candidate-row${screener.selectedTicker === candidate.ticker ? " selected" : ""}`);
    button.type = "button";
    const identity = el("span", "candidate-row-identity");
    identity.append(el("strong", "", candidate.ticker), el("span", "", candidate.name));
    button.append(identity, el("small", "", candidate.cluster || "Candidate"));
    button.addEventListener("click", () => selectCandidate(candidate.ticker));
    container.append(button);
  });
}

function renderCandidateDetail() {
  const container = $("#candidate-detail");
  container.replaceChildren();
  const candidate = candidateArray().find((item) => item.ticker === screener.selectedTicker);
  if (!candidate) { container.append(el("p", "rail-empty", "Select a node or a directory row to inspect its company and open the full terminal.")); return; }
  const heading = el("div", "candidate-detail-identity");
  heading.append(el("strong", "", candidate.ticker), el("span", "", candidate.name));
  container.append(heading);
  const facts = el("div", "candidate-facts");
  facts.append(el("span", "", candidate.exchange || "Exchange unavailable"), el("span", "", candidate.cluster || "Cluster unavailable"),
    el("span", "", `${candidate.scale || "unclassified"} · editorial group`));
  container.append(facts);
  const ranked = freshRankedRows().find((row) => row.ticker === candidate.ticker);
  container.append(el("p", "candidate-detail-note", ranked ? `Fresh research screen: ${String(ranked.recommendation).toUpperCase()} · directional score ${ranked.score ?? "—"}. Open the terminal for inputs and reasons.`
    : "Editorial candidate only. No fresh market screen is available for this stock."));
  const actions = el("div", "candidate-actions");
  const open = el("button", "primary-button", "Open terminal ↗");
  open.type = "button";
  open.addEventListener("click", () => loadTicker(candidate.ticker));
  const watching = state.watchlist.includes(candidate.ticker);
  const watch = el("button", "watch-button", watching ? "Watching" : "Add to watch basket");
  watch.type = "button";
  watch.addEventListener("click", () => {
    state.watchlist = watching ? state.watchlist.filter((ticker) => ticker !== candidate.ticker) : [...state.watchlist, candidate.ticker];
    const saved = writeLocal(WATCHLIST_KEY, state.watchlist);
    renderCandidateDetail(); renderBasket();
    showToast(saved ? `${candidate.ticker} ${watching ? "removed from" : "added to"} watch basket.` : "Watch basket changed for this session only.");
  });
  actions.append(open, watch);
  container.append(actions);
}

function renderBasket() {
  const container = $("#basket-list");
  container.replaceChildren();
  text("#basket-count", state.watchlist.length);
  if (!state.watchlist.length) { container.append(el("p", "rail-empty", "No stocks saved yet. Select a node to add one.")); return; }
  state.watchlist.slice(0, 12).forEach((ticker) => {
    const button = el("button", "basket-chip", ticker);
    button.type = "button";
    button.title = `Open ${ticker} terminal`;
    button.addEventListener("click", () => loadTicker(ticker));
    container.append(button);
  });
  if (state.watchlist.length > 12) container.append(el("span", "basket-overflow", `+${state.watchlist.length - 12} more`));
}

function renderRanking() {
  const container = $("#ranked-list");
  container.replaceChildren();
  const rows = freshRankedRows();
  text("#ranked-count", rows.length);
  if (!rows.length) {
    container.append(el("p", "rail-empty", screener.loading && (!screener.payload || !screenerCurrent()) ? "Checking market data; earlier rankings are hidden…"
      : Array.isArray(screener.payload?.ranked) && screener.payload.ranked.length ? "Previous market inputs have aged out. Fresh screens are required."
        : screener.payload?.status === "unconfigured" ? "Market feed is not connected. The candidate map and listing search remain available."
        : screener.payload?.reason || "No fresh market screens are available. Explore the candidate map or search a ticker."));
    return;
  }
  rows.slice(0, 12).forEach((row) => {
    const card = el("button", "ranked-row");
    card.type = "button";
    const top = el("span", "ranked-row-top");
    top.append(el("span", "rank-number", String(row.rank ?? "—")), el("strong", "", row.ticker), el("em", `action-${String(row.recommendation).toLowerCase()}`, String(row.recommendation || "watch").toUpperCase()));
    card.append(top, el("small", "", row.name || row.cluster || "Sourced screen"));
    const reason = Array.isArray(row.reasons) && row.reasons.length ? row.reasons[0] : "Open terminal for screen details";
    card.append(el("span", "ranked-reason", reason));
    card.addEventListener("click", () => loadTicker(row.ticker));
    container.append(card);
  });
}

function screenerCurrent() {
  const checked = Date.parse(screener.checkedAt || "");
  const next = Date.parse(screener.payload?.nextRefreshAt || "");
  const now = Date.now();
  return Number.isFinite(checked) && now - checked < SCREENER_MAX_AGE_MS
    && (!Number.isFinite(next) || now < next);
}

function screenerSignalsExpired() {
  const validUntil = Date.parse(screener.payload?.validUntil || "");
  return Number.isFinite(validUntil) && Date.now() >= validUntil;
}

function freshRankedRows() {
  return screenerCurrent() && Array.isArray(screener.payload?.ranked)
    ? screener.payload.ranked.filter((row) => marketInputsFresh(row)) : [];
}

function scheduleScreenerExpiry() {
  clearTimeout(screenerExpiryTimer);
  if ($("#home-content").hidden) return;
  const rows = Array.isArray(screener.payload?.ranked) ? screener.payload.ranked : [];
  const expires = rows.map((row) => marketInputExpiry(row))
    .concat(Date.parse(screener.payload?.validUntil || ""))
    .filter((timestamp) => Number.isFinite(timestamp) && timestamp > Date.now());
  if (!expires.length) return;
  screenerExpiryTimer = setTimeout(() => {
    if ($("#home-content").hidden) return;
    renderHome();
    if (!screener.loading) fetchScreener();
  }, Math.max(1, Math.min(...expires) - Date.now() + 10));
}

function renderHome() {
  if ($("#home-content").hidden) return;
  const payload = screener.payload;
  const candidates = candidateArray();
  const freshRows = freshRankedRows();
  const expiredRows = Array.isArray(payload?.ranked) && freshRows.length < payload.ranked.length;
  const status = !screenerCurrent() && payload ? "refreshing"
    : ["ready", "partial", "unconfigured", "closed"].includes(payload?.status) ? payload.status : "unavailable";
  const visibleStatus = ["ready", "partial"].includes(status) && expiredRows
    ? freshRows.length ? "partial" : "refreshing" : status;
  const statusLabels = { ready: "FRESH DATA", partial: "PARTIAL DATA", unconfigured: "FEED NOT CONNECTED",
    closed: "SESSION CLOSED", refreshing: "CHECKING DATA", unavailable: "DATA UNAVAILABLE" };
  text("#home-screener-status", screener.loading && !payload ? "CHECKING DATA" : statusLabels[visibleStatus]);
  $("#home-screener-status").dataset.status = visibleStatus;
  text("#home-asof", payload?.asOf ? `${visibleStatus === "refreshing" ? "Last market data" : "Market as of"} ${formatTime(payload.asOf)}` : "Market data unavailable");
  text("#home-universe-count", `${candidates.length} candidates · not recommendations`);
  text("#home-checked", `Checked ${formatTime(payload?.refreshedAt || screener.checkedAt)}`);
  text("#home-next", `Next ${formatTime(payload?.nextRefreshAt)}`);
  const universe = payload?.source?.universe || {};
  text("#home-universe-asof", universe.asOf ? `Directory as of ${formatDate(universe.asOf)}` : "Directory date unavailable");
  const universeLink = $("#home-universe-source");
  universeLink.hidden = !validSource(universe.url);
  if (!universeLink.hidden) universeLink.href = validSource(universe.url);
  const market = payload?.source?.marketData || {};
  const marketLink = $("#home-market-source");
  marketLink.hidden = !validSource(market.url);
  if (!marketLink.hidden) marketLink.href = validSource(market.url);
  const banner = $("#feed-banner");
  banner.dataset.status = visibleStatus === "ready" || visibleStatus === "partial" ? "ready" : "unavailable";
  text("#feed-status-text", visibleStatus === "ready" ? "Fresh research screens available" : visibleStatus === "partial" ? "Partial market coverage" : visibleStatus === "closed" ? "Regular session closed" : visibleStatus === "refreshing" ? "Checking market data" : visibleStatus === "unconfigured" ? "Market feed not connected" : "Market screen unavailable");
  text("#feed-status-detail", visibleStatus === "refreshing" ? "Earlier rankings are hidden until fresh market inputs arrive."
    : expiredRows ? "Expired stock screens are hidden while other fresh scans remain visible."
    : payload?.reason || `${candidates.length} editorial candidates are available; rankings require fresh sourced market data.`);
  renderStockWeb(); renderCandidateList(); renderCandidateDetail(); renderRanking(); renderBasket();
  scheduleScreenerExpiry();
}

async function fetchScreener() {
  const requestId = ++screener.requestId;
  screener.loading = true;
  renderHome();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch("/api/screener", { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`Screener endpoint ${response.status}`);
    const payload = await response.json();
    if (requestId !== screener.requestId) return;
    if (!payload || !Array.isArray(payload.candidates) || !Array.isArray(payload.ranked)) throw new Error("Invalid screener response");
    screener.payload = payload;
    screener.checkedAt = new Date().toISOString();
    if (!candidateArray().some((candidate) => candidate.ticker === screener.selectedTicker)) screener.selectedTicker = null;
  } catch {
    if (requestId !== screener.requestId) return;
    const priorCandidates = candidateArray();
    const priorSource = screener.payload?.source || {};
    if (!candidateArray().length) {
      try { screener.payload = await loadCandidateFallback(); } catch { /* Directory remains accessible once the feed recovers. */ }
    } else {
      screener.payload = { status: "unavailable", candidates: priorCandidates, ranked: [], source: priorSource,
        reason: "Market screen could not be reached. The candidate map remains available; rankings are hidden." };
    }
    screener.payload ||= { status: "unavailable", candidates: [], ranked: [], source: {},
      reason: "Market screen and candidate map could not be loaded. You can still enter a ticker above." };
    screener.checkedAt = new Date().toISOString();
  } finally {
    clearTimeout(timeout);
    if (requestId === screener.requestId) { screener.loading = false; renderHome(); }
  }
}

function showHome() {
  state.ticker = null;
  $(".desk-link").href = "./trading.html";
  $("#skip-link").href = "#home-content";
  terminal.requestId++;
  clearTimeout(terminalExpiryTimer);
  $("#main-content").hidden = true;
  $("#home-content").hidden = false;
  $("#watch-button").hidden = true;
  document.title = "Market Terminal · Stonk";
  text("#topbar-workspace", "Market terminal");
  text("#topbar-date", "DISCOVERY / U.S. EQUITIES");
  $("#home-suggestions").hidden = true;
  renderHome();
  if ((!screener.payload || !screenerCurrent() || screenerSignalsExpired()) && !screener.loading) fetchScreener();
}

function renderProfile() {
  const company = state.data?.company || {};
  const coverage = state.data?.coverage || {};
  const name = company.name || state.ticker;
  const asOf = company.asOf ? formatDate(company.asOf) : "Date unavailable";
  document.title = `${state.ticker} Terminal · Stonk`;
  $(".desk-link").href = `./trading.html?ticker=${encodeURIComponent(state.ticker)}`;
  text("#topbar-workspace", `${state.ticker} terminal`);
  text("#breadcrumb-ticker", state.ticker);
  text("#heading-ticker", state.ticker);
  text("#heading-company-name", name);
  text("#heading-exchange-sector", [company.exchange, company.sector].filter(Boolean).join(" · ") || "Profile data unavailable");
  text("#company-title", name);
  text("#identity-icon", state.ticker.slice(0, 2));
  text("#company-ticker", state.ticker);
  text("#company-exchange", company.exchange || "EXCHANGE UNAVAILABLE");
  text("#company-sector", company.sector || "SECTOR UNAVAILABLE");
  text("#company-description", company.description || (state.profileFound
    ? "Issuer identity is available. Company relationships are awaiting source review."
    : "Company research is temporarily unavailable. Check primary filings below."));
  text("#workforce-note", company.workforceNote || "Employee totals may be disclosed in filings. Individual employee rosters are not available here; the leadership section lists public names only.");
  text("#heading-as-of", company.asOf ? `As of ${asOf}` : "Date unavailable");
  text("#topbar-date", company.asOf ? `DATA ${asOf.toUpperCase()}` : "DATA DATE UNAVAILABLE");
  text("#rule-symbol", state.ticker);
  const identityOnly = state.profileFound && (coverage.label === "Identity only" || ALL_SECTIONS.every((section) => rowArray(section).length === 0));
  const researchActions = $("#research-actions");
  researchActions.hidden = !identityOnly && state.profileFound;
  $("#research-edgar").href = `https://www.sec.gov/edgar/search/#/q=${encodeURIComponent(state.ticker)}`;
  const listingSource = validSource(company.sourceUrl || coverage.sourceUrl);
  $("#research-listing").hidden = !listingSource;
  if (listingSource) $("#research-listing").href = listingSource;
  $("#identity-status").classList.toggle("unavailable", !state.profileFound || identityOnly);
  text("#identity-status-text", state.loading ? "LOADING PROFILE" : !state.profileFound ? "PROFILE UNAVAILABLE" : identityOnly ? "IDENTITY ONLY" : "RESEARCH PROFILE");
  text("#profile-tag", `${state.ticker} / PROFILE`);
  text("#network-heading", `How ${name} connects`);
  text("#suppliers-footnote", `INPUTS TO ${state.ticker}`);
  text("#customers-footnote", `OUTPUTS FROM ${state.ticker}`);
  text("#coverage-label", coverage.label || "Follow the evidence");
  text("#coverage-note", coverage.note || "Every listed relationship should be opened and checked against its linked source and date before use in a decision.");
  const coverageSource = $("#coverage-source");
  coverageSource.hidden = !validSource(coverage.sourceUrl);
  if (!coverageSource.hidden) coverageSource.href = validSource(coverage.sourceUrl);
  renderWatchlist();
  renderRelationshipList("suppliers");
  renderRelationshipList("customers");
  renderCoverage();
  renderNetwork();
  renderResearchTabs();
  renderResearchList();
  renderRules();
  renderSearchResults();
}

function emptyProfile(ticker) {
  return { company: { name: ticker, ticker }, sections: Object.fromEntries(ALL_SECTIONS.map((section) => [section, []])) };
}

async function fetchCompanyProfile(ticker) {
  let loaderError;
  if (typeof window.StonkData?.loadCompany === "function") {
    try {
      const profile = await window.StonkData.loadCompany(ticker);
      if (profile?.company && profile?.sections) return profile;
    } catch (error) { loaderError = error; }
  }
  try {
    const response = await fetch(`/data/${encodeURIComponent(ticker.toLowerCase())}.json`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const profile = await response.json();
    if (!profile?.company || !profile?.sections) throw new Error("Invalid company profile");
    return profile;
  } catch (error) {
    if (loaderError && /HTTP 404/.test(String(error))) throw loaderError;
    throw error;
  }
}

async function loadTicker(rawTicker, options = {}) {
  const ticker = safeTicker(rawTicker);
  if (!ticker) { showToast("Enter a valid ticker, such as GM or AAPL."); return; }
  $("#home-content").hidden = true;
  clearTimeout(screenerExpiryTimer);
  $("#main-content").hidden = false;
  $("#skip-link").href = "#main-content";
  $("#watch-button").hidden = false;
  state.ticker = ticker;
  state.loading = true;
  state.profileFound = false;
  state.data = emptyProfile(ticker);
  state.search = "";
  state.suggestions = [];
  terminal.requestId++;
  terminal.payload = null;
  terminal.history = [];
  terminal.checkedAt = null;
  terminal.loading = false;
  $("#global-search").value = "";
  $("#search-results").hidden = true;
  renderProfile();
  renderSignal();
  fetchSignal(ticker);
  text("#company-description", `Loading ${ticker} research profile…`);
  if (!options.fromHistory) {
    const target = new URL(window.location.href);
    target.searchParams.set("ticker", ticker);
    history[options.initial ? "replaceState" : "pushState"]({ ticker }, "", target);
  }

  try {
    const payload = await fetchCompanyProfile(ticker);
    if (state.ticker !== ticker) return;
    state.data = payload;
    state.profileFound = true;
  } catch (error) {
    if (state.ticker !== ticker) return;
    state.data = emptyProfile(ticker);
    state.profileFound = false;
    if (!/HTTP 404/.test(String(error))) showToast(`Could not load ${ticker} research data.`);
  } finally {
    if (state.ticker === ticker) { state.loading = false; renderProfile(); }
  }
}

function selectFocus(view) {
  if (!["overview", "relationships", "trading"].includes(view)) return;
  state.focus = view;
  document.querySelectorAll("[data-focus-tab]").forEach((button) => {
    const active = button.dataset.focusTab === view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  ["overview", "relationships", "trading"].forEach((name) => { $(`#view-${name}`).hidden = name !== view; });
}

function selectResearch(section) {
  if (!RESEARCH_SECTIONS.includes(section)) return;
  state.research = section;
  renderResearchTabs();
  renderResearchList();
}

function openDrawer(section, row, trigger) {
  state.lastDrawerTrigger = trigger || document.activeElement;
  text("#drawer-section", SECTION_META[section].label);
  text("#drawer-title", row.name);
  text("#drawer-avatar", initials(row.name, row.ticker));
  text("#drawer-detail", row.detail || "The source record does not include further detail about this relationship.");
  text("#drawer-status", row.status || "Status not stated in this profile");
  text("#drawer-date", row.asOf ? formatDate(row.asOf) : "Date unavailable");
  const ticker = $("#drawer-ticker");
  ticker.hidden = !row.ticker;
  ticker.textContent = row.ticker || "";
  const sourceBox = $("#drawer-source");
  sourceBox.replaceChildren(el("span", "", "ORIGINAL SOURCE"));
  const source = validSource(row.sourceUrl);
  if (source) {
    const link = el("a", "", `${row.sourceLabel || "View source"} ↗`);
    link.href = source;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    sourceBox.append(link);
  } else {
    sourceBox.append(el("p", "", "No source link is available for this record. Treat it as unverified until a source is added."));
  }
  $("#drawer-backdrop").hidden = false;
  document.body.style.overflow = "hidden";
  $("#drawer-close").focus();
}

function closeDrawer() {
  $("#drawer-backdrop").hidden = true;
  document.body.style.overflow = "";
  if (state.lastDrawerTrigger?.isConnected) state.lastDrawerTrigger.focus();
  state.lastDrawerTrigger = null;
}

function formatSignal(rule) {
  const value = Number(rule.threshold).toLocaleString("en-US", { maximumFractionDigits: 5 });
  const condition = rule.signal === "change" ? `daily move ${rule.operator} ${value}%`
    : rule.signal === "volume" ? `volume ${rule.operator} ${value}`
      : `price ${rule.operator} $${value}`;
  return `${String(rule.side).toUpperCase()} ${rule.shares} ${rule.ticker} shares when ${condition}`;
}

function renderRules() {
  const container = $("#rules-list");
  container.replaceChildren();
  const rules = state.rules.filter((rule) => rule && rule.ticker === state.ticker);
  text("#rules-count", rules.length);
  if (!rules.length) { container.append(el("p", "rule-empty", `No ${state.ticker} rule drafts saved on this device.`)); return; }
  rules.forEach((rule) => {
    const row = el("div", "rule-row");
    const copy = el("div");
    copy.append(el("strong", "", formatSignal(rule)), el("small", "", `Max ${rule.dailyCap} order${rule.dailyCap === 1 ? "" : "s"}/day · Not active`));
    const controls = el("div", "rule-controls");
    controls.append(el("span", "draft-pill", "DRAFT"));
    const remove = el("button", "remove-rule", "×");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove rule: ${formatSignal(rule)}`);
    remove.addEventListener("click", () => {
      state.rules = state.rules.filter((entry) => entry.id !== rule.id);
      const saved = writeLocal(RULES_KEY, state.rules);
      renderRules();
      showToast(saved ? "Rule draft removed." : "Rule removed for this session; browser storage is unavailable.");
    });
    controls.append(remove);
    row.append(copy, controls);
    container.append(row);
  });
}

let toastTimer;
function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3800);
}

let suggestionTimer;
async function scheduleCompanySuggestions(query) {
  clearTimeout(suggestionTimer);
  state.suggestions = [];
  if (query.length < 2 || typeof window.StonkData?.searchCompanies !== "function") return;
  suggestionTimer = setTimeout(async () => {
    let companies = [];
    try { companies = await window.StonkData.searchCompanies(query); } catch { /* Local search remains available. */ }
    if (state.search !== query) return;
    state.suggestions = (Array.isArray(companies) ? companies : [])
      .filter((company) => company && safeTicker(company.ticker) && company.name)
      .slice(0, 6)
      .map((company) => ({ ticker: safeTicker(company.ticker), name: String(company.name) }));
    renderSearchResults();
  }, 220);
}

let homeSuggestionTimer;
let homeSuggestions = [];
function renderHomeSuggestions() {
  const container = $("#home-suggestions");
  container.replaceChildren();
  if (!homeSuggestions.length || !$("#home-search").value.trim()) { container.hidden = true; return; }
  homeSuggestions.forEach((company) => {
    const button = el("button", "home-suggestion");
    button.type = "button";
    button.append(el("strong", "", company.ticker), el("span", "", company.name));
    button.addEventListener("click", () => loadTicker(company.ticker));
    container.append(button);
  });
  container.hidden = false;
}

function scheduleHomeSuggestions(query) {
  clearTimeout(homeSuggestionTimer);
  homeSuggestions = [];
  renderHomeSuggestions();
  if (query.length < 2 || typeof window.StonkData?.searchCompanies !== "function") return;
  homeSuggestionTimer = setTimeout(async () => {
    let rows = [];
    try { rows = await window.StonkData.searchCompanies(query); } catch { /* Candidate directory remains available. */ }
    if (query !== $("#home-search").value.trim()) return;
    homeSuggestions = (Array.isArray(rows) ? rows : []).filter((company) => company && safeTicker(company.ticker) && company.name)
      .slice(0, 6).map((company) => ({ ticker: safeTicker(company.ticker), name: String(company.name) }));
    renderHomeSuggestions();
  }, 180);
}

function bindEvents() {
  $("#home-search").addEventListener("input", (event) => {
    screener.search = event.target.value.trim();
    renderStockWeb(); renderCandidateList();
    scheduleHomeSuggestions(screener.search);
  });
  const openHomeSearch = () => {
    const query = $("#home-search").value.trim();
    const matches = matchingCandidates();
    const exact = homeSuggestions.find((company) => company.name.toLowerCase() === query.toLowerCase());
    if (exact) { loadTicker(exact.ticker); return; }
    if (matches.length === 1) { loadTicker(matches[0].ticker); return; }
    const ticker = safeTicker(query);
    if (ticker && (homeSuggestions.length === 0 || homeSuggestions.some((company) => company.ticker === ticker))) { loadTicker(ticker); return; }
    if (homeSuggestions.length === 1) { loadTicker(homeSuggestions[0].ticker); return; }
    showToast("Choose a company from search results or enter its ticker.");
  };
  $("#home-open-ticker").addEventListener("click", openHomeSearch);
  $("#home-search").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); openHomeSearch(); } });
  $("#signal-refresh").addEventListener("click", () => fetchSignal(state.ticker));
  document.querySelectorAll("[data-focus-tab]").forEach((button) => {
    button.addEventListener("click", () => selectFocus(button.dataset.focusTab));
  });
  document.querySelectorAll("[data-research-tab]").forEach((button) => {
    button.addEventListener("click", () => selectResearch(button.dataset.researchTab));
  });
  [[".focus-tabs", "[data-focus-tab]", (button) => selectFocus(button.dataset.focusTab)],
    [".research-tabs", "[data-research-tab]", (button) => selectResearch(button.dataset.researchTab)]].forEach(([tablist, selector, select]) => {
    $(tablist).addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const buttons = [...document.querySelectorAll(selector)];
      const current = buttons.indexOf(document.activeElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
      select(buttons[next]);
      buttons[next].focus();
    });
  });
  $("#global-search").addEventListener("input", (event) => {
    state.search = event.target.value.trim();
    scheduleCompanySuggestions(state.search);
    renderRelationshipList("suppliers");
    renderRelationshipList("customers");
    renderNetwork();
    renderResearchTabs();
    renderResearchList();
    renderSearchResults();
  });
  $("#global-search").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const ticker = safeTicker(event.target.value);
    const exact = state.suggestions.find((company) => company.ticker === ticker);
    if (exact) loadTicker(exact.ticker);
    else if (state.suggestions.length && ticker && ticker.length > 4) loadTicker(state.suggestions[0].ticker);
    else if (ticker) loadTicker(ticker);
    else {
      const first = $("#search-results .search-result");
      if (first) first.click();
      else showToast("Enter a valid ticker or choose a matching record.");
    }
  });
  $("#open-ticker").addEventListener("click", () => loadTicker($("#global-search").value));
  $("#watch-button").addEventListener("click", () => {
    const watching = state.watchlist.includes(state.ticker);
    state.watchlist = watching ? state.watchlist.filter((ticker) => ticker !== state.ticker) : [...state.watchlist, state.ticker];
    const saved = writeLocal(WATCHLIST_KEY, state.watchlist);
    renderWatchlist();
    showToast(saved ? (watching ? `${state.ticker} removed from your watchlist.` : `${state.ticker} added to your watchlist.`)
      : "Watchlist updated for this session; browser storage is unavailable.");
  });
  $("#rule-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const threshold = Number(values.threshold);
    const shares = Number(values.shares);
    const dailyCap = Number(values.dailyCap);
    if (!Number.isFinite(threshold) || (values.signal !== "change" && threshold <= 0)
        || !Number.isInteger(shares) || shares < 1 || !Number.isInteger(dailyCap) || dailyCap < 1) {
      showToast("Enter a valid threshold, share count, and daily order limit.");
      return;
    }
    state.rules.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ticker: state.ticker,
      signal: values.signal, operator: values.operator, threshold, side: values.side,
      shares, dailyCap, enabled: false, createdAt: new Date().toISOString() });
    const saved = writeLocal(RULES_KEY, state.rules);
    renderRules();
    form.reset();
    showToast(saved ? "Rule draft saved locally. No order was placed." : "Rule added for this session only; browser storage is unavailable. No order was placed.");
  });
  $("#drawer-close").addEventListener("click", closeDrawer);
  $("#drawer-backdrop").addEventListener("click", (event) => { if (event.target === event.currentTarget) closeDrawer(); });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!$("#drawer-backdrop").hidden) closeDrawer();
      else if (!$("#home-content").hidden) { $("#home-search").value = ""; screener.search = ""; homeSuggestions = []; renderHomeSuggestions(); renderHome(); }
      else { $("#global-search").value = ""; state.search = ""; $("#search-results").hidden = true; renderProfile(); }
      return;
    }
    if (event.key === "/" && !/input|textarea|select/i.test(document.activeElement?.tagName || "")) {
      event.preventDefault(); $(!$("#home-content").hidden ? "#home-search" : "#global-search").focus();
    }
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".header-search-wrap")) $("#search-results").hidden = true;
  });
  window.addEventListener("popstate", () => {
    const ticker = readTickerFromUrl();
    if (ticker) loadTicker(ticker, { fromHistory: true });
    else showHome();
  });
  window.setInterval(() => { if (document.visibilityState === "visible") fetchSignal(state.ticker); }, 60000);
  window.setInterval(() => { if (document.visibilityState === "visible" && !$("#home-content").hidden) fetchScreener(); }, 60000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && (!terminal.checkedAt || Date.now() - new Date(terminal.checkedAt).getTime() >= 60000)) fetchSignal(state.ticker);
    if (document.visibilityState === "visible" && !$("#home-content").hidden && (!screener.checkedAt || Date.now() - new Date(screener.checkedAt).getTime() >= 60000)) fetchScreener();
  });
}

bindEvents();
if (state.ticker) loadTicker(state.ticker, { initial: true });
else showHome();
