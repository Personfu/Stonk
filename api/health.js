import{send}from"./_lib/http.js";import{liveTradingAllowed}from"./_lib/alpaca.js";
export default async function handler(req,res){
  send(res,200,{
    ok:true,
    service:"stonk",
    mode:"live",
    liveOnly:true,
    alpacaConfigured:Boolean((process.env.ALPACA_API_KEY_ID||process.env.APCA_API_KEY_ID)&&(process.env.ALPACA_API_SECRET_KEY||process.env.APCA_API_SECRET_KEY)),
    liveTradingAllowed:liveTradingAllowed(),
    autoTradeEnabled:process.env.STONK_AUTOTRADE_ENABLED==="true",
    autoTradeExecute:process.env.STONK_AUTOTRADE_EXECUTE==="true",
    time:new Date().toISOString()
  })
}
