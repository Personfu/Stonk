import{accountSummary,clock,openOrders,positions,optionContracts,optionSnapshots,stockBars,submitOrder}from"./_lib/alpaca.js";
import{normalizeChain,scanStrategies,deriveTrendSignal,rankCandidatesForSignal,candidateToOrder,estimateOrderRisk,requiredOptionsLevel,parseOcc}from"./_lib/strategy.js";
import{fail,send}from"./_lib/http.js";

function authorized(req){
  const cron=process.env.CRON_SECRET,operator=process.env.STONK_TRADING_SECRET,auth=req.headers.authorization||"";
  return(cron&&auth==="Bearer "+cron)||(operator&&auth==="Bearer "+operator);
}
function datePlus(days){const d=new Date();d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)}
export function automationOrderId(timestamp){
  return "stonk-auto-"+new Date(timestamp).toISOString().slice(0,10).replaceAll("-","");
}
function rootOf(symbol){return parseOcc(symbol)?.root||String(symbol||"").toUpperCase()}
function exposureRoots(currentPositions,currentOrders){
  const roots=new Set();
  for(const p of currentPositions||[])roots.add(rootOf(p.symbol));
  for(const o of currentOrders||[]){
    if(o.symbol)roots.add(rootOf(o.symbol));
    for(const leg of o.legs||[])if(leg.symbol)roots.add(rootOf(leg.symbol));
  }
  return roots;
}

export default async function handler(req,res){
  try{
    if(!authorized(req)){const e=new Error("Automation authorization required");e.status=401;throw e}
    if(process.env.STONK_AUTOTRADE_ENABLED!=="true")return send(res,200,{ok:true,enabled:false,message:"Automation is disabled"});
    const[marketClock,account,currentPositions,currentOrders]=await Promise.all([clock(),accountSummary(),positions(),openOrders()]);
    if(!marketClock?.is_open)return send(res,200,{ok:true,enabled:true,marketOpen:false,nextOpen:marketClock?.next_open,mode:"live"});
    if(account.tradingBlocked||account.status!=="ACTIVE"){const e=new Error("Broker account is not active for trading");e.status=403;throw e}
    if(Number(account.optionsTradingLevel||0)===0){const e=new Error("Options trading is disabled on the broker account");e.status=403;throw e}

    const execute=process.env.STONK_AUTOTRADE_EXECUTE==="true";
    const dailyLossCap=Number(process.env.STONK_MAX_DAILY_LOSS_USD??500);
    if(!Number.isFinite(dailyLossCap)||dailyLossCap<=0){const e=new Error("Daily loss cap is not configured correctly");e.status=503;throw e}
    if(execute&&!Number.isFinite(account.dayPnL)){const e=new Error("Broker daily P&L is unavailable");e.status=503;throw e}
    if(account.dayPnL!=null&&account.dayPnL<=-dailyLossCap){
      return send(res,200,{ok:true,enabled:true,marketOpen:true,mode:"live",circuitBreaker:true,reason:"daily_loss",dayPnL:account.dayPnL,dailyLossCap});
    }

    const universe=(process.env.STONK_AUTOTRADE_UNIVERSE||"SPY,QQQ,AAPL,MSFT,NVDA").split(",").map(x=>x.trim().toUpperCase()).filter(Boolean);
    const maxSymbols=Math.max(1,Math.min(20,Number(process.env.STONK_AUTOTRADE_MAX_SYMBOLS||6)));
    const minScore=Number(process.env.STONK_AUTOTRADE_MIN_SCORE||72);
    const riskCap=Number(process.env.STONK_MAX_RISK_PER_TRADE_USD??250);
    if(!Number.isFinite(riskCap)||riskCap<=0){const e=new Error("Per-trade risk cap is not configured correctly");e.status=503;throw e}
    const allowed=new Set((process.env.STONK_AUTOTRADE_ALLOWED_STRATEGIES||"bull_call_debit_spread,bear_put_debit_spread").split(",").map(x=>x.trim()).filter(Boolean));
    const existing=exposureRoots(currentPositions,currentOrders);
    const params={expiration_date_gte:datePlus(7),expiration_date_lte:datePlus(45)};
    const ideas=[],skipped=[];

    for(const symbol of universe.slice(0,maxSymbols)){
      if(existing.has(symbol)){skipped.push({symbol,reason:"existing_position_or_open_order"});continue}
      try{
        const[contracts,snapshots,bars]=await Promise.all([optionContracts(symbol,params),optionSnapshots(symbol,params),stockBars(symbol,45)]);
        const signal=deriveTrendSignal(bars);
        const top=rankCandidatesForSignal(scanStrategies(normalizeChain(contracts,snapshots)),signal)
          .find(c=>signal.direction!=="neutral"&&allowed.has(c.strategy)&&c.score>=minScore&&c.maxLoss!=null&&c.maxLoss<=riskCap&&(c.rewardRisk==null||c.rewardRisk>=1));
        if(top)ideas.push({...top,signal});
        else skipped.push({symbol,reason:"no_candidate_passed_gates",signal});
      }catch(error){skipped.push({symbol,reason:"data_or_scan_error",error:error.message})}
    }

    const ranked=ideas.sort((a,b)=>b.score-a.score);
    const placed=[];
    let availableOptionsBp=Number(account.optionsBuyingPower);

    if(execute){
      // The broker rejects a repeated client order ID, including concurrent
      // invocations on separate serverless instances. Reserve one ID per
      // trading date until a durable, atomic order budget is available.
      const dailyOrderId=automationOrderId(marketClock.timestamp||Date.now());
      for(const candidate of ranked){
        const order=candidateToOrder(candidate,1),risk=estimateOrderRisk(order);
        if(!risk.bounded||risk.maxLoss==null||risk.maxLoss>riskCap)continue;
        if(Number(account.optionsTradingLevel||0)<requiredOptionsLevel(order)){skipped.push({symbol:candidate.underlying,reason:"insufficient_options_approval"});continue}
        if(!Number.isFinite(availableOptionsBp)||availableOptionsBp<risk.maxLoss){skipped.push({symbol:candidate.underlying,reason:"insufficient_options_buying_power"});continue}
        order.client_order_id=dailyOrderId;
        let brokerOrder;
        try{brokerOrder=await submitOrder(order)}
        catch(error){
          if(error.status===422&&/duplicate|client.order.id/i.test(error.message)){
            skipped.push({symbol:candidate.underlying,reason:"daily_auto_order_already_submitted"});
            break;
          }
          throw error;
        }
        placed.push({candidate,brokerOrder,risk});
        availableOptionsBp-=risk.maxLoss;
        existing.add(candidate.underlying);
        break;
      }
    }

    send(res,200,{
      ok:true,enabled:true,marketOpen:true,mode:"live",execute,
      account:{equity:account.equity,optionsBuyingPower:account.optionsBuyingPower,dayPnL:account.dayPnL},
      screened:universe.slice(0,maxSymbols),existingExposure:[...existing],ranked:ranked.slice(0,10),skipped,placed
    });
  }catch(e){fail(res,e)}
}
