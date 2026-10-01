# Stonk

Stonk combines a stock research terminal, personal research accounts, and a separate guarded operator trading desk. The home page is a web of 50 **discovery candidates** across ten themes, with search for a wider U.S. listing directory. A ticker workspace places sourced suppliers to the left of the company and named customers or distribution channels to the right. Index membership, comparison peers, large holders, analyst coverage, directors, and public leaders are available below the map when documented. The trading desk adds Alpaca market screens, SEC filings and fundamentals, options analysis, account visibility, and controlled live order endpoints.

The 50 home candidates are **not 50 recommendations**. GM and CDW are researched examples, not the supported ticker limit. The bundled September 29, 2026 Nasdaq Trader directory contains 12,865 U.S.-listed symbols for search and basic identity. A symbol without curated relationships opens an identity and market workspace rather than showing another company's graph. This directory does not cover every global, OTC, or delisted stock.

## Run locally

Requires Node.js 22 or newer.

```bash
npm install
npm run dev
```

Open the local URL shown by the development server. The research terminal is at `/`, customer accounts are at `/account.html`, and the operator trading desk is at `/trading.html`. Run `npm test` for deterministic checks.

Copy `.env.example` to `.env` and set your own Alpaca credentials to enable market data. Account access additionally requires the explicit live trading acknowledgement described below. Broker credentials and the operator secret must stay on the server. The example leaves the acknowledgement blank and both automation flags `false`, so copying it cannot authorize an order. No keys, linked live account, or authorization to place orders are supplied in this repository. Without market data, the 50-node home map and sourced GM/CDW research still load, while live rankings and minute signals remain paused. Restart the local server after changing environment values.

## Research terminal

The home map groups 50 hand-selected candidate symbols by editorial theme. Its lines show theme membership, **not** supplier, customer, or ownership links. Search supports the bundled U.S. listing directory beyond those 50. `GET /api/screener` can rank candidates only when fresh Alpaca stock data is available. It returns empty rankings rather than invented prices or picks when the feed is absent, stale, or outside the supported market session. The browser checks for updates about every minute while the terminal is open.

Ticker workspaces use `GET /api/signal?ticker=...` for separate intraday and one-week **research screens**. They show observation time, feed, inputs, liquidity gates, and reasons. The displayed move after assumed costs is a retrospective scenario; it is not a forecast of net profit. Scores are unvalidated heuristics, not probabilities or a model trained to beat a market benchmark. The signal endpoint does not submit orders or drive the separate options automation. See [market network methodology](docs/market-screener.md) and [minute signal methodology](docs/market-signals.md).

Company relationships come from the read-only [Stonk Supabase research project](https://supabase.com/dashboard/project/rbkcgfxmhqvkzkpfpabf), with checked-in GM and CDW profiles available as a fallback. Each displayed relationship has a source URL and an `asOf` date. The GM graph has 102 curated records and the CDW graph has 42. These are public, named subsets: private supplier contracts, most customer identities, and complete employee rosters are not available here. Check the linked source and date before relying on a record. The app lists public leadership, not all employees.

To add another company, create `data/<ticker>.json` in the same shape as [GM](data/gm.json) or [CDW](data/cdw.json), then generate a ticker-scoped, transactional seed:

```bash
python scripts/build_seed.py data/gm.json database/seed_gm.sql
```

Review the claims and apply the SQL through an authorized database connection. [The schema](database/schema.sql) allows anonymous **read only** access under row level security; browser clients cannot change records. The seed replaces only that ticker's previous curated relationships, so withdrawn records do not linger. To refresh the listing directory, download Nasdaq Trader's [Nasdaq-listed](https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt) and [other-listed](https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt) files into `data/` and run `node scripts/build_symbols.mjs`. Those raw files are ignored by Git; the generated JSON is committed.

## Customer accounts

The Account page uses Supabase email authentication for private, cloud-saved ticker watchlists. It supports sign-up, email confirmation, sign-in, sign-out, and password recovery. The browser uses only the project's publishable key; the `public.user_watchlist` table grants read, add, and remove access only to the signed-in owner under row level security. The schema is in [database/user_watchlist.sql](database/user_watchlist.sql). Watchlist symbols are checked against the bundled U.S. listing directory before saving. The home page's local Watch basket remains local to that device.

**Customer accounts do not connect a broker, accept deposits, or place trades.** The operator desk uses one server-wide Alpaca account and is not a customer brokerage integration. To enable customer money flows, obtain an approved provider integration with per-user account authorization, identity checks, funding, and order lifecycle handling. Supabase Auth's Site URL and redirect allowlist must include the deployed `/account.html` URL for email confirmation and password recovery. The account page never asks for banking credentials.

An isolated Alpaca Broker API transport covers account status, Plaid processor-token ACH linking, deposits, and account-scoped equity limit orders. A server-only customer-account binding and a read-only `/api/customer-broker` status route now exist; neither opens customer accounts nor moves money or submits trades. The binding table has row level security, grants no browser-role access, and currently has no linked accounts. The remaining provider and application gates are tracked in [public customer brokerage launch](docs/public-broker-launch.md). Broker API correspondent credentials must never be replaced with the desk's single-owner Trading API keys.

## Live trading desk

The current broker adapter is **Alpaca live trading**, not Robinhood. The desk displays market movers, most-active names, quote data, SEC EDGAR filings and Company Facts, Alpaca news and corporate actions, optional FRED macro observations, live account state, and an options lab. The options lab normalizes contract snapshots and Greeks, evaluates long options and defined-risk debit spreads, and ranks research candidates using liquidity, payoff shape, and the underlying's 5-day/20-day trend. Its score is research priority, not expected return or probability of profit.

Stonk has no paper endpoint or paper fallback. The API's trading base is Alpaca's live URL. The broker and order routes fail closed without live credentials and `STONK_ALLOW_LIVE_TRADING=I_UNDERSTAND_REAL_MONEY`. Hosted deployments additionally require `STONK_SINGLE_OWNER_ACCOUNT=I_UNDERSTAND_ONE_SHARED_ACCOUNT`; leave it unset for public customer use. `/api/account` and `/api/order` also require operator authentication. The manual order route accepts canonical 1:1 long debit call or put verticals only, checks active account status, options approval, buying power, and a per-trade risk cap, and previews unless a caller explicitly sends `execute: true`. A preview returns a `requestId` required for execution; retries use the same broker order ID.

Set a long random `STONK_TRADING_SECRET` on the server, then open **Trading desk → Broker account** and unlock the private desk. The browser submits the secret once to obtain an eight-hour, HttpOnly session cookie and clears the form; it does not save the secret in browser storage. Account data and option-chain scans are private to that session. The manual order API also accepts a bearer token for trusted server-side clients; cookie-based order requests require a same-origin CSRF token. Deployment sign-in requires HTTPS.

The separate `/api/automation` endpoint requires an operator bearer token or `CRON_SECRET`. It checks the broker clock, account status, day-loss cap, existing positions and open orders, directional trend, score, strategy allowlist, and options buying power. Its default eligible structures are bull-call and bear-put debit spreads. A stable broker order ID limits automation to **one submitted order per trading date**, including concurrent or retried scans. Automatic placement requires **both** `STONK_AUTOTRADE_ENABLED=true` and `STONK_AUTOTRADE_EXECUTE=true`, as well as the live acknowledgement and credentials above. These controls bound exposure; they do not establish that the strategy is profitable. See [trading architecture and setup](docs/TRADING.md).

The preferred Robinhood connection mentioned in the original product request is **not integrated** into this website. Robinhood's [Agentic Trading account and Trading MCP](https://robinhood.com/us/en/support/articles/agentic-trading-overview/) are a separate path an account owner can set up in Codex. Stonk should never label a Robinhood account connected on the basis of a saved local rule draft.

## Optional crypto module

The requested Pump SDKs and Solana helpers are isolated in `crypto/`; the stock and options terminal imports none of them. `@agenti/sdk` could not be installed because [the Agenti package is not published to npm](https://github.com/nirholas/agenti#packages). No wallet keys, x402 payments, or crypto execution are connected. The optional dependency tree has npm security advisories that need review before enabling any signing or payment path. See [crypto module notes](crypto/README.md).

## Deployment and limits

The interface is static and the `api/` files are Vercel functions. Customer watchlists have per-user access rules; public live market-data display still needs a licensed feed and appropriate rate limits. Do not put a personal market-data key on an anonymous public terminal. The repository's live-only execution controls require a deliberate single-owner operator setup. Market screens and options scores have not been validated with out-of-sample forward results, transaction costs, fills, or broker telemetry. No scanner can promise the most profitable day or one-week trade.

