import test from"node:test";import assert from"node:assert/strict";
import{tradingBase,tradingMode}from"../api/_lib/alpaca.js";

test("trading mode is always live",()=>{
  process.env.ALPACA_TRADING_MODE="paper";
  assert.equal(tradingMode(),"live");
});

test("trading base never falls back to paper",()=>{
  process.env.STONK_ALLOW_LIVE_TRADING="I_UNDERSTAND_REAL_MONEY";
  assert.equal(tradingBase(),"https://api.alpaca.markets");
  delete process.env.STONK_ALLOW_LIVE_TRADING;
  assert.throws(()=>tradingBase(),/Live trading acknowledgement/);
});
