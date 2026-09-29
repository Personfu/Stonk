# Stonk trading architecture

Stonk uses Alpaca for the first broker/data adapter because one API family covers account state, equities, listed options, option-chain snapshots with Greeks, market screeners, paper trading, live trading and multi-leg options.

## Execution posture

1. Paper is the default.
2. Browser code never receives broker keys.
3. The public UI is read-only for account data and strategy scans.
4. `/api/order` requires an operator bearer token and accepts bounded-risk limit orders only.
5. Live mode requires `ALPACA_TRADING_MODE=live` plus `STONK_ALLOW_LIVE_TRADING=I_UNDERSTAND_REAL_MONEY`.
6. Automated trading adds `STONK_AUTOTRADE_ENABLED=true`; actual placement requires `STONK_AUTOTRADE_EXECUTE=true`; live automation additionally requires `STONK_AUTOTRADE_LIVE=true`.
7. `STONK_MAX_RISK_PER_TRADE_USD` caps estimated option max loss.

The option scanner ranks research candidates. Its score is not a profitability claim. Current scoring rewards narrower bid/ask spreads, useful delta, bounded max loss and payoff asymmetry. It intentionally avoids naked short options.

## Scheduled automation

Deploy on Vercel and configure a Cron Job to call `/api/automation`. The endpoint accepts Vercel's `CRON_SECRET` bearer token and checks Alpaca's market clock before scanning.

Example for a plan that supports frequent cron execution:

```json
{"crons":[{"path":"/api/automation","schedule":"*/15 * * * 1-5"}]}
```

Do not enable real-money automation until the same rules have been observed in paper trading across enough market regimes to evaluate fill quality, slippage, outages, stale quotes, early assignment, volatility shocks and strategy drift.

## Public research data

`/api/research` resolves tickers through the SEC public company map, then reads EDGAR submissions and Company Facts. `/api/market` uses Alpaca market movers, most-active stocks and current quotes.
