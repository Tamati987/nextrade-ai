// ═══════════════════════════════════════════════════════════════════════════
//   CLAUDE TRADING AI — Décisions autonomes d'achat/vente
//   Court terme (swing 15min) + Long terme (positions multi-jour)
// ═══════════════════════════════════════════════════════════════════════════

const fetch = require('node-fetch');
const fs = require('fs');

const CLAUDE_TIMEOUT_MS = 15000;
const TRADES_LOG_FILE = process.env.RAILWAY_VOLUME_MOUNT_PATH 
  ? `${process.env.RAILWAY_VOLUME_MOUNT_PATH}/claude-trades.json`
  : './claude-trades.json';

let claudeTradesLog = [];

function saveTradesLog() {
  try {
    fs.writeFileSync(TRADES_LOG_FILE, JSON.stringify(claudeTradesLog, null, 2));
  } catch (e) {
    console.error('⚠️ Échec sauvegarde trades Claude:', e.message);
  }
}

function loadTradesLog() {
  try {
    if (fs.existsSync(TRADES_LOG_FILE)) {
      claudeTradesLog = JSON.parse(fs.readFileSync(TRADES_LOG_FILE, 'utf8'));
      console.log(`📂 ${claudeTradesLog.length} trades Claude restaurés`);
    }
  } catch (e) {
    console.error('⚠️ Échec chargement trades Claude:', e.message);
    claudeTradesLog = [];
  }
}

// Analyse stratégie court terme (swing trading 15-60 min)
async function analyzeShortTermStrategy(bot, ctx) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  
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
        max_tokens: 400,
        system: `Tu es un trader swing autonome (court terme, 15-60 min). Analyse les données et décide:
        - BUY: Survendu confirmé + momentum haussier
        - SELL: Suracheté + momentum baissier  
        - HOLD: Attendre signal plus clair
        
Réponds en JSON strict: {"action":"BUY"|"SELL"|"HOLD","confidence":0-100,"reason":"court","timeframe":"15-60min","riskLevel":"low"|"medium"|"high"}`,
        messages: [{
          role: 'user',
          content: `Décision SWING TRADING (court terme) pour ${bot.name}:

Prix: $${ctx.price}
RSI(14): ${ctx.rsi} (buy: <${bot.rsi_buy}, sell: >${bot.rsi_sell})
RSI préc: ${ctx.rsiPrev} (rebond: ${ctx.rsi > ctx.rsiPrev ? 'OUI ↑' : 'NON ↓'})
EMA9: ${ctx.e9.toFixed(2)} | EMA21: ${ctx.e21.toFixed(2)}
EMA9 rising: ${ctx.e9Rising ? 'OUI ↑' : 'NON ↓'}
Variation 24h: ${ctx.chg24h}%
5 derniers close: ${ctx.lastCloses.join(', ')}

Dernier profit/loss: ${ctx.lastPnL ? ctx.lastPnL.toFixed(2) + '%' : 'N/A'}
Série wins: ${ctx.winStreak || 0} | Série losses: ${ctx.lossStreak || 0}

Décide: BUY / SELL / HOLD pour les 15-60 prochaines minutes.`
        }],
      }),
    });

    clearTimeout(timeoutId);
    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    const json = JSON.parse(text.replace(/```json|```/g, '').trim());
    
    console.log(`⚡ Claude SWING (${Date.now() - t0}ms): ${json.action} | ${json.reason}`);
    return json;
  } catch (e) {
    clearTimeout(timeoutId);
    console.error(`❌ Erreur SWING:`, e.message?.slice(0, 50));
    return null;
  }
}

// Analyse stratégie long terme (position trading multi-jour)
async function analyzeLongTermStrategy(bot, ctx) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  
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
        max_tokens: 400,
        system: `Tu es un trader long terme autonome (positions 1-7 jours). Analyse les données et décide:
        - BUY_HOLD: Accumuler et tenir
        - SELL_TAKE_PROFIT: Prendre les gains
        - SELL_CUT_LOSS: Couper les pertes
        - WAIT: Pas encore temps
        
Réponds en JSON strict: {"action":"BUY_HOLD"|"SELL_TAKE_PROFIT"|"SELL_CUT_LOSS"|"WAIT","confidence":0-100,"reason":"long","timeframe":"1-7j","targetPrice":0,"holdDays":0}`,
        messages: [{
          role: 'user',
          content: `Décision POSITION TRADING (long terme) pour ${bot.name}:

Prix actuel: $${ctx.price}
RSI(14): ${ctx.rsi}
EMA9/EMA21: ${ctx.e9.toFixed(2)} / ${ctx.e21.toFixed(2)}
Variation 24h: ${ctx.chg24h}%
Trend: ${ctx.e9 > ctx.e21 ? 'HAUSSIER ↑' : 'BAISSIER ↓'}

Performance récente:
- Derniers gains: ${ctx.recentPnL?.wins || 0} | pertes: ${ctx.recentPnL?.losses || 0}
- Win rate: ${ctx.winRate ? (ctx.winRate * 100).toFixed(0) + '%' : 'N/A'}

Position potentielle: 
- TP: +${bot.tp * 100}% = $${(ctx.price * (1 + bot.tp)).toFixed(2)}
- SL: -${bot.sl * 100}% = $${(ctx.price * (1 - bot.sl)).toFixed(2)}

Stratégie: Décide si ouvrir une POSITION LONGUE de 1-7 jours, ou si attendre.`
        }],
      }),
    });

    clearTimeout(timeoutId);
    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    const json = JSON.parse(text.replace(/```json|```/g, '').trim());
    
    console.log(`📈 Claude LONG TERM (${Date.now() - t0}ms): ${json.action} | ${json.reason}`);
    return json;
  } catch (e) {
    clearTimeout(timeoutId);
    console.error(`❌ Erreur LONG TERM:`, e.message?.slice(0, 50));
    return null;
  }
}

// Décision COMBINÉE court + long terme
async function getClaudeTradeDecision(bot, ctx) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠️ ANTHROPIC_API_KEY non défini');
    return { action: 'HOLD', reason: 'IA non configurée' };
  }

  // Paralléliser les deux analyses
  const [shortTerm, longTerm] = await Promise.all([
    analyzeShortTermStrategy(bot, ctx),
    analyzeLongTermStrategy(bot, ctx),
  ]);

  if (!shortTerm || !longTerm) {
    return { action: 'HOLD', reason: 'Analyse IA partiellement disponible' };
  }

  // Logique de fusion: Long terme = priorité, court terme = ajustement
  let finalAction = 'HOLD';
  let confidence = 0;
  let reasoning = '';

  // Si long terme dit BUY_HOLD et court terme dit BUY/HOLD → GO BUY
  if (longTerm.action === 'BUY_HOLD' && (shortTerm.action === 'BUY' || shortTerm.action === 'HOLD')) {
    finalAction = 'BUY';
    confidence = (longTerm.confidence + shortTerm.confidence) / 2;
    reasoning = `LT(${longTerm.reason}) + ST(${shortTerm.reason})`;
  }
  // Si long terme dit SELL et court terme confirme → GO SELL
  else if (longTerm.action.includes('SELL') && (shortTerm.action === 'SELL' || shortTerm.action === 'HOLD')) {
    finalAction = 'SELL';
    confidence = (longTerm.confidence + shortTerm.confidence) / 2;
    reasoning = `LT(${longTerm.reason}) → SELL | ST accord`;
  }
  // Si long terme SELL_TAKE_PROFIT + court terme confirme → TP
  else if (longTerm.action === 'SELL_TAKE_PROFIT' && shortTerm.action === 'SELL') {
    finalAction = 'SELL_TP';
    confidence = Math.max(longTerm.confidence, shortTerm.confidence);
    reasoning = 'LT TP + ST confirmation';
  }
  // Si long terme SELL_CUT_LOSS → urgence
  else if (longTerm.action === 'SELL_CUT_LOSS') {
    finalAction = 'SELL_SL';
    confidence = longTerm.confidence;
    reasoning = 'LT SL URGENCE';
  }

  const trade = {
    timestamp: new Date().toISOString(),
    botId: bot.id,
    botName: bot.name,
    symbol: bot.symbol,
    action: finalAction,
    confidence: confidence,
    reasoning,
    strategies: {
      shortTerm: { action: shortTerm.action, confidence: shortTerm.confidence },
      longTerm: { action: longTerm.action, confidence: longTerm.confidence },
    },
    context: {
      price: ctx.price,
      rsi: ctx.rsi,
      e9: ctx.e9,
      e21: ctx.e21,
    },
  };

  claudeTradesLog.push(trade);
  if (claudeTradesLog.length > 200) claudeTradesLog = claudeTradesLog.slice(-200);
  saveTradesLog();

  console.log(`\n🎯 DÉCISION CLAUDE: ${finalAction} (confiance: ${confidence.toFixed(0)}%)`);
  console.log(`   Reasoning: ${reasoning}`);

  return { action: finalAction, confidence, reason: reasoning };
}

module.exports = {
  getClaudeTradeDecision,
  analyzeShortTermStrategy,
  analyzeLongTermStrategy,
  loadTradesLog,
  claudeTradesLog: () => claudeTradesLog,
};
