import test from"node:test";import assert from"node:assert/strict";
import{tradingBase,tradingMode}from"../api/_lib/alpaca.js";

test("trading mode is always live",()=>{
  process.env.ALPACA_TRADING_MODE="paper";
  assert.equal(tradingMode(),"live");
});

test("trading base never falls back to paper",()=>{
  process.env.STONK_ALLOW_LIVE_TRADING="I_UNDERSTAND_REAL_MONEY";
  process.env.STONK_SINGLE_OWNER_ACCOUNT="I_UNDERSTAND_ONE_SHARED_ACCOUNT";
  assert.equal(tradingBase(),"https://api.alpaca.markets");
  delete process.env.STONK_ALLOW_LIVE_TRADING;
  delete process.env.STONK_SINGLE_OWNER_ACCOUNT;
  assert.throws(()=>tradingBase(),/Live trading acknowledgement/);
});

test("hosted broker access requires a second single-owner acknowledgement",()=>{
  const previous=Object.fromEntries(["VERCEL","NODE_ENV","STONK_ALLOW_LIVE_TRADING","STONK_SINGLE_OWNER_ACCOUNT"].map(k=>[k,process.env[k]]));
  try{
    process.env.VERCEL="1";
    process.env.STONK_ALLOW_LIVE_TRADING="I_UNDERSTAND_REAL_MONEY";
    delete process.env.STONK_SINGLE_OWNER_ACCOUNT;
    assert.throws(()=>tradingBase(),/Single-owner broker access is disabled/);
    process.env.STONK_SINGLE_OWNER_ACCOUNT="I_UNDERSTAND_ONE_SHARED_ACCOUNT";
    assert.equal(tradingBase(),"https://api.alpaca.markets");
  }finally{
    for(const [k,v] of Object.entries(previous))if(v===undefined)delete process.env[k];else process.env[k]=v;
  }
});
