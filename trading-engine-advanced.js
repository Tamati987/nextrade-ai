// ═══════════════════════════════════════════════════════════════════════════
//   NEXTRADE AI — MOTEUR DE TRADING AVANCÉ
//   Claude contrôle les positions court/moyen/long terme simultanément
// ═══════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const fetch = require('node-fetch');
const fs = require('fs');
require('dotenv').config();

const { 
  askClaudeForTradingDecisions, 
  MultiHorizonPositionManager,
  loadDecisions 
} = require('./claude-trading-decisioner');

const BYBIT_API = 'https://api.bybit.com';
const API_KEY = process.env.BYBIT_API_KEY;
const API_SECRET = process.env.BYBIT_SECRET;

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || '.';
const POSITIONS_FILE = `${DATA_DIR}/positions-multi.json`;
const EQUITY_FILE = `${DATA_DIR}/equity.json`;

// ── BOTS CONFIGURATION ──
const BOTS = [
  { id: 'gold', name: 'Gold Sentinel', symbol: 'XAUTUSDT', capital: 7, active: true, interval: '15', qtyDec: 5 },
  { id: 'btc', name: 'Alpha BTC', symbol: 'BTCUSDT', capital: 7, active: true, interval: '15', qtyDec: 6 },
  { id: 'eth', name: 'Grid ETH', symbol: 'ETHUSDT', capital: 7, active: true, interval: '15', qtyDec: 5 },
  { id: 'sol', name: 'Sol Momentum', symbol: 'SOLUSDT', capital: 3, active: true, interval: '15', qtyDec: 2 },
  { id: 'xrp', name: 'XRP Surge', symbol: 'XRPUSDT', capital: 3, active: true, interval: '15', qtyDec: 1 },
];

// ── MULTI-HORIZON POSITION MANAGER ──
const positionManager = new MultiHorizonPositionManager();
const botEquity = new Map();

function saveEquity() {
  try {
    fs.writeFileSync(EQUITY_FILE, JSON.stringify(Object.fromEntries(botEquity), null, 2));
  } catch (e) {
    console.error('⚠️ Échec sauvegarde capital:', e.message);
  }
}

function loadEquity() {
  try {
    if (fs.existsSync(EQUITY_FILE)) {
      const obj = JSON.parse(fs.readFileSync(EQUITY_FILE, 'utf8'));
      for (const [id, v] of Object.entries(obj)) botEquity.set(id, v);
      console.log(`📂 Capital composé restauré`);
    }
  } catch (e) {
    console.error('⚠️ Échec chargement capital:', e.message);
  }
}

function getBotEquity(bot) {
  if (!botEquity.has(bot.id)) botEquity.set(bot.id, bot.capital);
  return botEquity.get(bot.id);
}

function applyTradePnl(bot, pnl) {
  const newEquity = Math.max(getBotEquity(bot) + pnl, 0.5);
  botEquity.set(bot.id, newEquity);
  saveEquity();
  console.log(`📊 Capital ${bot.name}: $${newEquity.toFixed(2)} (${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)})`);
}

// ── API HELPER ──
function sign(params, ts) {
  return crypto.createHmac('sha256', API_SECRET).update(ts + API_KEY + '5000' + params).digest('hex');
}

async function api(method, path, params = {}) {
  const ts = Date.now().toString();
  const str = method === 'GET' ? new URLSearchParams(params).toString() : JSON.stringify(params);
  const url = method === 'GET' ? `${BYBIT_API}${path}?${str}` : `${BYBIT_API}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'X-BAPI-API-KEY': API_KEY,
      'X-BAPI-SIGN': sign(str, ts),
      'X-BAPI-TIMESTAMP': ts,
      'X-BAPI-RECV-WINDOW': '5000',
      'Content-Type': 'application/json',
    },
    body: method !== 'GET' ? str : undefined,
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Réponse non-JSON de Bybit: ${text.slice(0, 80)}`);
  }
}

async function getCandles(symbol, interval) {
  const d = await api('GET', '/v5/market/kline', { category: 'spot', symbol, interval, limit: 100 });
  if (d.retCode !== 0) throw new Error(d.retMsg);
  return d.result.list.map(c => ({ t: +c[0], o: +c[1], h: +c[2], l: +c[3], c: +c[4] })).reverse();
}

async function getPrice(symbol) {
  const d = await api('GET', '/v5/market/tickers', { category: 'spot', symbol });
  if (d.retCode !== 0) throw new Error(d.retMsg);
  return +d.result.list[0].lastPrice;
}

async function getBalance() {
  const d = await api('GET', '/v5/account/wallet-balance', { accountType: 'UNIFIED' });
  if (d.retCode !== 0) throw new Error(d.retMsg);
  const usdt = d.result.list[0]?.coin?.find(c => c.coin === 'USDT');
  return +(usdt?.walletBalance || 0);
}

function rsi(candles, p = 14) {
  let g = 0, l = 0;
  for (let i = candles.length - p; i < candles.length; i++) {
    const d = candles[i].c - candles[i - 1].c;
    d > 0 ? g += d : l -= d;
  }
  const al = l / p;
  return al === 0 ? 100 : +(100 - 100 / (1 + (g / p) / al)).toFixed(2);
}

function ema(candles, p) {
  const k = 2 / (p + 1);
  let e = candles[0].c;
  for (const c of candles) e = c.c * k + e * (1 - k);
  return e;
}

// ── EXECUTION DES ORDRES CLAUDE ──
async function executeClaudeDecision(bot, decision, price) {
  const decisions = [];

  // Court terme
  if (decision.shortTerm?.action === 'BUY') {
    const capital = getBotEquity(bot) * 0.3; // 30% du capital pour court terme
    console.log(`🟢 ACHAT COURT TERME ${bot.name} @ $${price} | $${capital.toFixed(2)}`);
    const pos = {
      horizon: 'SHORT',
      entryPrice: price,
      tp: price * (1 + decision.shortTerm.tp / 100),
      sl: price * (1 - decision.shortTerm.sl / 100),
      capital,
      openedAt: new Date().toISOString(),
      reason: decision.shortTerm.reason,
    };
    positionManager.addPosition(bot.id, 'shortTerm', pos);
    decisions.push('SHORT_TERM_BUY');
  }

  // Moyen terme
  if (decision.mediumTerm?.action === 'BUY') {
    const capital = getBotEquity(bot) * 0.5; // 50% du capital pour moyen terme
    console.log(`🟡 ACHAT MOYEN TERME ${bot.name} @ $${price} | $${capital.toFixed(2)}`);
    const pos = {
      horizon: 'MEDIUM',
      entryPrice: price,
      tp: price * (1 + decision.mediumTerm.tp / 100),
      sl: price * (1 - decision.mediumTerm.sl / 100),
      capital,
      openedAt: new Date().toISOString(),
      reason: decision.mediumTerm.reason,
    };
    positionManager.addPosition(bot.id, 'mediumTerm', pos);
    decisions.push('MEDIUM_TERM_BUY');
  }

  // Long terme
  if (decision.longTerm?.action === 'BUY') {
    const capital = getBotEquity(bot); // 100% du capital pour long terme (position principale)
    console.log(`🔵 ACHAT LONG TERME ${bot.name} @ $${price} | $${capital.toFixed(2)}`);
    const pos = {
      horizon: 'LONG',
      entryPrice: price,
      tp: price * (1 + decision.longTerm.tp / 100),
      sl: price * (1 - decision.longTerm.sl / 100),
      capital,
      openedAt: new Date().toISOString(),
      reason: decision.longTerm.reason,
    };
    positionManager.addPosition(bot.id, 'longTerm', pos);
    decisions.push('LONG_TERM_BUY');
  }

  return decisions;
}

// ── BOT PRINCIPAL ──
async function runBot(bot) {
  try {
    const candles = await getCandles(bot.symbol, bot.interval);
    const price = await getPrice(bot.symbol);
    const r = rsi(candles);
    const e9 = ema(candles, 9);
    const e21 = ema(candles, 21);

    // Préparer les données de marché
    const firstClose = candles[0].c;
    const chg24h = (((price - firstClose) / firstClose) * 100).toFixed(2);
    const change7d = ((price - candles[Math.max(0, candles.length - 672)].c) / candles[Math.max(0, candles.length - 672)].c * 100).toFixed(2);
    const change30d = ((price - candles[Math.max(0, candles.length - 2880)].c) / candles[Math.max(0, candles.length - 2880)].c * 100).toFixed(2);
    const lastCloses = candles.slice(-5).map(c => c.c);
    const volatility = (Math.max(...candles.slice(-20).map(c => c.h)) - Math.min(...candles.slice(-20).map(c => c.l))) / price * 100;

    const marketData = {
      price,
      rsi: r,
      ema9: e9,
      ema21: e21,
      chg1h: chg24h,
      change24h: parseFloat(chg24h),
      change7d: parseFloat(change7d),
      change30d: parseFloat(change30d),
      volatility,
      lastCloses,
      trend: e9 > e21 ? 'UP' : 'DOWN',
    };

    console.log(`\n📊 ${bot.name} | $${price} | RSI:${r} | EMA9:${e9.toFixed(2)} | EMA21:${e21.toFixed(2)}`);

    // Demander à Claude
    const decision = await askClaudeForTradingDecisions(bot, marketData, '');
    
    if (decision.shortTerm || decision.mediumTerm || decision.longTerm) {
      await executeClaudeDecision(bot, decision, price);
    }

    // Vérifier positions existantes pour fermetures
    const activeHorizons = positionManager.getActivePositions(bot.id);
    for (const horizon of activeHorizons) {
      const pos = positionManager.getPosition(bot.id, horizon);
      if (!pos) continue;

      const pnlPercent = ((price - pos.entryPrice) / pos.entryPrice) * 100;

      if (price >= pos.tp) {
        console.log(`🎯 PRISE PROFIT ${horizon.toUpperCase()}: ${bot.name} @ $${price} | PnL: +${pnlPercent.toFixed(2)}%`);
        applyTradePnl(bot, pos.capital * (pnlPercent / 100));
        positionManager.removePosition(bot.id, horizon);
      } else if (price <= pos.sl) {
        console.log(`🛑 STOP LOSS ${horizon.toUpperCase()}: ${bot.name} @ $${price} | PnL: ${pnlPercent.toFixed(2)}%`);
        applyTradePnl(bot, pos.capital * (pnlPercent / 100));
        positionManager.removePosition(bot.id, horizon);
      }
    }

    const status = positionManager.statusForBot(bot.id);
    if (status.activeCount > 0) {
      console.log(`📈 Positions actives: ${status.details.join(' | ')}`);
    }
  } catch (e) {
    console.error(`❌ ${bot.name}:`, e.message);
  }
}

async function startTradingEngine() {
  console.log('\n🚀 NexTrade AI ADVANCED — Moteur Multi-Horizon');
  console.log('🧠 Claude Control — MULTI-HORIZON (Court/Moyen/Long Terme)');
  
  loadEquity();
  loadDecisions();

  try {
    const bal = await getBalance();
    console.log(`💰 Solde Bybit: $${bal.toFixed(2)} USDT`);
  } catch (e) {
    console.error('❌ Connexion Bybit:', e.message);
  }

  const cycle = async () => {
    console.log('\n⏰ Cycle:', new Date().toLocaleString('fr-FR'));
    for (const bot of BOTS.filter(b => b.active)) {
      await runBot(bot);
      await new Promise(r => setTimeout(r, 1500));
    }
  };

  await cycle();
  setInterval(cycle, 15 * 60 * 1000); // Toutes les 15 min
}

module.exports = {
  startTradingEngine,
  BOTS,
  positionManager,
  api,
  getBalance,
  getPrice,
  getBotEquity,
};
