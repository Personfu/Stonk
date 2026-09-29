import test from"node:test";import assert from"node:assert/strict";
import{deriveTrendSignal,estimateOrderRisk,parseOcc,rankCandidatesForSignal}from"../api/_lib/strategy.js";

test("parses OCC symbol",()=>{const x=parseOcc("AAPL250117C00200000");assert.equal(x.root,"AAPL");assert.equal(x.cp,"C");assert.equal(x.strike,200)});

test("debit vertical risk equals debit paid",()=>{const o={order_class:"mleg",qty:"2",type:"limit",limit_price:"1.25",legs:[{symbol:"AAPL250117C00200000",side:"buy",position_intent:"buy_to_open"},{symbol:"AAPL250117C00210000",side:"sell",position_intent:"sell_to_open"}]};assert.deepEqual(estimateOrderRisk(o),{bounded:true,maxLoss:250})});

test("credit vertical max loss uses width minus credit",()=>{const o={order_class:"mleg",qty:"1",type:"limit",limit_price:"-1.50",legs:[{symbol:"AAPL250117C00200000",side:"sell",position_intent:"sell_to_open"},{symbol:"AAPL250117C00210000",side:"buy",position_intent:"buy_to_open"}]};assert.deepEqual(estimateOrderRisk(o),{bounded:true,maxLoss:850})});

test("trend signal recognizes sustained gains",()=>{const bars=Array.from({length:25},(_,i)=>({c:100+i}));const s=deriveTrendSignal(bars);assert.equal(s.direction,"bull");assert.ok(s.confidence>0)});

test("trend-aligned spread outranks opposing spread",()=>{const rows=[{strategy:"bull_call_debit_spread",score:70,rewardRisk:1.5},{strategy:"bear_put_debit_spread",score:70,rewardRisk:1.5}];const ranked=rankCandidatesForSignal(rows,{direction:"bull",confidence:80});assert.equal(ranked[0].strategy,"bull_call_debit_spread");assert.ok(ranked[0].score>ranked[1].score)});
