// ═══════════════════════════════════════════════════════════════════════════
//   CLAUDE MULTI-HORIZON TRADING DECISIONER
//   Court terme (0-4h) | Moyen terme (4h-1d) | Long terme (1-30j)
//   Claude contrôle TOUS les horizons temporels
// ═══════════════════════════════════════════════════════════════════════════

const fetch = require('node-fetch');
const fs = require('fs');

const CLAUDE_TIMEOUT_MS = 15000;
const DECISIONS_LOG = process.env.RAILWAY_VOLUME_MOUNT_PATH 
  ? `${process.env.RAILWAY_VOLUME_MOUNT_PATH}/claude-decisions.json` 
  : './claude-decisions.json';

let decisionsHistory = [];

function saveDecisions() {
  try {
    fs.writeFileSync(DECISIONS_LOG, JSON.stringify(decisionsHistory, null, 2));
  } catch (e) {
    console.error('⚠️ Échec sauvegarde décisions Claude:', e.message);
  }
}

function loadDecisions() {
  try {
    if (fs.existsSync(DECISIONS_LOG)) {
      decisionsHistory = JSON.parse(fs.readFileSync(DECISIONS_LOG, 'utf8'));
      console.log(`📂 ${decisionsHistory.length} décisions Claude restaurées`);
    }
  } catch (e) {
    console.error('⚠️ Échec chargement décisions Claude:', e.message);
    decisionsHistory = [];
  }
}

// Analyse timeframe court terme (15min - 4h)
async function analyzeShortTerm(bot, marketData) {
  const { price, rsi, ema9, ema21, volatility, chg1h } = marketData;
  
  const analysis = {
    trend: ema9 > ema21 ? 'HAUT' : 'BAS',
    momentum: rsi < 30 ? 'SURVENTE' : rsi > 70 ? 'SURACHAT' : 'NEUTRE',
    volatility: volatility > 15 ? 'HAUTE' : 'NORMALE',
    priceAction: chg1h > 2 ? 'FORTE_HAUSSE' : chg1h < -2 ? 'FORTE_BAISSE' : 'STABLE',
    signal: null,
  };

  if (rsi < 35 && ema9 > ema21 && chg1h > -3) {
    analysis.signal = 'BUY_SHORT';  // Achat court terme (4-8h)
  } else if (rsi > 75 && chg1h > 2) {
    analysis.signal = 'SELL_SHORT'; // Vente court terme (take profit)
  }

  return analysis;
}

// Analyse timeframe moyen terme (4h - 1 jour)
async function analyzeMediumTerm(bot, marketData) {
  const { price, rsi, ema9, ema21, change24h, lastCloses } = marketData;
  
  // Calcul moyenne sur 24h
  const avg24h = lastCloses.slice(-96).reduce((a, b) => a + b, 0) / Math.min(96, lastCloses.length);
  const trend24h = price > avg24h ? 'HAUT' : 'BAS';
  
  const analysis = {
    trend24h,
    rsiTrend: rsi < 40 ? 'BAISSE' : rsi > 60 ? 'HAUSSE' : 'STABLE',
    change24h,
    emaCross: ema9 > ema21 ? 'BULLISH' : 'BEARISH',
    signal: null,
  };

  if (change24h > 3 && ema9 > ema21 && rsi > 50 && rsi < 75) {
    analysis.signal = 'BUY_MEDIUM';  // Achat swing (1-3 jours)
  } else if (change24h < -3 && ema9 < ema21) {
    analysis.signal = 'SELL_MEDIUM'; // Vente swing
  }

  return analysis;
}

// Analyse timeframe long terme (1j - 30j)
async function analyzeLongTerm(bot, marketData) {
  const { price, change7d, change30d, volatility, trend } = marketData;
  
  const analysis = {
    change7d,
    change30d,
    volatilityProfile: volatility > 20 ? 'VOLATILE' : volatility < 5 ? 'STABLE' : 'NORMAL',
    trend: trend === 'UP' ? 'MONTANT' : 'DESCENDANT',
    signal: null,
  };

  if (change7d > 5 && change30d > 10 && volatility < 25) {
    analysis.signal = 'BUY_LONG';    // Achat long terme (2-4 semaines)
  } else if (change7d < -5 || change30d < -15) {
    analysis.signal = 'HOLD_LONG';   // Garder + attendre baisse pour ajouter
  }

  return analysis;
}

// Claude décide sur chaque horizon
async function askClaudeForTradingDecisions(bot, marketData, recentHistory) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { shortTerm: null, mediumTerm: null, longTerm: null };
  }

  const shortAnalysis = await analyzeShortTerm(bot, marketData);
  const mediumAnalysis = await analyzeMediumTerm(bot, marketData);
  const longAnalysis = await analyzeLongTerm(bot, marketData);

  const t0 = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CLAUDE_TIMEOUT_MS);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        system: `Tu es un trader multi-horizon expert. Prends des décisions d'achat/vente sur 3 timeframes différentes.

TIMEFRAMES:
1. COURT TERME (0-4h): Scalping/Day Trading — gains 1-3%
2. MOYEN TERME (4h-1d): Swing Trading — gains 3-8%
3. LONG TERME (1-30j): Position Trading — gains 8-25%+

Tu peux avoir des positions OUVERTES sur chaque timeframe SIMULTANÉMENT.
Exemple: Achat court terme PENDANT qu'une position long terme est déjà ouverte.

Pour chaque timeframe, réponds STRICTEMENT en JSON:
{
  "shortTerm": { "action": "BUY|SELL|HOLD", "tp": 101|103|105..., "sl": 99|97|95..., "horizon": "4h", "reason": "..." },
  "mediumTerm": { "action": "BUY|SELL|HOLD", "tp": 105|110|115..., "sl": 95|90|85..., "horizon": "1d", "reason": "..." },
  "longTerm": { "action": "BUY|SELL|HOLD", "tp": 120|150|200..., "sl": 80|70|50..., "horizon": "7-30j", "reason": "..." }
}

Critères de décision:
- Court terme: RSI + EMA rapides, volatilité
- Moyen terme: EMA crossover, changement 24h, momentum
- Long terme: Trend 30j, support/résistance, volatilité profil

IMPORTANT: Chaque timeframe a son propre TP/SL. Ne pas les mélanger.`,
        messages: [{
          role: 'user',
          content: `Décisions de trading pour ${bot.symbol} @ $${marketData.price}:

COURT TERME (15min - 4h):
${JSON.stringify(shortAnalysis, null, 2)}

MOYEN TERME (4h - 1 jour):
${JSON.stringify(mediumAnalysis, null, 2)}

LONG TERME (1-30 jours):
${JSON.stringify(longAnalysis, null, 2)}

Historique récent:
${recentHistory}

Donne les décisions pour chaque timeframe.`,
        }],
      }),
    });

    clearTimeout(timeoutId);
    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    const json = JSON.parse(text.replace(/```json|```/g, '').trim());

    const decision = {
      timestamp: new Date().toISOString(),
      bot: bot.name,
      symbol: bot.symbol,
      price: marketData.price,
      elapsed: Date.now() - t0,
      shortTerm: json.shortTerm,
      mediumTerm: json.mediumTerm,
      longTerm: json.longTerm,
    };

    decisionsHistory.push(decision);
    if (decisionsHistory.length > 200) decisionsHistory = decisionsHistory.slice(-200);
    saveDecisions();

    console.log(`🧠 Claude Multi-Horizon [${bot.name}]:
      ├─ Court terme: ${json.shortTerm.action} (TP ${json.shortTerm.tp}%, SL ${json.shortTerm.sl}%)
      ├─ Moyen terme: ${json.mediumTerm.action} (TP ${json.mediumTerm.tp}%, SL ${json.mediumTerm.sl}%)
      └─ Long terme: ${json.longTerm.action} (TP ${json.longTerm.tp}%, SL ${json.longTerm.sl}%)`);

    return json;
  } catch (e) {
    clearTimeout(timeoutId);
    const elapsed = Date.now() - t0;
    const msg = e.name === 'AbortError' ? `Timeout ${elapsed}ms` : e.message.slice(0, 50);
    
    console.error(`🧠 Claude Multi-Horizon — Erreur (${msg})`);
    return { shortTerm: null, mediumTerm: null, longTerm: null };
  }
}

// Gère les positions multi-horizon
class MultiHorizonPositionManager {
  constructor() {
    this.positions = new Map(); // botId → { shortTerm: pos, mediumTerm: pos, longTerm: pos }
  }

  addPosition(botId, horizon, position) {
    if (!this.positions.has(botId)) {
      this.positions.set(botId, { shortTerm: null, mediumTerm: null, longTerm: null });
    }
    const botPositions = this.positions.get(botId);
    botPositions[horizon] = position;
  }

  getPosition(botId, horizon) {
    const botPositions = this.positions.get(botId);
    return botPositions ? botPositions[horizon] : null;
  }

  removePosition(botId, horizon) {
    if (this.positions.has(botId)) {
      const botPositions = this.positions.get(botId);
      botPositions[horizon] = null;
    }
  }

  getActivePositions(botId) {
    const botPositions = this.positions.get(botId);
    if (!botPositions) return [];
    return ['shortTerm', 'mediumTerm', 'longTerm'].filter(h => botPositions[h] !== null);
  }

  statusForBot(botId) {
    const active = this.getActivePositions(botId);
    return {
      activeCount: active.length,
      horizons: active,
      details: active.map(h => {
        const pos = this.getPosition(botId, h);
        return `${h}: +${((pos.currentPrice - pos.entryPrice) / pos.entryPrice * 100).toFixed(2)}%`;
      }),
    };
  }
}

module.exports = {
  askClaudeForTradingDecisions,
  analyzeShortTerm,
  analyzeMediumTerm,
  analyzeLongTerm,
  MultiHorizonPositionManager,
  loadDecisions,
  decisionsHistory: () => decisionsHistory,
};
