// Fast bundled directory of U.S.-listed securities. Relationship records are separate.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const directory = require("../data/us_symbols.json");
const SOURCE = "https://www.nasdaqtrader.com/trader.aspx?id=symboldirdefs";
const rows = directory.rows.map(([ticker, name, exchange, kind]) => ({ ticker, name, exchange, kind, asOf: directory.asOf }));
const byTicker = new Map(rows.map((row) => [row.ticker, row]));

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const params = req.query || Object.fromEntries(new URL(req.url, "http://localhost").searchParams);
  const ticker = String(params.ticker || "").trim().toUpperCase();
  const query = String(params.q || "").trim().toLowerCase();
  if (ticker && !/^[A-Z0-9][A-Z0-9.\-]{0,14}$/.test(ticker)) {
    return res.status(400).json({ error: "Invalid ticker" });
  }
  if (!ticker && (!query || query.length > 80)) {
    return res.status(400).json({ error: "Enter a ticker or search query" });
  }
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  if (ticker) return res.status(200).json({ company: byTicker.get(ticker) || null, source: SOURCE });
  const matches = rows.filter((row) => row.ticker.toLowerCase().startsWith(query) ||
    row.name.toLowerCase().includes(query)).sort((a, b) => {
    const aRank = a.ticker.toLowerCase() === query ? 0 : a.ticker.toLowerCase().startsWith(query) ? 1 : 2;
    const bRank = b.ticker.toLowerCase() === query ? 0 : b.ticker.toLowerCase().startsWith(query) ? 1 : 2;
    return aRank - bRank || a.ticker.localeCompare(b.ticker);
  }).slice(0, 12);
  return res.status(200).json({ companies: matches, source: SOURCE, asOf: directory.asOf });
};
