// ═══════════════════════════════════════════════════════
//   NEXTRADE AI — MOTEUR DE TRADING BYBIT (SPOT)
//   Buy Low / Sell High — adapté petit capital
// ═══════════════════════════════════════════════════════
const crypto = require('crypto');
const fetch = require('node-fetch');
require('dotenv').config();

const BYBIT_API  = 'https://api.bybit.com';
const API_KEY    = process.env.BYBIT_API_KEY;
const API_SECRET = process.env.BYBIT_SECRET;

// SPOT uniquement : achat bas → vente haute (pas de short, pas de levier)
// Capital adapté à ~22 USDT au total
const BOTS = [
  { id:'gold', name:'Gold Sentinel', symbol:'PAXGUSDT', capital:7, rsi_buy:38, rsi_sell:65, tp:0.025, sl:0.02, active:true, interval:'15', qtyDec:5 },
  { id:'btc',  name:'Alpha RSI',     symbol:'BTCUSDT',  capital:7, rsi_buy:35, rsi_sell:68, tp:0.030, sl:0.02, active:true, interval:'15', qtyDec:6 },
  { id:'eth',  name:'Grid ETH',      symbol:'ETHUSDT',  capital:7, rsi_buy:40, rsi_sell:62, tp:0.025, sl:0.02, active:true, interval:'15', qtyDec:5 },
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
  const text = await res.text();
  try { return JSON.parse(text); }
  catch(e) { throw new Error(`Réponse non-JSON de Bybit (blocage géographique probable): ${text.slice(0,80)}`); }
}

async function getCandles(symbol, interval) {
  const d = await api('GET', '/v5/market/kline', { category:'spot', symbol, interval, limit:100 });
  if (d.retCode !== 0) throw new Error(d.retMsg);
  return d.result.list.map(c => ({ t:+c[0], o:+c[1], h:+c[2], l:+c[3], c:+c[4] })).reverse();
}

async function getPrice(symbol) {
  const d = await api('GET', '/v5/market/tickers', { category:'spot', symbol });
  if (d.retCode !== 0) throw new Error(d.retMsg);
  return +d.result.list[0].lastPrice;
}

async function getBalance() {
  const d = await api('GET', '/v5/account/wallet-balance', { accountType:'UNIFIED' });
  if (d.retCode !== 0) throw new Error(d.retMsg);
  const usdt = d.result.list[0]?.coin?.find(c => c.coin === 'USDT');
  return +(usdt?.walletBalance || 0);
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

// SPOT: on achète en montant USDT (marketUnit quoteCoin), on revend la quantité de coin
async function buySpot(bot, price) {
  console.log(`\n🟢 ${bot.name} | ACHAT ${bot.symbol} @ $${price} | ${bot.capital} USDT`);
  const d = await api('POST', '/v5/order/create', {
    category:'spot', symbol:bot.symbol, side:'Buy', orderType:'Market',
    qty: bot.capital.toFixed(2), marketUnit:'quoteCoin', timeInForce:'IOC',
  });
  if (d.retCode !== 0) { console.error('❌ Achat échoué:', d.retMsg); return null; }
  const qty = +(bot.capital / price).toFixed(bot.qtyDec);
  console.log('✅ Achat OK:', d.result.orderId, '| ~', qty, bot.symbol.replace('USDT',''));
  return { orderId:d.result.orderId, price, qty, side:'buy' };
}

async function sellSpot(bot, price) {
  const pos = positions.get(bot.id);
  if (!pos) return;
  console.log(`\n🔴 ${bot.name} | VENTE ${bot.symbol} @ $${price} | qty ${pos.qty}`);
  const d = await api('POST', '/v5/order/create', {
    category:'spot', symbol:bot.symbol, side:'Sell', orderType:'Market',
    qty: pos.qty.toString(), marketUnit:'baseCoin', timeInForce:'IOC',
  });
  if (d.retCode !== 0) { console.error('❌ Vente échouée:', d.retMsg); return; }
  const pnl = (price - pos.price) * pos.qty;
  console.log(`💰 ${bot.name} vendu | PnL: ${pnl>=0?'+':''}$${pnl.toFixed(2)}`);
  positions.delete(bot.id);
  return pnl;
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
      const pct = (price - pos.price) / pos.price;
      console.log(`📈 Position achetée @ $${pos.price} | PnL: ${(pct*100).toFixed(2)}%`);
      if (pct >= bot.tp)  { console.log('🎯 Take Profit!'); await sellSpot(bot, price); return; }
      if (pct <= -bot.sl) { console.log('🛑 Stop Loss!');   await sellSpot(bot, price); return; }
      if (r > bot.rsi_sell) { console.log(`🔄 RSI haut (${r}) → vente`); await sellSpot(bot, price); return; }
      return;
    }

    // Achat uniquement quand c'est BAS (RSI bas + tendance qui repart)
    if (r < bot.rsi_buy && e9 > e21) {
      const bal = await getBalance();
      if (bal < bot.capital) { console.log(`⚠️ Solde insuffisant: $${bal.toFixed(2)}`); return; }
      const o = await buySpot(bot, price);
      if (o) positions.set(bot.id, { ...o, openedAt: new Date() });
    } else {
      console.log(`⏳ Pas de signal d'achat (RSI=${r}, cible <${bot.rsi_buy})`);
    }
  } catch (e) {
    console.error(`❌ ${bot.name}:`, e.message);
  }
}

async function startTradingEngine() {
  console.log('\n🚀 NexTrade AI — Moteur SPOT Bybit démarré (Buy Low / Sell High)');
  try {
    const bal = await getBalance();
    console.log(`💰 Solde Bybit: $${bal.toFixed(2)} USDT`);
  } catch(e) {
    console.error('❌ Connexion Bybit:', e.message);
    console.log('💡 Si "blocage géographique": changez la région Railway vers EU West (Settings → Region)');
  }
  const cycle = async () => {
    console.log('\n⏰ Cycle:', new Date().toLocaleString('fr-FR'));
    for (const bot of BOTS.filter(b => b.active)) {
      await runBot(bot);
      await new Promise(r => setTimeout(r, 1500));
    }
  };
  await cycle();
  setInterval(cycle, 15 * 60 * 1000);
}

module.exports = { startTradingEngine, BOTS, positions, api, getBalance, getPrice };
