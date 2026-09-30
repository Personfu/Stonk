"""Create repeatable SQL to load a sourced company profile into Supabase."""

import json
import re
import sys
from pathlib import Path


def sql(value):
    if value is None:
        return "null"
    return "'" + str(value).replace("'", "''") + "'"


def main(source: Path, destination: Path):
    profile = json.loads(source.read_text(encoding="utf-8"))
    company = profile["company"]
    ticker = company["ticker"].upper()
    if not re.fullmatch(r"[A-Z0-9][A-Z0-9.\-]{0,14}", ticker):
        raise ValueError("Invalid ticker")

    coverage = profile.get("coverage", {})
    lines = ["begin;", "", "-- Sourced company profile", "insert into public.research_companies",
             "  (ticker, name, exchange, sector, description, source_url, as_of, coverage_note, coverage_source_url)",
             "values (" + ", ".join(sql(value) for value in [
                 ticker, company["name"], company.get("exchange"), company.get("sector"),
                 company.get("description"), company.get("sourceUrl"), company["asOf"],
                 coverage.get("note"), coverage.get("sourceUrl")]) + ")",
             "on conflict (ticker) do update set",
             "  name = excluded.name, exchange = excluded.exchange, sector = excluded.sector,",
             "  description = excluded.description, source_url = excluded.source_url,",
             "  as_of = excluded.as_of, coverage_note = excluded.coverage_note,",
             "  coverage_source_url = excluded.coverage_source_url, updated_at = now();",
             "", "-- Replace only this company's curated relationship snapshot.",
             f"delete from public.research_relationships where company_ticker = {sql(ticker)};",
             "", "-- Relationships are keyed by company, section and source-list position."]

    rows = []
    for section, items in profile["sections"].items():
        for index, row in enumerate(items, 1):
            relation_id = f"{ticker}:{section}:{index:04d}"
            rows.append("(" + ", ".join(sql(value) for value in [
                relation_id, ticker, section, row["name"], row.get("ticker"), row.get("detail"),
                row["sourceUrl"], row["sourceLabel"], row["asOf"], row.get("status", "documented")
            ]) + ")")
    if rows:
        lines += ["insert into public.research_relationships",
                  "  (id, company_ticker, section, name, related_ticker, detail, source_url, source_label, as_of, status)",
                  "values", "  " + ",\n  ".join(rows),
                  "on conflict (id) do update set",
                  "  name = excluded.name, related_ticker = excluded.related_ticker, detail = excluded.detail,",
                  "  source_url = excluded.source_url, source_label = excluded.source_label,",
                  "  as_of = excluded.as_of, status = excluded.status, updated_at = now();"]
    lines += ["", "commit;", ""]
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {len(rows)} sourced relationships to {destination}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: python scripts/build_seed.py data/gm.json database/seed_gm.sql")
    main(Path(sys.argv[1]), Path(sys.argv[2]))
