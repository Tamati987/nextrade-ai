// ═══════════════════════════════════════════════════════════════════════════
//   CLAUDE BOT CONTROLLER — Contrôle avancé des bots par Claude AI
//   Conversion du rôle de Claude: Validateur → Contrôleur actif
// ═══════════════════════════════════════════════════════════════════════════

const fetch = require('node-fetch');
const fs = require('fs');

const CLAUDE_TIMEOUT_MS = 12000;
const CONTROL_LOG_FILE = process.env.RAILWAY_VOLUME_MOUNT_PATH 
  ? `${process.env.RAILWAY_VOLUME_MOUNT_PATH}/claude-commands.json` 
  : './claude-commands.json';

let claudeCommandHistory = [];

function saveCommandHistory() {
  try {
    fs.writeFileSync(CONTROL_LOG_FILE, JSON.stringify(claudeCommandHistory, null, 2));
  } catch (e) {
    console.error('⚠️ Échec sauvegarde commandes Claude:', e.message);
  }
}

function loadCommandHistory() {
  try {
    if (fs.existsSync(CONTROL_LOG_FILE)) {
      claudeCommandHistory = JSON.parse(fs.readFileSync(CONTROL_LOG_FILE, 'utf8'));
      console.log(`📂 ${claudeCommandHistory.length} commandes Claude restaurées`);
    }
  } catch (e) {
    console.error('⚠️ Échec chargement commandes Claude:', e.message);
    claudeCommandHistory = [];
  }
}

// Formate un résumé du status global pour Claude
function buildSystemStatus(bots, positions, decisions, botEquity) {
  const activeCount = bots.filter(b => b.active).length;
  const positionCount = positions.size;
  const recentDecisions = decisions().slice(-10);
  
  const status = {
    timestamp: new Date().toISOString(),
    botsActive: activeCount,
    totalBots: bots.length,
    openPositions: positionCount,
    positions: Array.from(positions.entries()).map(([botId, pos]) => ({
      botId,
      symbol: bots.find(b => b.id === botId)?.symbol,
      price: pos.price,
      qty: pos.qty,
      openedAt: pos.openedAt,
      profitLossPercent: ((pos.currentPrice || pos.price - 0.1) - pos.price) / pos.price * 100,
    })),
    recentDecisions: recentDecisions.map(d => ({
      botId: d.botId,
      decision: d.decision,
      confidence: d.confidence,
      pnl: d.outcome?.pnl,
      at: d.at,
    })),
    equity: Object.fromEntries(
      bots.map(b => [b.id, { current: botEquity.get(b.id) || b.capital, initial: b.capital }])
    ),
  };
  return status;
}

// Envoie l'état actuel à Claude pour qu'il CONTRÔLE les bots
async function askClaudeForControl(bots, positions, decisions, botEquity, marketData = {}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠️ ANTHROPIC_API_KEY non défini — contrôle Claude désactivé');
    return { action: 'NONE', reason: 'IA non configurée' };
  }

  const systemStatus = buildSystemStatus(bots, positions, decisions, botEquity);
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
        max_tokens: 500,
        system: `Tu es un contrôleur de bots de trading. Tu reçois l'état actuel du système et dois décider d'ACTIONS à prendre:
        
ACTIONS disponibles:
- BUY_BOT: Force un bot à acheter (si conditions RSI pas confirmées, utilise priorité haute)
- SELL_BOT: Force la vente d'une position ouverte
- CLOSE_ALL: Ferme TOUTES les positions (urgence/marché dangereux)
- PAUSE_BOT: Mets en pause un bot (arrête temporairement)
- RESUME_BOT: Réactive un bot en pause
- ADJUST_TP: Modifie le Take Profit d'un bot (format: BOT_ID:NEW_PERCENTAGE)
- ADJUST_SL: Modifie le Stop Loss (format: BOT_ID:NEW_PERCENTAGE)
- REPORT: Génère un rapport de performance
- NONE: Aucune action, continuer normalement

Critères de décision:
1. Volatilité extrême = CLOSE_ALL
2. Pattern perdu 3 trades consécutifs = PAUSE_BOT
3. Gagnant confirmé sur 2+ trades = ADJUST_TP (augmente pour laisser courir les gagnants)
4. Marché calme + signal RSI confirmé = BUY_BOT
5. Rendement >5% sur la session = REPORT

Réponds STRICTEMENT en JSON: {"action":"ACTION_NAME","target":"botId_ou_ALL","parameters":{...},"reason":"explication"}`,
        messages: [{
          role: 'user',
          content: `État actuel du système de trading:
${JSON.stringify(systemStatus, null, 2)}

Données de marché supplémentaires (si disponibles):
${JSON.stringify(marketData, null, 2)}

Quelles actions dois-je exécuter maintenant?`,
        }],
      }),
    });

    clearTimeout(timeoutId);
    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    const json = JSON.parse(text.replace(/```json|```/g, '').trim());

    const command = {
      timestamp: new Date().toISOString(),
      elapsed: Date.now() - t0,
      action: json.action || 'NONE',
      target: json.target || null,
      parameters: json.parameters || {},
      reason: json.reason,
      status: 'executed',
    };

    claudeCommandHistory.push(command);
    if (claudeCommandHistory.length > 100) claudeCommandHistory = claudeCommandHistory.slice(-100);
    saveCommandHistory();

    console.log(`🧠 Claude Contrôleur: ${json.action} | ${json.reason} (${Date.now() - t0}ms)`);
    return json;
  } catch (e) {
    clearTimeout(timeoutId);
    const elapsed = Date.now() - t0;
    const msg = e.name === 'AbortError' ? `Timeout ${elapsed}ms` : e.message.slice(0, 50);
    
    const command = {
      timestamp: new Date().toISOString(),
      elapsed,
      action: 'NONE',
      reason: `Erreur IA: ${msg}`,
      status: 'error',
    };
    claudeCommandHistory.push(command);
    saveCommandHistory();

    console.error(`🧠 Claude Contrôleur — Erreur (${msg})`);
    return { action: 'NONE', reason: `IA indisponible (${msg})` };
  }
}

// Exécute une commande Claude
async function executeClaudeCommand(command, bots, tradingEngine) {
  const action = command.action?.toUpperCase();
  const target = command.target;

  console.log(`\n🎯 Exécution commande Claude: ${action}`);

  switch (action) {
    case 'BUY_BOT':
      if (target && target !== 'ALL') {
        const bot = bots.find(b => b.id === target);
        if (bot) {
          console.log(`💡 Claude demande achat forcé: ${bot.name}`);
          // À implémenter: force buy via tradingEngine
        }
      }
      break;

    case 'SELL_BOT':
      if (target && target !== 'ALL') {
        const bot = bots.find(b => b.id === target);
        if (bot) {
          console.log(`💡 Claude demande vente: ${bot.name}`);
          // À implémenter: force sell via tradingEngine
        }
      }
      break;

    case 'CLOSE_ALL':
      console.error(`🚨 ALERTE CLAUDE: Fermeture d'urgence de toutes les positions!`);
      console.log(`📋 Raison: ${command.reason}`);
      // À implémenter: fermer toutes les positions
      break;

    case 'PAUSE_BOT':
      if (target) {
        const bot = bots.find(b => b.id === target);
        if (bot) {
          bot.active = false;
          console.log(`⏸ ${bot.name} mise en pause par Claude`);
        }
      }
      break;

    case 'RESUME_BOT':
      if (target) {
        const bot = bots.find(b => b.id === target);
        if (bot) {
          bot.active = true;
          console.log(`▶️  ${bot.name} réactivée par Claude`);
        }
      }
      break;

    case 'ADJUST_TP':
      if (target && command.parameters?.newTp) {
        const bot = bots.find(b => b.id === target);
        if (bot) {
          const oldTp = bot.tp;
          bot.tp = command.parameters.newTp;
          console.log(`📊 ${bot.name} — TP ajusté: ${oldTp} → ${bot.tp} (Claude)`);
        }
      }
      break;

    case 'ADJUST_SL':
      if (target && command.parameters?.newSl) {
        const bot = bots.find(b => b.id === target);
        if (bot) {
          const oldSl = bot.sl;
          bot.sl = command.parameters.newSl;
          console.log(`📊 ${bot.name} — SL ajusté: ${oldSl} → ${bot.sl} (Claude)`);
        }
      }
      break;

    case 'REPORT':
      console.log(`📊 Rapport de performance demandé par Claude`);
      // Génère un rapport détaillé
      break;

    default:
      // NONE ou action inconnue
      break;
  }
}

module.exports = {
  askClaudeForControl,
  executeClaudeCommand,
  loadCommandHistory,
  claudeCommandHistory: () => claudeCommandHistory,
};
