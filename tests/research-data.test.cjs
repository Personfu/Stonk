const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const profiles = ["gm", "cdw"].map((ticker) => JSON.parse(
  readFileSync(join(__dirname, "..", "data", `${ticker}.json`), "utf8")));
const [gm, cdw] = profiles;

test("every published relationship has provenance and a date", () => {
  for (const profile of profiles) {
    assert.match(profile.company.sourceUrl, /^https:\/\//);
    for (const rows of Object.values(profile.sections)) {
      for (const row of rows) {
        assert.ok(row.name);
        assert.match(row.sourceUrl, /^https:\/\//);
        assert.match(row.asOf, /^\d{4}-\d{2}-\d{2}$/);
        assert.ok(row.sourceLabel);
      }
    }
  }
});

test("historical BrightDrop buyers are labeled and retired board member is absent", () => {
  const historical = gm.sections.customers.filter((row) => row.name === "FedEx" || row.name === "Walmart");
  assert.equal(historical.length, 2);
  assert.ok(historical.every((row) => row.status.includes("historical")));
  assert.ok(!gm.sections.board.some((row) => row.name === "Jonathan McNeill"));
});

test("CDW supplier concentration and undisclosed analyst roster are represented honestly", () => {
  assert.equal(cdw.sections.analysts.length, 0);
  const wholesalers = cdw.sections.suppliers.filter((row) => row.status === "wholesale distributor");
  assert.deepEqual(wholesalers.map((row) => row.name).sort(), ["Ingram Micro", "TD SYNNEX"]);
  assert.ok(wholesalers.every((row) => row.detail.includes("together exceeded 25%")));
});

test("seed scripts replace only the selected company's reviewed relationship snapshot", () => {
  for (const ticker of ["GM", "CDW"]) {
    const seed = readFileSync(join(__dirname, "..", "database", `seed_${ticker.toLowerCase()}.sql`), "utf8");
    assert.ok(seed.startsWith("begin;"));
    assert.match(seed, new RegExp(`delete from public\\.research_relationships where company_ticker = '${ticker}';`));
    assert.ok(seed.indexOf("delete from public.research_relationships") < seed.indexOf("insert into public.research_relationships"));
    assert.ok(seed.includes("commit;"));
  }
});
