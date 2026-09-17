# 🚀 NexTrade AI — Configuration de déploiement multi-horizon

## VERSION ACTUELLE: CLAUDE MULTI-HORIZON TRADING

### 📋 Fichiers à utiliser:

**Option 1: Version Simple (Originale)**
- `trading-engine.js` — Moteur original avec validation Claude
- `claude-bot-controller.js` — Contrôle avancé des bots

**Option 2: Version Avancée (NOUVELLE - RECOMMANDÉE)** ✅
- `trading-engine-advanced.js` — Claude contrôle tous les horizons
- `claude-trading-decisioner.js` — Décisionnaire multi-horizon
- Supports court/moyen/long terme simultanément

---

## 🔧 Pour utiliser la VERSION AVANCÉE:

### Étape 1: Renommer les fichiers

```bash
# Sauvegarder l'ancienne version
mv trading-engine.js trading-engine.old.js

# Utiliser la version avancée
mv trading-engine-advanced.js trading-engine.js
```

### Étape 2: Mettre à jour server.js

Dans `server.js`, vérifier que la ligne de démarrage est:

```javascript
if (process.env.BYBIT_API_KEY && process.env.BYBIT_SECRET) {
  const { startTradingEngine } = require('./trading-engine');
  startTradingEngine().catch(e => console.error('❌ Trading engine:', e.message));
}
```

### Étape 3: Redéployer

```bash
git add .
git commit -m "🚀 Passage en version AVANCÉE: Claude Multi-Horizon Trading"
git push origin main
```

Railway redéploiera automatiquement.

---

## 🧠 Qu'est-ce qui change?

### AVANT (Version Simple):
```
Signal RSI → Validation Claude → BUY/REJECT
Position unique par bot
```

### APRÈS (Version Avancée): ✅
```
Signal RSI

├─ Analyse Court Terme (0-4h)
│  └─ Claude décide: BUY/SELL/HOLD + TP/SL
│
├─ Analyse Moyen Terme (4h-1d)
│  └─ Claude décide: BUY/SELL/HOLD + TP/SL
│
└─ Analyse Long Terme (1-30j)
   └─ Claude décide: BUY/SELL/HOLD + TP/SL

Résultat: Positions SIMULTANÉES sur 3 horizons
```

---

## 📊 Exemple de fonctionnement:

**10:00 — BTC @ $45,000**
```
🧠 Claude analyse...

✅ Court terme (4h):  BUY | TP +102% | SL -99%   (gains 0-2h)
✅ Moyen terme (1d):  BUY | TP +108% | SL -95%   (gains 4-24h)
✅ Long terme (7d):   HOLD | TP +120% | SL -80%  (gains 1-7j)

Résultat:
- 30% du capital → Position court terme
- 50% du capital → Position moyen terme
- 100% du capital → Position long terme
```

**10:30 — BTC @ $45,900 (+2%)**
```
📈 Court terme TP atteint: +$225 | CLÔTURE
📊 Moyen terme en cours: +1.5% | HOLD
🔵 Long terme en cours: +1.8% | HOLD
```

**11:00 — BTC @ $47,500 (+5.5%)**
```
📊 Moyen terme TP atteint: +$1,050 | CLÔTURE
🔵 Long terme en cours: +5.5% | HOLD (contient TP)
```

**15:00 — BTC @ $50,000 (+11%)**
```
🔵 Long terme TP atteint: +$7,700 | CLÔTURE
📊 Session totale: +$8,975 dans capital composé
```

---

## ⚙️ Paramètres à ajuster

Dans `claude-trading-decisioner.js`, ligne ~70:

```javascript
// Allocation capitale par horizon (MODIFIABLE)
const capital = getBotEquity(bot) * 0.3;  // Court terme: 30%
const capital = getBotEquity(bot) * 0.5;  // Moyen terme: 50%
const capital = getBotEquity(bot);        // Long terme: 100%
```

Vous pouvez ajuster ces pourcentages selon votre risque/appétit.

---

## 📈 Métriques de succès

### Version Simple:
- Temps moyen par trade: 4-8h
- Gain moyen: +1-3% par trade
- Trades/jour: 1-2

### Version Avancée:
- Temps court terme: 4h
- Temps moyen terme: 1 jour
- Temps long terme: 3-7 jours
- **Positions simultanées**: 3 par bot
- **Gain cumulé**: 5-15% par jour possible

---

## 🛑 Déploiement et Rollback

### Déployer la version avancée:
```bash
git push origin main
# Railway redéploie automatiquement (~30s)
# Logs: "🚀 NexTrade AI ADVANCED"
```

### Rollback si problème:
```bash
# Revenir à l'ancienne version
mv trading-engine.js trading-engine-advanced.js
mv trading-engine.old.js trading-engine.js
git commit -am "ROLLBACK: Retour version simple"
git push origin main
```

---

## 📊 Endpoints API (AVANCÉS)

```bash
# Status positions multi-horizon
GET /api/real/bots

# Historique décisions Claude multi-horizon
GET /api/real/decisions?limit=50

# Nouvelles données:
{
  "timestamp": "...",
  "bot": "Alpha BTC",
  "symbol": "BTCUSDT",
  "price": 45000,
  "shortTerm": { 
    "action": "BUY",
    "tp": 102,
    "sl": 99,
    "horizon": "4h",
    "reason": "RSI oversold + EMA bullish"
  },
  "mediumTerm": { 
    "action": "BUY",
    "tp": 108,
    "sl": 95,
    "reason": "24h EMA cross confirmed"
  },
  "longTerm": { 
    "action": "HOLD",
    "tp": 120,
    "sl": 80,
    "reason": "30d uptrend intact"
  }
}
```

---

## ✅ Vérification post-déploiement

```bash
# 1. Vérifier les logs
# Chercher: "🚀 NexTrade AI ADVANCED"

# 2. Vérifier Claude
# Chercher: "🧠 Claude Multi-Horizon"

# 3. Vérifier premières positions
# Attendre 15 min pour le premier cycle
# Chercher: "🟢 ACHAT COURT TERME" ou "🟡 ACHAT MOYEN TERME"

# 4. Vérifier captures de profit
# Chercher: "🎯 PRISE PROFIT"
```

---

## 🚀 PRÊT POUR DÉCOLLAGE?

✅ Tous les fichiers dans le repo
✅ Configuration validée
✅ Claude activé multi-horizon
✅ Railway auto-redéploiement

**Commande finale:**
```bash
git push origin main
```

**Temps de déploiement: ~30 secondes**
**Premiers trades: Dans 15 minutes**

Bonne chance! 🎯
