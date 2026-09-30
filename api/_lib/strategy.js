const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));const num=v=>Number.isFinite(Number(v))?Number(v):null;const round=(v,d=4)=>Number(Number(v).toFixed(d));
export function normalizeChain(contracts,snapshots){return contracts.map(c=>{const s=snapshots[c.symbol]||{},q=s.latestQuote||s.latest_quote||{},g=s.greeks||{};const bid=num(q.bp??q.bid_price),ask=num(q.ap??q.ask_price),mid=bid!=null&&ask!=null&&ask>=bid?(bid+ask)/2:null,spreadPct=mid&&mid>0&&bid!=null&&ask!=null?(ask-bid)/mid:null;return{symbol:c.symbol,underlying:c.underlying_symbol,expiry:c.expiration_date,strike:num(c.strike_price),type:c.type,style:c.style,tradable:c.tradable!==false,bid,ask,mid:mid==null?null:round(mid),spreadPct:spreadPct==null?null:round(spreadPct),iv:num(s.impliedVolatility??s.implied_volatility),delta:num(g.delta),gamma:num(g.gamma),theta:num(g.theta),vega:num(g.vega),latestTrade:num((s.latestTrade||s.latest_trade||{}).p)}}).filter(x=>x.tradable&&x.strike&&x.expiry&&x.type)}
function liquidityScore(x){if(x.mid==null||x.bid==null||x.ask==null||x.mid<=0)return 0;return clamp(100-(x.spreadPct??1)*400,0,100)}
function dte(expiry,now=new Date()){return Math.max(0,Math.round((new Date(expiry+"T20:00:00Z")-now)/86400000))}
function optionQuality(x){const delta=Math.abs(x.delta??0),deltaFit=clamp(100-Math.abs(delta-.5)*180,0,100),liq=liquidityScore(x),ivPenalty=x.iv==null?10:clamp((x.iv-.85)*80,0,35);return clamp(.58*liq+.42*deltaFit-ivPenalty,0,100)}
export function scanStrategies(chain,now=new Date()){const candidates=[];for(const x of chain){const days=dte(x.expiry,now);if(days<5||days>75||x.ask==null||x.ask<=0)continue;const q=optionQuality(x);candidates.push({id:"long-"+x.symbol,strategy:x.type==="call"?"long_call":"long_put",underlying:x.underlying,expiry:x.expiry,dte:days,legs:[{symbol:x.symbol,side:"buy",position_intent:"buy_to_open",ratio_qty:"1"}],limitPrice:round(x.ask,2),maxLoss:round(x.ask*100,2),maxProfit:null,rewardRisk:null,score:round(q,1),thesis:"Directional convexity candidate; score emphasizes tradability, delta and spread quality."})}
const groups=new Map();for(const x of chain){const k=x.expiry+"|"+x.type;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(x)}
for(const rows of groups.values()){rows.sort((a,b)=>a.strike-b.strike);for(let i=0;i<rows.length-1;i++){for(let j=i+1;j<=Math.min(i+3,rows.length-1);j++){const low=rows[i],high=rows[j],days=dte(low.expiry,now),width=high.strike-low.strike;if(days<5||days>60||!(width>0))continue;const liq=Math.min(liquidityScore(low),liquidityScore(high));
if(low.type==="call"&&low.ask!=null&&high.bid!=null){const debit=low.ask-high.bid;if(debit>0&&debit<width){const maxLoss=debit*100,maxProfit=(width-debit)*100,rr=maxProfit/maxLoss,deltaFit=100-Math.min(100,Math.abs(Math.abs(low.delta??.5)-.55)*160),score=clamp(liq*.45+deltaFit*.25+clamp(rr*24,0,30),0,100);candidates.push({id:"bull-call-"+low.symbol+"-"+high.symbol,strategy:"bull_call_debit_spread",underlying:low.underlying,expiry:low.expiry,dte:days,legs:[{symbol:low.symbol,side:"buy",position_intent:"buy_to_open",ratio_qty:"1"},{symbol:high.symbol,side:"sell",position_intent:"sell_to_open",ratio_qty:"1"}],limitPrice:round(debit,2),maxLoss:round(maxLoss,2),maxProfit:round(maxProfit,2),rewardRisk:round(rr,2),score:round(score,1),thesis:"Defined-risk bullish vertical ranked by spread quality, delta fit and payoff asymmetry."})}}
if(low.type==="put"&&high.ask!=null&&low.bid!=null){const debit=high.ask-low.bid;if(debit>0&&debit<width){const maxLoss=debit*100,maxProfit=(width-debit)*100,rr=maxProfit/maxLoss,deltaFit=100-Math.min(100,Math.abs(Math.abs(high.delta??-.5)-.55)*160),score=clamp(liq*.45+deltaFit*.25+clamp(rr*24,0,30),0,100);candidates.push({id:"bear-put-"+low.symbol+"-"+high.symbol,strategy:"bear_put_debit_spread",underlying:low.underlying,expiry:low.expiry,dte:days,legs:[{symbol:high.symbol,side:"buy",position_intent:"buy_to_open",ratio_qty:"1"},{symbol:low.symbol,side:"sell",position_intent:"sell_to_open",ratio_qty:"1"}],limitPrice:round(debit,2),maxLoss:round(maxLoss,2),maxProfit:round(maxProfit,2),rewardRisk:round(rr,2),score:round(score,1),thesis:"Defined-risk bearish vertical ranked by spread quality, delta fit and payoff asymmetry."})}}}}}
return candidates.filter(c=>c.maxLoss==null||c.maxLoss>0).sort((a,b)=>b.score-a.score||(b.rewardRisk||0)-(a.rewardRisk||0))}
export function candidateToOrder(c,qty=1){if(!c?.legs?.length)throw new Error("Candidate has no legs");const q=Math.max(1,Math.floor(Number(qty)||1));if(c.legs.length===1)return{symbol:c.legs[0].symbol,qty:String(q),side:c.legs[0].side,type:"limit",limit_price:String(c.limitPrice),time_in_force:"day",position_intent:c.legs[0].position_intent,client_order_id:"stonk-"+Date.now()};return{order_class:"mleg",qty:String(q),type:"limit",limit_price:String(c.limitPrice),time_in_force:"day",legs:c.legs,client_order_id:"stonk-"+Date.now()}}
const unboundedRisk = () => ({ bounded: false, maxLoss: null });

function orderQuantity(value) {
  const quantity = Number(value);
  return Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= 10 ? quantity : null;
}

function optionLimit(value) {
  const text = String(value ?? "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const price = Number(text);
  return Number.isFinite(price) && price > 0 ? price : null;
}

export function validateLongDebitVertical(order) {
  if (!order || order.order_class !== "mleg" || order.type !== "limit" ||
      order.time_in_force !== "day" || !Array.isArray(order.legs) || order.legs.length !== 2) return null;
  const qty = orderQuantity(order.qty);
  const limitPrice = optionLimit(order.limit_price);
  if (qty === null || limitPrice === null) return null;
  const buy = order.legs.find((leg) => leg?.side === "buy" && leg.position_intent === "buy_to_open");
  const sell = order.legs.find((leg) => leg?.side === "sell" && leg.position_intent === "sell_to_open");
  if (!buy || !sell || buy === sell || String(buy.ratio_qty) !== "1" || String(sell.ratio_qty) !== "1") return null;
  const long = parseOcc(buy.symbol);
  const short = parseOcc(sell.symbol);
  if (!long || !short || long.root !== short.root || long.expiry !== short.expiry || long.cp !== short.cp) return null;
  const width = long.cp === "C" ? short.strike - long.strike : long.strike - short.strike;
  if (!(width > 0 && limitPrice < width)) return null;
  return {
    qty,
    limitPrice,
    maxLoss: round(limitPrice * 100 * qty, 2),
    order: {
      order_class: "mleg", qty: String(qty), type: "limit",
      limit_price: limitPrice.toFixed(2), time_in_force: "day",
      legs: [buy, sell].map((leg) => ({
        symbol: leg.symbol, side: leg.side,
        position_intent: leg.position_intent, ratio_qty: "1",
      })),
    },
  };
}

export function estimateOrderRisk(order) {
  const vertical = validateLongDebitVertical(order);
  if (vertical) return { bounded: true, maxLoss: vertical.maxLoss };
  const qty = orderQuantity(order?.qty);
  const limitPrice = optionLimit(order?.limit_price);
  if (qty !== null && limitPrice !== null && (!order.order_class || order.order_class === "simple") &&
      order.type === "limit" && parseOcc(order.symbol) && order.side === "buy" &&
      order.position_intent === "buy_to_open") {
    return { bounded: true, maxLoss: round(limitPrice * 100 * qty, 2) };
  }
  return unboundedRisk();
}
export function parseOcc(symbol){const m=String(symbol).match(/^([A-Z0-9.]{1,8})(\d{6})([CP])(\d{8})$/);if(!m)return null;return{root:m[1],expiry:"20"+m[2].slice(0,2)+"-"+m[2].slice(2,4)+"-"+m[2].slice(4,6),cp:m[3],strike:Number(m[4])/1000}}

export function deriveTrendSignal(bars){const closes=(bars||[]).map(b=>Number(b.c)).filter(Number.isFinite);if(closes.length<6)return{direction:"neutral",confidence:0,score:50,return5:null,return20:null,realizedVol:null,samples:closes.length};const last=closes.at(-1),r5=last/closes.at(-6)-1,r20=closes.length>=21?last/closes.at(-21)-1:null,rets=[];for(let i=1;i<closes.length;i++)rets.push(Math.log(closes[i]/closes[i-1]));const mean=rets.reduce((a,b)=>a+b,0)/rets.length,variance=rets.reduce((a,b)=>a+(b-mean)**2,0)/Math.max(1,rets.length-1),vol=Math.sqrt(variance)*Math.sqrt(252);const raw=50+r5*500+(r20??0)*250,score=clamp(raw,0,100),direction=score>=58?"bull":score<=42?"bear":"neutral",confidence=round(Math.min(100,Math.abs(score-50)*2),1);return{direction,confidence,score:round(score,1),return5:round(r5,4),return20:r20==null?null:round(r20,4),realizedVol:round(vol,4),samples:closes.length}}
export function rankCandidatesForSignal(candidates,signal){return(candidates||[]).map(c=>{const bull=c.strategy==="bull_call_debit_spread"||c.strategy==="long_call",bear=c.strategy==="bear_put_debit_spread"||c.strategy==="long_put";let alignment=0;if(signal?.direction==="bull")alignment=bull?signal.confidence*.22:bear?-signal.confidence*.32:0;else if(signal?.direction==="bear")alignment=bear?signal.confidence*.22:bull?-signal.confidence*.32:0;else alignment=-8;return{...c,baseScore:c.score,signalDirection:signal?.direction||"neutral",signalConfidence:signal?.confidence||0,score:round(clamp(Number(c.score||0)+alignment,0,100),1)}}).sort((a,b)=>b.score-a.score||(b.rewardRisk||0)-(a.rewardRisk||0))}

export function requiredOptionsLevel(order){if(order?.order_class==="mleg")return 3;const intent=order?.position_intent;if(order?.side==="buy"&&(intent==="buy_to_open"||!intent))return 2;if(order?.side==="sell"&&intent==="sell_to_open")return 1;return 1}
