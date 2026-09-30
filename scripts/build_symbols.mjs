import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputs = [
  { file: "nasdaqlisted.txt", exchange: "NASDAQ", tickerColumn: 0, nameColumn: 1, testColumn: 3, etfColumn: 6 },
  { file: "otherlisted.txt", exchange: null, tickerColumn: 0, nameColumn: 1, testColumn: 6, etfColumn: 4 },
];
const otherExchange = { N: "NYSE", A: "NYSE American", P: "NYSE Arca", Z: "Cboe BZX", V: "IEX", F: "Cboe" };
const byTicker = new Map();
let asOf = "";

for (const input of inputs) {
  const source = await readFile(path.join(root, "data", input.file), "utf8");
  const lines = source.trim().split(/\r?\n/);
  const creation = lines.find((line) => line.startsWith("File Creation Time:"));
  const match = creation?.match(/(\d{2})(\d{2})(\d{4})/);
  if (match) asOf = `${match[3]}-${match[1]}-${match[2]}`;
  for (const line of lines.slice(1)) {
    if (line.startsWith("File Creation Time:")) continue;
    const columns = line.split("|");
    const ticker = columns[input.tickerColumn]?.trim();
    const name = columns[input.nameColumn]?.trim();
    if (!ticker || !name || columns[input.testColumn] === "Y" ||
        !/^[A-Z0-9][A-Z0-9.\-]{0,14}$/.test(ticker)) continue;
    const exchange = input.exchange || otherExchange[columns[2]] || columns[2] || "";
    byTicker.set(ticker, [ticker, name, exchange, columns[input.etfColumn] === "Y" ? "ETF" : "security"]);
  }
}

const payload = {
  asOf,
  sources: [
    "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt",
    "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt",
  ],
  rows: [...byTicker.values()].sort((a, b) => a[0].localeCompare(b[0])),
};
await writeFile(path.join(root, "data", "us_symbols.json"), JSON.stringify(payload) + "\n");
process.stdout.write(`${payload.rows.length} symbols as of ${asOf}\n`);
