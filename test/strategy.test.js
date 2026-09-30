import test from"node:test";import assert from"node:assert/strict";
import{deriveTrendSignal,estimateOrderRisk,parseOcc,rankCandidatesForSignal,requiredOptionsLevel,validateLongDebitVertical}from"../api/_lib/strategy.js";

test("parses OCC symbol",()=>{const x=parseOcc("AAPL250117C00200000");assert.equal(x.root,"AAPL");assert.equal(x.cp,"C");assert.equal(x.strike,200)});

const debit = {order_class:"mleg",qty:"2",type:"limit",limit_price:"1.25",time_in_force:"day",legs:[{symbol:"AAPL250117C00200000",side:"buy",position_intent:"buy_to_open",ratio_qty:"1"},{symbol:"AAPL250117C00210000",side:"sell",position_intent:"sell_to_open",ratio_qty:"1"}]};
test("debit vertical risk equals debit paid",()=>{assert.deepEqual(estimateOrderRisk(debit),{bounded:true,maxLoss:250});assert.equal(validateLongDebitVertical(debit).maxLoss,250)});

test("manual risk rejects credit and malformed vertical orders",()=>{
  const credit={...debit,limit_price:"-1.50",legs:debit.legs.map(leg=>({...leg,side:leg.side==="buy"?"sell":"buy",position_intent:leg.side==="buy"?"sell_to_open":"buy_to_open"}))};
  const twoShort={...debit,legs:debit.legs.map(leg=>({...leg,side:"sell",position_intent:"sell_to_open"}))};
  const ratio={...debit,legs:[debit.legs[0],{...debit.legs[1],ratio_qty:"2"}]};
  const backwards={...debit,legs:[{...debit.legs[0],symbol:debit.legs[1].symbol},{...debit.legs[1],symbol:debit.legs[0].symbol}]};
  const mismatchedExpiry={...debit,legs:[debit.legs[0],{...debit.legs[1],symbol:"AAPL250124C00210000"}]};
  for(const order of [credit,twoShort,ratio,backwards,mismatchedExpiry]){
    assert.equal(validateLongDebitVertical(order),null);
    assert.deepEqual(estimateOrderRisk(order),{bounded:false,maxLoss:null});
  }
});

test("bear put debit vertical must buy the higher strike",()=>{
  const put={...debit,qty:"1",legs:[
    {...debit.legs[0],symbol:"AAPL250117P00210000"},
    {...debit.legs[1],symbol:"AAPL250117P00200000"},
  ]};
  assert.equal(validateLongDebitVertical(put).maxLoss,125);
  assert.equal(validateLongDebitVertical({...put,legs:[
    {...put.legs[0],symbol:put.legs[1].symbol},
    {...put.legs[1],symbol:put.legs[0].symbol},
  ]}),null);
});

test("trend signal recognizes sustained gains",()=>{const bars=Array.from({length:25},(_,i)=>({c:100+i}));const s=deriveTrendSignal(bars);assert.equal(s.direction,"bull");assert.ok(s.confidence>0)});

test("trend-aligned spread outranks opposing spread",()=>{const rows=[{strategy:"bull_call_debit_spread",score:70,rewardRisk:1.5},{strategy:"bear_put_debit_spread",score:70,rewardRisk:1.5}];const ranked=rankCandidatesForSignal(rows,{direction:"bull",confidence:80});assert.equal(ranked[0].strategy,"bull_call_debit_spread");assert.ok(ranked[0].score>ranked[1].score)});

test("options approval requirements match strategy complexity",()=>{assert.equal(requiredOptionsLevel({side:"buy",position_intent:"buy_to_open"}),2);assert.equal(requiredOptionsLevel({order_class:"mleg",legs:[{},{}]}),3)});
