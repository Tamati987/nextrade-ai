// ═══════════════════════════════════════════════════════
//   NEXTRADE AI — MOTEUR DE TRADING BYBIT (SPOT)
//   Buy Low / Sell High — adapté petit capital
//   + Filtre anti-signal-prématuré (RSI rebond + confirmation 2 cycles)
// ═══════════════════════════════════════════════════════
const crypto = require('crypto');
const fetch = require('node-fetch');
const fs = require('fs');
require('dotenv').config();

const BYBIT_API  = 'https://api.bybit.com';
const API_KEY    = process.env.BYBIT_API_KEY;
const API_SECRET = process.env.BYBIT_SECRET;

// ── PERSISTANCE DES POSITIONS (survit aux redéploiements via Volume Railway) ──
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || '.'; // fallback local si pas de volume
const POSITIONS_FILE = `${DATA_DIR}/positions.json`;

function savePositions() {
  try {
    const obj = Object.fromEntries(positions);
    fs.writeFileSync(POSITIONS_FILE, JSON.stringify(obj, null, 2));
  } catch (e) {
    console.error('⚠️ Échec sauvegarde positions:', e.message);
  }
}

function loadPositions() {
  try {
    if (fs.existsSync(POSITIONS_FILE)) {
      const obj = JSON.parse(fs.readFileSync(POSITIONS_FILE, 'utf8'));
      for (const [id, pos] of Object.entries(obj)) positions.set(id, pos);
      console.log(`📂 ${positions.size} position(s) restaurée(s) depuis ${POSITIONS_FILE}`);
    } else {
      console.log(`📂 Aucun fichier de positions trouvé (${POSITIONS_FILE}) — départ à zéro`);
    }
  } catch (e) {
    console.error('⚠️ Échec chargement positions:', e.message);
  }
}

// SPOT uniquement : achat bas → vente haute (pas de short, pas de levier)
// Capital adapté à ~22 USDT au total
const BOTS = [
  { id:'gold', name:'Gold Sentinel', symbol:'XAUTUSDT', capital:7, rsi_buy:38, rsi_sell:65, tp:0.025, sl:0.02, active:true, interval:'15', qtyDec:5 },
  { id:'btc',  name:'Alpha RSI',     symbol:'BTCUSDT',  capital:7, rsi_buy:35, rsi_sell:68, tp:0.030, sl:0.02, active:true, interval:'15', qtyDec:6 },
  { id:'eth',  name:'Grid ETH',      symbol:'ETHUSDT',  capital:7, rsi_buy:40, rsi_sell:62, tp:0.025, sl:0.02, active:true, interval:'15', qtyDec:5 },
];

const positions = new Map();
const lastVerdicts = new Map(); // dernières décisions IA par bot
const aiState = { enabled: true }; // interrupteur validation Claude

// ── ÉTAT DE CONFIRMATION DE SIGNAL (anti-signal-prématuré) ──
const signalState = new Map(); // botId -> { rsiHistory: [], confirmCount: 0 }

function getSignalState(botId) {
  if (!signalState.has(botId)) {
    signalState.set(botId, { rsiHistory: [], confirmCount: 0 });
  }
  return signalState.get(botId);
}

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

async function getCoinBalance(coin) {
  const d = await api('GET', '/v5/account/wallet-balance', { accountType:'UNIFIED' });
  if (d.retCode !== 0) throw new Error(d.retMsg);
  const c = d.result.list[0]?.coin?.find(x => x.coin === coin);
  return +(c?.walletBalance || 0);
}

// ── VALIDATION IA CLAUDE (appelée uniquement sur signal d'achat confirmé) ──
const CLAUDE_TIMEOUT_MS = 8000; // sécurité: ne jamais bloquer un cycle plus de 8s sur l'IA

async function askClaude(bot, ctx) {
  if (!process.env.ANTHROPIC_API_KEY) return { decision: 'CONFIRM', reason: 'IA non configurée — règles seules' };
  const t0 = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CLAUDE_TIMEOUT_MS);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        system: `Tu es un validateur de trades pour un bot spot (Buy Low / Sell High, petit capital). Un signal d'ACHAT vient d'être détecté et confirmé par les règles RSI. Ton rôle : le CONFIRMER ou le REJETER selon le contexte technique. Sois conservateur : en cas de doute, REJETTE. Tu ne peux PAS modifier les montants ni la stratégie. Réponds UNIQUEMENT en JSON strict: {"decision":"CONFIRM"|"REJECT","confidence":0-100,"reason":"explication courte en français"}`,
        messages: [{ role: 'user', content: `Signal ACHAT détecté et confirmé:
- Marché: ${bot.symbol} (${bot.name})
- Prix actuel: $${ctx.price}
- RSI(14): ${ctx.rsi} (seuil achat: <${bot.rsi_buy}, en train de remonter depuis ${ctx.rsiPrev})
- EMA9: ${ctx.e9.toFixed(2)} | EMA21: ${ctx.e21.toFixed(2)} (tendance: ${ctx.e9 > ctx.e21 ? 'haussière' : 'baissière'})
- Variation 24h approximative: ${ctx.chg24h}%
- 5 dernières clôtures: ${ctx.lastCloses.join(', ')}
- Capital du trade: $${bot.capital} | TP: +${bot.tp*100}% | SL: -${bot.sl*100}%
Valide ou rejette cette entrée.` }]
      })
    });
    clearTimeout(timeoutId);
    const d = await res.json();
    const text = d.content?.[0]?.text || '';
    const json = JSON.parse(text.replace(/```json|```/g, '').trim());
    console.log(`🧠 Claude a répondu en ${Date.now() - t0}ms`);
    return { decision: json.decision === 'REJECT' ? 'REJECT' : 'CONFIRM', confidence: json.confidence, reason: json.reason };
  } catch(e) {
    clearTimeout(timeoutId);
    const elapsed = Date.now() - t0;
    // En cas d'erreur IA (y compris timeout) : on suit les règles (l'IA est un filtre optionnel, jamais bloquant)
    const msg = e.name === 'AbortError'
      ? `Timeout après ${elapsed}ms (>${CLAUDE_TIMEOUT_MS}ms)`
      : e.message.slice(0, 50);
    return { decision: 'CONFIRM', reason: `IA indisponible — règles RSI appliquées (${msg})` };
  }
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

  // ── Quantité vendable réelle: min(position enregistrée, solde réel du coin), arrondie VERS LE BAS ──
  // Corrige 2 causes de rejet Bybit: frais prélevés en coin à l'achat (solde réel < qty brute)
  // et trop de décimales (précision max = qtyDec)
  const coin = bot.symbol.replace('USDT', '');
  let avail = pos.qty;
  try { avail = await getCoinBalance(coin); }
  catch(e) { console.log(`⚠️ Lecture solde ${coin} impossible (${e.message.slice(0,40)}) — utilisation qty enregistrée`); }
  const factor = Math.pow(10, bot.qtyDec);
  const qtyToSell = Math.floor(Math.min(pos.qty, avail) * factor) / factor;

  if (qtyToSell <= 0) {
    console.error(`❌ ${bot.name}: quantité vendable nulle (enregistrée: ${pos.qty}, solde réel: ${avail})`);
    return;
  }

  console.log(`\n🔴 ${bot.name} | VENTE ${bot.symbol} @ $${price} | qty ${qtyToSell} (enregistrée: ${pos.qty}, solde: ${avail})`);
  const d = await api('POST', '/v5/order/create', {
    category:'spot', symbol:bot.symbol, side:'Sell', orderType:'Market',
    qty: qtyToSell.toFixed(bot.qtyDec), marketUnit:'baseCoin', timeInForce:'IOC',
  });
  if (d.retCode !== 0) { console.error('❌ Vente échouée:', d.retMsg); return; }
  const pnl = (price - pos.price) * qtyToSell;
  console.log(`💰 ${bot.name} vendu | PnL: ${pnl>=0?'+':''}$${pnl.toFixed(2)}`);
  positions.delete(bot.id);
  savePositions();
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

    // ── suivi de l'historique RSI pour détecter un rebond ──
    const state = getSignalState(bot.id);
    state.rsiHistory.push(r);
    if (state.rsiHistory.length > 5) state.rsiHistory.shift();
    const rsiPrev = state.rsiHistory.length >= 2
      ? state.rsiHistory[state.rsiHistory.length - 2]
      : r;
    const rsiRebondit = r > rsiPrev; // le RSI remonte = la survente s'essouffle

    console.log(`\n📊 ${bot.name} | $${price} | RSI:${r} (préc. ${rsiPrev}) | EMA9:${e9.toFixed(2)} | EMA21:${e21.toFixed(2)}`);

    if (pos) {
      const pct = (price - pos.price) / pos.price;
      console.log(`📈 Position achetée @ $${pos.price} | PnL: ${(pct*100).toFixed(2)}%`);
      if (pct >= bot.tp)  { console.log('🎯 Take Profit!'); await sellSpot(bot, price); state.confirmCount = 0; return; }
      if (pct <= -bot.sl) { console.log('🛑 Stop Loss!');   await sellSpot(bot, price); state.confirmCount = 0; return; }
      if (r > bot.rsi_sell) { console.log(`🔄 RSI haut (${r}) → vente`); await sellSpot(bot, price); state.confirmCount = 0; return; }
      return;
    }

    // ── Condition de base (inchangée) : RSI bas + tendance qui repart ──
    const conditionBase = r < bot.rsi_buy && e9 > e21;

    // ── Filtre anti-signal-prématuré : RSI doit remonter, confirmé 2 cycles de suite ──
    if (conditionBase && rsiRebondit) {
      state.confirmCount++;
    } else {
      state.confirmCount = 0;
    }
    console.log(`🔎 Filtre confirmation: base=${conditionBase} | rebond=${rsiRebondit} | confirmations=${state.confirmCount}/2`);

    if (state.confirmCount >= 2) {
      const tSignal = Date.now(); // ── début du chrono: signal confirmé, avant exécution ──
      const bal = await getBalance();
      if (bal < bot.capital) { console.log(`⚠️ Solde insuffisant: $${bal.toFixed(2)}`); return; }

      // ── VALIDATION PAR CLAUDE IA ──
      const first = candles[0].c;
      const chg24h = (((price - first) / first) * 100).toFixed(2);
      const lastCloses = candles.slice(-5).map(c => c.c);
      let verdict;
      if (aiState.enabled) {
        console.log(`🧠 Signal confirmé (2/2) — consultation de Claude IA...`);
        verdict = await askClaude(bot, { price, rsi: r, rsiPrev, e9, e21, chg24h, lastCloses });
      } else {
        console.log(`⏸ Validation IA en pause — règles RSI seules`);
        verdict = { decision: 'CONFIRM', reason: 'Validation IA en pause — signal RSI confirmé appliqué directement' };
      }
      console.log(`🧠 Claude: ${verdict.decision}${verdict.confidence ? ' (' + verdict.confidence + '%)' : ''} — ${verdict.reason}`);
      lastVerdicts.set(bot.id, { ...verdict, at: new Date().toISOString(), price, rsi: r });
      if (verdict.decision === 'REJECT') {
        console.log(`🛑 Entrée rejetée par l'IA — le bot attend un meilleur signal | temps total: ${Date.now() - tSignal}ms`);
        state.confirmCount = 0;
        return;
      }

      const o = await buySpot(bot, price);
      if (o) { positions.set(bot.id, { ...o, openedAt: new Date(), aiReason: verdict.reason }); savePositions(); }
      console.log(`⏱️ Temps total signal → exécution: ${Date.now() - tSignal}ms`);
      state.confirmCount = 0;
    } else {
      console.log(`⏳ Pas de signal confirmé (RSI=${r}, cible <${bot.rsi_buy})`);
    }
  } catch (e) {
    console.error(`❌ ${bot.name}:`, e.message);
  }
}

async function startTradingEngine() {
  console.log('\n🚀 NexTrade AI — Moteur SPOT Bybit démarré (Buy Low / Sell High)');
  loadPositions(); // ── restaure les positions ouvertes avant précédent redéploiement ──
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

module.exports = { startTradingEngine, BOTS, positions, api, getBalance, getPrice, lastVerdicts, aiState, signalState };
