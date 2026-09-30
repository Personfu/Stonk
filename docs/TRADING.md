# Stonk trading architecture

Stonk uses Alpaca for the first broker/data adapter because one API family covers account state, equities, listed options, option-chain snapshots with Greeks, market screeners, historical stock bars, news, corporate actions, live trading and multi-leg options.

SEC EDGAR supplies filing/fundamental research. FRED optionally supplies macro observations.

## Execution posture

1. Stonk is live-only; there is no paper endpoint or paper fallback.
2. Browser code contains no broker keys or operator secret. The sign-in form handles the typed secret transiently and clears it after submission.
3. The broker account and option-chain scans require an eight-hour private desk session. The sign-in form clears the secret after submission; the cookie is HttpOnly, signed, and SameSite=Strict. Cookie-based order POSTs also require a same-origin CSRF token. Server-side clients may use the operator bearer token.
4. `/api/order` requires operator authentication and accepts canonical 1:1 long debit call or put vertical limit orders only.
5. Every trading call requires `STONK_ALLOW_LIVE_TRADING=I_UNDERSTAND_REAL_MONEY`; otherwise execution fails closed.
6. Automated live trading requires `STONK_AUTOTRADE_ENABLED=true`; actual placement additionally requires `STONK_AUTOTRADE_EXECUTE=true`.
7. `STONK_MAX_RISK_PER_TRADE_USD` caps estimated option max loss.
8. `STONK_MAX_DAILY_LOSS_USD` stops new automated entries after the account's current-day loss crosses the configured threshold.
9. Existing positions and open orders suppress another automated entry in the same underlying.
10. Options buying power is checked before a candidate is placed.
11. Default automated strategies are bull-call and bear-put debit spreads. Change `STONK_AUTOTRADE_ALLOWED_STRATEGIES` only after separately validating another bounded-risk strategy.
12. Automated placement uses one stable broker client order ID per trading date. The broker rejects duplicate submissions from concurrent scans or retries, so at most one automated order can be submitted per date. Higher order volume requires a durable atomic order budget.

## Candidate ranking

The option scanner's score is not a profitability forecast. It currently combines:

- option bid/ask spread quality;
- delta fit;
- DTE gates;
- debit-spread payoff asymmetry;
- 5-day and 20-day underlying price trend;
- trend confidence.

Automation requires a directional trend instead of selecting bullish versus bearish structures from option liquidity alone.

This is a deterministic baseline for live-market research and tightly bounded execution. A serious next model iteration should add walk-forward backtesting, transaction-cost calibration, volatility-regime features, earnings/corporate-action exclusion windows and persistent strategy/fill telemetry before live capital is expanded.

## Scheduled automation

Deploy on Vercel and configure a Cron Job to call `/api/automation`. The endpoint accepts Vercel's `CRON_SECRET` bearer token and checks Alpaca's market clock before scanning.

Example for a Vercel plan that supports a 15-minute cron cadence:

```json
{
  "crons": [
    { "path": "/api/automation", "schedule": "*/15 * * * 1-5" }
  ]
}
```

Vercel plan limits determine how frequently cron jobs may execute. Keep `STONK_AUTOTRADE_EXECUTE=false` whenever you want live-market scans without order placement.

## Market-data feeds

Stocks and options use separate feed settings because Alpaca's feed names differ by asset class:

```text
ALPACA_STOCK_DATA_FEED=iex
ALPACA_OPTION_DATA_FEED=indicative
```

Use SIP or other licensed feeds only if the account is entitled to them.

## Public research data

- `/api/research`: SEC ticker map, EDGAR submissions and Company Facts.
- `/api/intelligence`: Alpaca news, corporate actions and optional FRED macro.
- `/api/market`: Alpaca market movers, most-active stocks and current quotes.
- `/api/options`: active contracts, snapshots/Greeks, underlying trend and strategy candidates.

## Live execution requirements

Stonk does not expose Alpaca's paper-trading base URL. The trading adapter always targets `https://api.alpaca.markets`.

Missing live acknowledgement, missing live credentials, insufficient options approval, insufficient buying power, an exceeded daily-loss limit, a duplicate underlying exposure, a closed market, or a strategy outside the allowlist prevents new automated orders.

Live execution should keep conservative risk caps until actual fill quality, slippage, signal turnover, earnings gaps, assignment behavior and strategy drift are measured from production telemetry.
