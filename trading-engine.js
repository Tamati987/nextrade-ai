const crypto = require('crypto');
const fetch = require('node-fetch');
require('dotenv').config();

const BYBIT_API  = 'https://api.bybit.com';
const API_KEY    = process.env.BYBIT_API_KEY;
const API_SECRET = process.env.BYBIT_SECRET;

const BOTS = [
  { id:'gold',  name:'Gold Sentinel', symbol:'XAUUSDT', capital:50, leverage:2, rsi_buy:35, rsi_sell:65, tp:0.025, sl:0.015, active:true, interval:'15' },
  { id:'btc',   name:'Alpha RSI',     symbol:'BTCUSDT', capital:50, leverage:2, rsi_buy:35, rsi_sell:68, tp:0.030, sl:0.020, active:true, interval:'15' },
  { id:'eth',   name:'Grid ETH',      symbol:'ETHUSDT', capital:30, leverage:2, rsi_buy:40, rsi_sell:60, tp:0.025, sl:0.015, active:true, interval:'15' },
  { id:'eur',   name:'Bollinger FX',  symbol:'EURUSDT', capital:30, leverage:2, rsi_buy:38, rsi_sell:62, tp:0.020, sl:0.012, active:true, interval:'15' },
  { id:'gbp',   name:'Momentum GBP',  symbol:'GBPUSDT', capital:20, leverage:2, rsi_buy:38, rsi_sell:65, tp:0.020, sl:0.012, active:true, interval:'15' },
];

const positions = new Map();

function sign(params, ts) {
  return crypto.createHmac('sha256', API_SECRET).update(ts + API_KEY + '5000' + params).digest('hex');
}

async function api(method, path, params = {}) {
  const ts  = Date.now().toString();
  const str = method === 'GET' ? new URLSearchParams(params).toString() : JSON.stringify(params);
  const url = method === 'GET' ? `${BYBIT_API}${path}?${str}` : `${BYBIT_API}${path}`;
  const res = await fetch(url, {
    method,
    headers: { 'X-BAPI-API-KEY': API_KEY, 'X-BAPI-SIGN': sign(str, ts), 'X-BAPI-TIMESTAMP': ts, 'X-BAPI-RECV-WINDOW': '5000', 'Content-Type': 'application/json' },
    body: method !== 'GET' ? str : undefined,
  });
  return res.json();
}

async function getCandles(symbol, interval) {
  const d = await api('GET', '/v5/market/kline', { category:'linear', symbol, interval, limit:100 });
  return d.result.list.map(c => ({ t:+c[0], o:+c[1], h:+c[2], l:+c[3], c:+c[4] })).reverse();
}

async function getPrice(symbol) {
  const d = await api('GET', '/v5/market/tickers', { category:'linear', symbol });
  return +d.result.list[0].lastPrice;
}

async function getBalance() {
  const d = await api('GET', '/v5/account/wallet-balance', { accountType:'UNIFIED' });
  return +d.result.list[0]?.coin?.find(c => c.coin === 'USDT')?.availableToWithdraw || 0;
}

function rsi(candles, p = 14) {
  let g = 0, l = 0;
  for (let i = candles.length - p; i < candles.length; i++) {
    const d = candles[i].c - candles[i-1].c;
    d > 0 ? g += d : l -= d;
  }
  const al = l / p;
  return al === 0 ? 100 : +(100 - 100 / (1 + (g/p) / al)).toFixed(2);
}

function ema(candles, p) {
  const k = 2 / (p + 1);
  let e = candles[0].c;
  for (const c of candles) e = c.c * k + e * (1 - k);
  return e;
}

async function order(bot, side, price) {
  const qty = (bot.capital * bot.leverage / price).toFixed(3);
  console.log(`\n🤖 ${bot.name} | ${side.toUpperCase()} ${bot.symbol} @ $${price} | Qty: ${qty}`);
  const d = await api('POST', '/v5/order/create', { category:'linear', symbol:bot.symbol, side: side==='buy'?'Buy':'Sell', orderType:'Market', qty, timeInForce:'GTC', reduceOnly:false });
  if (d.retCode !== 0) { console.error('❌', d.retMsg); return null; }
  console.log('✅ Ordre OK:', d.result.orderId);
  return { orderId:d.result.orderId, price, qty:+qty, side };
}

async function close(bot, price) {
  const pos = positions.get(bot.id);
  if (!pos) return;
  const d = await api('POST', '/v5/order/create', { category:'linear', symbol:bot.symbol, side: pos.side==='buy'?'Sell':'Buy', orderType:'Market', qty:pos.qty.toString(), timeInForce:'GTC', reduceOnly:true });
  if (d.retCode === 0) {
    const pnl = pos.side === 'buy' ? (price - pos.price) * pos.qty : (pos.price - price) * pos.qty;
    console.log(`💰 ${bot.name} fermé | PnL: ${pnl>=0?'+':''}$${pnl.toFixed(2)}`);
    positions.delete(bot.id);
    return pnl;
  }
  console.error('❌ Fermeture échouée:', d.retMsg);
}

async function runBot(bot) {
  try {
    const candles = await getCandles(bot.symbol, bot.interval);
    const price   = await getPrice(bot.symbol);
    const r       = rsi(candles);
    const e9      = ema(candles, 9);
    const e21     = ema(candles, 21);
    const pos     = positions.get(bot.id);
    console.log(`\n📊 ${bot.name} | $${price} | RSI:${r} | EMA9:${e9.toFixed(2)} | EMA21:${e21.toFixed(2)}`);
    if (pos) {
      const pct = pos.side==='buy' ? (price-pos.price)/pos.price : (pos.price-price)/pos.price;
      console.log(`📈 Position ${pos.side} @ $${pos.price} | PnL: ${(pct*100).toFixed(2)}%`);
      if (pct >= bot.tp)   { console.log('🎯 Take Profit!'); await close(bot, price); return; }
      if (pct <= -bot.sl)  { console.log('🛑 Stop Loss!');   await close(bot, price); return; }
      if (pos.side==='buy'  && r > bot.rsi_sell && e9 < e21) { await close(bot, price); return; }
      if (pos.side==='sell' && r < bot.rsi_buy  && e9 > e21) { await close(bot, price); return; }
      return;
    }
    if (r < bot.rsi_buy && e9 > e21) {
      console.log(`🟢 ACHAT! RSI=${r}`);
      const bal = await getBalance();
      if (bal < bot.capital) { console.log(`⚠️ Solde insuffisant: $${bal}`); return; }
      const o = await order(bot, 'buy', price);
      if (o) positions.set(bot.id, { ...o, openedAt: new Date() });
    } else if (r > bot.rsi_sell && e9 < e21) {
      console.log(`🔴 VENTE! RSI=${r}`);
      const bal = await getBalance();
      if (bal < bot.capital) { console.log(`⚠️ Solde insuffisant: $${bal}`); return; }
      const o = await order(bot, 'sell', price);
      if (o) positions.set(bot.id, { ...o, openedAt: new Date() });
    } else {
      console.log(`⏳ Pas de signal (RSI=${r})`);
    }
  } catch (e) {
    console.error(`❌ ${bot.name}:`, e.message);
  }
}

async function startTradingEngine() {
  console.log('\n🚀 NexTrade AI — Moteur de trading Bybit démarré');
  try {
    const bal = await getBalance();
    console.log(`💰 Solde Bybit: $${bal} USDT`);
  } catch(e) {
    console.error('❌ Connexion Bybit échouée:', e.message);
  }
  const cycle = async () => {
    console.log('\n⏰ Cycle:', new Date().toLocaleString('fr-FR'));
    for (const bot of BOTS.filter(b => b.active)) {
      await runBot(bot);
      await new Promise(r => setTimeout(r, 1500));
    }
  };
  await cycle();
  setInterval(cycle, 15 * 60 * 1000); // toutes les 15 min
}

module.exports = { startTradingEngine, BOTS, positions };
