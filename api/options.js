import { optionContracts, optionSnapshots, stockBars } from "./_lib/alpaca.js";
import { normalizeChain, scanStrategies, deriveTrendSignal, rankCandidatesForSignal } from "./_lib/strategy.js";
import { fail, method, query, requireOperator, send } from "./_lib/http.js";

function isoPlus(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  try {
    method(req, ["GET"]);
    requireOperator(req);
    const params = query(req);
    const symbol = String(params.get("symbol") || "").trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(symbol)) {
      const error = new Error("Enter a valid stock ticker");
      error.status = 400;
      throw error;
    }
    const minDte = Math.max(0, Math.min(180, Number(params.get("minDte") || 7)));
    const maxDte = Math.max(minDte, Math.min(365, Number(params.get("maxDte") || 45)));
    const filters = { expiration_date_gte: isoPlus(minDte), expiration_date_lte: isoPlus(maxDte) };
    const [contracts, snapshots, bars] = await Promise.all([
      optionContracts(symbol, filters), optionSnapshots(symbol, filters), stockBars(symbol, 45),
    ]);
    const chain = normalizeChain(contracts, snapshots);
    const signal = deriveTrendSignal(bars);
    const candidates = rankCandidatesForSignal(scanStrategies(chain), signal).slice(0, 50);
    return send(res, 200, { ok: true, symbol, asOf: new Date().toISOString(), minDte, maxDte,
      signal, contractCount: chain.length, candidates, chain: chain.slice(0, 500) });
  } catch (error) {
    return fail(res, error);
  }
}
