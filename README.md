# Stonk

Stonk is a public-markets research, options-analysis and broker-execution terminal.

This build replaces the repository's prior README-only shell with an actual application: live/public market screens, SEC fundamentals and filings, news and corporate actions, optional FRED macro data, options-chain analytics with Greeks, broker account visibility, bounded-risk order controls and a live-only automation runner.

## Current stack

- **Alpaca Market Data** — stock movers, most-active names, quotes, daily bars, options contracts, options snapshots/Greeks, news and corporate actions.
- **Alpaca Trading API** — account state, options approval/buying power, positions, open orders, market clock and order submission.
- **SEC EDGAR** — company mapping, submissions and Company Facts.
- **FRED** — optional macro panel for Fed funds, 2Y/10Y Treasury yields, VIX, unemployment and CPI.
- **Vercel** — static terminal + serverless API routes; the automation endpoint is compatible with Vercel Cron.
- **GitHub Actions** — Node 22 test/lint checks on pull requests and main.

## What the terminal does

### Market Pulse
Shows current gainers, losers, most-active stocks and quote plumbing.

### Options Lab
For a ticker, Stonk:

1. downloads active option contracts for a configurable DTE window;
2. joins contract metadata to option snapshots and Greeks;
3. calculates bid/ask spread quality and option-level quality;
4. builds long-option and defined-risk debit-spread candidates;
5. calculates bounded max loss / max profit where applicable;
6. calculates 5-day and 20-day underlying trend plus realized volatility from stock bars;
7. re-ranks candidates for directional alignment.

The score is a **research-priority score**, not a probability of profit or guaranteed-return estimate.

### News + Macro
Shows recent symbol news, corporate actions and — when `FRED_API_KEY` is configured — a macro panel.

### SEC Research
Resolves a U.S. ticker to its SEC CIK and surfaces recent 10-K, 10-Q, 8-K, proxy and foreign-issuer filings plus selected XBRL facts.

### Broker
Shows live broker mode, equity, day P/L, cash, buying power, options buying power, options level and trading-blocked state. Broker credentials remain server-side.

## Automated trading controls

Automation is intentionally layered so one accidental environment-variable change cannot immediately turn the system into an unrestricted live-money bot.

Execution posture:

```text
STONK_ALLOW_LIVE_TRADING=I_UNDERSTAND_REAL_MONEY
STONK_AUTOTRADE_ENABLED=false
STONK_AUTOTRADE_EXECUTE=false
```

Stonk has no paper-trading endpoint or paper fallback. If live acknowledgement or live broker credentials are missing, execution fails closed.

The automation endpoint:

- checks the Alpaca market clock;
- checks account trading/options status;
- stops new entries after `STONK_MAX_DAILY_LOSS_USD`;
- excludes underlyings already represented by an open order or current position;
- requires a non-neutral trend signal;
- defaults to bull-call and bear-put **defined-risk debit spreads** only;
- requires a configurable minimum score;
- requires max loss below `STONK_MAX_RISK_PER_TRADE_USD`;
- checks options buying power;
- caps orders per run;
- uses limit orders.

Actual automatic placement additionally requires:

```text
STONK_AUTOTRADE_ENABLED=true
STONK_AUTOTRADE_EXECUTE=true
```

Automatic live order placement additionally requires both:

```text
STONK_AUTOTRADE_ENABLED=true
STONK_AUTOTRADE_EXECUTE=true
```

The order and automation endpoints also require a server-only bearer secret in `STONK_TRADING_SECRET` (or `CRON_SECRET` for the automation route when invoked by Vercel Cron).

## Local setup

Requires Node.js 22+.

```bash
npm install
cp .env.example .env
npm run dev
```

Use live Alpaca brokerage credentials only. Paper-account credentials are not supported by Stonk.

Tests and syntax checks:

```bash
npm test
npm run lint
```

## Important files

- `index.html`, `src/` — terminal UI.
- `api/_lib/alpaca.js` — server-side Alpaca adapter.
- `api/_lib/strategy.js` — chain normalization, strategy construction, trend alignment and risk calculations.
- `api/options.js` — ticker options research.
- `api/intelligence.js` — news, corporate actions and optional FRED macro.
- `api/research.js` — SEC EDGAR research.
- `api/order.js` — authenticated preview/execution endpoint with bounded-risk checks.
- `api/automation.js` — gated scanner/execution loop.
- `docs/TRADING.md` — deployment and execution model.
- `test/strategy.test.js` — deterministic strategy/risk tests.

## Risk statement

No scanner can reliably identify the "most profitable" option chain in advance. Options can lose the entire premium, spreads can realize their full defined loss, and live fills can differ materially from quoted prices. Stonk therefore keeps live execution bounded-risk, limit-order based and circuit-breaker controlled.
