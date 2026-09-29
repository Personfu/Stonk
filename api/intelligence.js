import{corporateActions,latestNews}from"./_lib/alpaca.js";import{fail,method,query,send}from"./_lib/http.js";
function day(offset){const d=new Date();d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10)}
const MACRO=[
  ["DFF","Fed funds"],["DGS2","2Y Treasury"],["DGS10","10Y Treasury"],
  ["VIXCLS","VIX"],["UNRATE","Unemployment"],["CPIAUCSL","CPI"]
];
async function fredLatest(id,key){const q=new URLSearchParams({series_id:id,api_key:key,file_type:"json",sort_order:"desc",limit:"2"});const r=await fetch("https://api.stlouisfed.org/fred/series/observations?"+q);if(!r.ok)throw new Error("FRED "+id+" request failed ("+r.status+")");const d=await r.json(),obs=(d.observations||[]).filter(x=>x.value!==".");return obs[0]||null}
export default async function handler(req,res){try{
  method(req,["GET"]);const symbol=(query(req).get("symbol")||"SPY").toUpperCase().replace(/[^A-Z0-9.-]/g,"");
  const [news,actions]=await Promise.all([latestNews(symbol,25),corporateActions(symbol,day(-30),day(30))]);
  const key=process.env.FRED_API_KEY;let macro=null,macroError=null;
  if(key){try{macro=Object.fromEntries(await Promise.all(MACRO.map(async([id,label])=>[id,{label,observation:await fredLatest(id,key)}])))}catch(e){macroError=e.message}}
  send(res,200,{ok:true,symbol,asOf:new Date().toISOString(),news,corporateActions:actions,macroConfigured:Boolean(key),macro,macroError});
}catch(e){fail(res,e)}}
