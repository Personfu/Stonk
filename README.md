# Stonk

Stonk is a stock market terminal with a 50-candidate home network and ticker-first company research. Suppliers appear to the left of the selected company; customers and distribution channels appear to the right. Index membership, competitors, large holders, analysts, directors, and public leadership sit below the map. Every populated relationship carries a source and date.

**GM and CDW are researched examples, not a hardcoded universe.** The home page shows 50 editorial discovery candidates across ten themes and a search bar. Enter any ticker to open its terminal. The app checks a read-only Supabase research graph, then a bundled directory of 12,865 U.S.-listed securities for basic identity. A security without curated relationships opens an identity workspace rather than inheriting another company's data. The relationship schema and seed tool accept any ticker. This directory is a dated U.S. listing snapshot, not a complete global securities master.

## Run locally

Requires Node.js 22 or newer.

```text
npm ci
npm run dev
```

Open `http://localhost:3000`. Run `npm test` for lookup and provenance checks.

To enable the minute market screens, copy `.env.example` to `.env` and enter your **market-data** key and secret from Alpaca. The local server loads `.env` at startup; restart it after changing the file. Leave `ALPACA_MARKET_DATA_FEED=iex` unless your account has licensed SIP access. The credentials stay server-side. Without them, the 50-candidate map and researched profiles still populate, while live rankings and ticker recommendations stay paused.

The browser reads public research records from the [Stonk Supabase project](https://supabase.com/dashboard/project/rbkcgfxmhqvkzkpfpabf). If that read is unavailable, checked-in GM and CDW research profiles remain available offline. The ticker identity route uses a September 29, 2026 snapshot of Nasdaq Trader's [Nasdaq-listed](https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt) and [other-listed](https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt) symbol files. It excludes test issues. Refresh the two raw files in `data/` and run `node scripts/build_symbols.mjs` to update `data/us_symbols.json`. The raw downloads are ignored by Git; the generated snapshot is committed for fast offline lookup.

## Research data

The public tables are `research_companies` and `research_relationships`; SQL is in `database/schema.sql`. They allow anonymous **read only** access under row level security. Browser clients cannot insert or change research records. To add another sourced company:

1. Create `data/<ticker>.json` in the same shape as `data/gm.json` with source URLs and `asOf` dates for each relationship.
2. Generate repeatable seed SQL with `python scripts/build_seed.py data/<ticker>.json database/seed_<ticker>.sql`.
3. Review the source claims and apply the SQL to the Supabase project using an authorized database connection. Each generated seed replaces only that ticker's prior relationship snapshot in one transaction, so removed claims do not linger.

The GM graph contains **102 records**: 26 publicly named suppliers, 6 named downstream organizations, 4 indices, 14 comparison peers, 3 disclosed large holders, 29 analysts, 10 directors, and 10 public leaders. The CDW graph contains **42 records**: 16 named vendor partners and distributors, 4 public customer case studies, 1 index, 3 peers, 2 disclosed holders, 9 directors, and 7 executives. These are **subsets**. GM says its global supplier base can be up to 20,000; CDW reports more than 1,000 vendor partners and 250,000 customers. Private contracts and most end-customer identities are not public. Index and ownership information changes; always check the linked source and date.

## Trading status

The home map polls `/api/screener` and ticker terminals poll `/api/signal?ticker=...` every minute while open. Both routes read Alpaca market data **only when server-side credentials are configured** and suppress rankings or signals when the feed is unavailable or stale. The intraday and one-week screens are unvalidated research heuristics, with source times, inputs, liquidity gates, and cost assumptions. They are not net-profit forecasts. The Trading tab saves **inactive rule drafts** on this device. Stonk does not monitor positions in the background, connect a brokerage account, or place orders. No brokerage credentials are stored in the browser or repository. See [docs/market-screener.md](docs/market-screener.md) and [docs/market-signals.md](docs/market-signals.md).

For a live Robinhood account, Robinhood documents a separate [Agentic Trading account connected through its Trading MCP in Codex](https://robinhood.com/us/en/support/articles/agentic-trading-overview/). That connection is outside this website and must be completed by the account owner. Stonk does not claim a connection merely because a rule draft exists. The implementation checklist in [docs/live-trading.md](docs/live-trading.md) describes the next integration step and order controls.

## Architecture

- `index.html`, `src/styles.css`, `src/app.js`: responsive research and rule-drafting interface.
- `src/data.js`: ticker-based Supabase research loader with U.S. listing identity fallback.
- `api/lookup.js`: bounded lookup over the bundled U.S. listing directory.
- `api/signal.js`: server-side market-data adapter with intraday and five-session research screens; no order endpoint.
- `api/screener.js`: 50-candidate home network and optional fresh-data rankings.
- `data/universe.json`: editorial discovery universe with listing checks.
- `data/us_symbols.json`: dated listing directory generated by `scripts/build_symbols.mjs`.
- `data/gm.json`, `data/cdw.json`: source-linked starter profiles and offline fallback.
- `database/`: schema and reproducible GM and CDW seeds.
- `server.mjs`: local preview; Vercel can serve the static files and `api/` routes as functions.

The requested Pump SDK packages and Solana helpers are installed under `crypto/` for a separate optional module. The linked `agenti` package is not published to npm yet, so `@agenti/sdk` could not be installed. Nothing in the stock terminal loads these packages or accepts wallet keys. The installed Pump dependency tree currently has npm security advisories; review and resolve these before any crypto execution feature is enabled.

This project is an application foundation and research tool. It does not make investment recommendations or imply that a supplier, customer, index membership, analyst assignment, or ownership position is current beyond the cited date.
