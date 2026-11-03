const DATA="https://data.alpaca.markets";
const LIVE_TRADING="https://api.alpaca.markets";

function keys(){
  const key=process.env.ALPACA_API_KEY_ID||process.env.APCA_API_KEY_ID;
  const secret=process.env.ALPACA_API_SECRET_KEY||process.env.APCA_API_SECRET_KEY;
  if(!key||!secret){const e=new Error("Live Alpaca credentials are not configured");e.status=503;throw e}
  return{key,secret}
}

export function tradingMode(){return"live"}
export function liveTradingAllowed(){return process.env.STONK_ALLOW_LIVE_TRADING==="I_UNDERSTAND_REAL_MONEY"}
export function tradingBase(){
  if(!liveTradingAllowed()){const e=new Error("Live trading acknowledgement is not configured");e.status=403;throw e}
  const hosted=process.env.VERCEL==="1"||process.env.NODE_ENV==="production";
  if(hosted&&process.env.STONK_SINGLE_OWNER_ACCOUNT!=="I_UNDERSTAND_ONE_SHARED_ACCOUNT"){
    const e=new Error("Single-owner broker access is disabled on this deployment");e.status=403;throw e
  }
  return LIVE_TRADING
}

function headers(extra={}){
  const{key,secret}=keys();
  return{"APCA-API-KEY-ID":key,"APCA-API-SECRET-KEY":secret,accept:"application/json",...extra}
}

async function request(url,options={}){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),12000);
  try{
    const r=await fetch(url,{...options,headers:headers(options.headers),signal:c.signal});
    const text=await r.text();
    let payload=null;
    try{payload=text?JSON.parse(text):null}catch{payload={raw:text}}
    if(!r.ok){const e=new Error(payload?.message||("Alpaca request failed ("+r.status+")"));e.status=r.status;e.upstream=payload;throw e}
    return payload
  }finally{clearTimeout(t)}
}

export function market(path){return request(DATA+path)}
export function trading(path,options={}){return request(tradingBase()+path,options)}
export function stockFeed(){return process.env.ALPACA_STOCK_DATA_FEED||"iex"}
export function optionFeed(){return process.env.ALPACA_OPTION_DATA_FEED||process.env.ALPACA_MARKET_DATA_FEED||"indicative"}
export async function stockBars(symbol,days=45){const start=new Date(Date.now()-Math.max(10,days)*86400000).toISOString();const q=new URLSearchParams({timeframe:"1Day",start,limit:"100",adjustment:"all",feed:stockFeed()});const d=await market("/v2/stocks/"+encodeURIComponent(symbol)+"/bars?"+q);return d?.bars||[]}
export async function latestNews(symbol,limit=20){const q=new URLSearchParams({symbols:symbol,limit:String(Math.max(1,Math.min(50,limit))),sort:"desc",include_content:"false"});const d=await market("/v1beta1/news?"+q);return d?.news||[]}
export async function corporateActions(symbol,start,end){const q=new URLSearchParams({symbols:symbol,data_quality:"complete"});if(start)q.set("start",start);if(end)q.set("end",end);return market("/v1/corporate-actions?"+q)}
export async function optionSnapshots(symbol,params={}){const q=new URLSearchParams({feed:optionFeed(),limit:"1000",...Object.fromEntries(Object.entries(params).filter(([,v])=>v!==undefined&&v!==null&&v!==""))});let token="";const snapshots={};for(let page=0;page<5;page++){if(token)q.set("page_token",token);const d=await market("/v1beta1/options/snapshots/"+encodeURIComponent(symbol)+"?"+q);Object.assign(snapshots,d?.snapshots||{});token=d?.next_page_token||"";if(!token)break}return snapshots}
export async function optionContracts(symbol,params={}){const q=new URLSearchParams({underlying_symbols:symbol,status:"active",limit:"10000",...Object.fromEntries(Object.entries(params).filter(([,v])=>v!==undefined&&v!==null&&v!==""))});let token="";const out=[];for(let page=0;page<5;page++){if(token)q.set("page_token",token);const d=await trading("/v2/options/contracts?"+q);out.push(...(d?.option_contracts||[]));token=d?.next_page_token||"";if(!token)break}return out}
export async function accountSummary() {
  const account = await trading("/v2/account");
  const numberOrNull = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const equity = numberOrNull(account.equity);
  const lastEquity = numberOrNull(account.last_equity);
  return {
    status: account.status,
    currency: account.currency,
    equity,
    cash: numberOrNull(account.cash),
    buyingPower: numberOrNull(account.buying_power),
    optionsBuyingPower: numberOrNull(account.options_buying_power),
    optionsApprovedLevel: account.options_approved_level,
    optionsTradingLevel: account.options_trading_level,
    lastEquity,
    dayPnL: equity !== null && lastEquity !== null ? equity - lastEquity : null,
    patternDayTrader: account.pattern_day_trader,
    tradingBlocked: account.trading_blocked,
    transfersBlocked: account.transfers_blocked,
    mode: "live",
  };
}
export async function clock(){return trading("/v2/clock")}
export async function openOrders(){return trading("/v2/orders?status=open&limit=500&nested=true")}
export async function positions(){return trading("/v2/positions")}
export async function submitOrder(order){return trading("/v2/orders",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(order)})}
