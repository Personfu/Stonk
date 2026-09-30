const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..", "data");
const universe = JSON.parse(readFileSync(join(root, "universe.json"), "utf8"));
const overviews = JSON.parse(readFileSync(join(root, "company-summaries.json"), "utf8"));

test("every editorial map candidate has a dated, source-linked company overview", () => {
  const tickers = universe.candidates.map(([ticker]) => ticker);
  assert.equal(tickers.length, 50);
  assert.deepEqual(Object.keys(overviews.summaries).sort(), tickers.sort());
  for (const [ticker, item] of Object.entries(overviews.summaries)) {
    assert.ok(item.summary.length >= 50, `${ticker} overview is too short`);
    assert.match(item.sourceUrl, /^https:\/\/[^/]+\//, `${ticker} needs an HTTPS source`);
    assert.ok(item.sourceLabel, `${ticker} needs a source label`);
    assert.match(item.checkedAsOf, /^\d{4}-\d{2}-\d{2}$/, `${ticker} needs a review date`);
  }
});
