# 🤖 NexTrade AI — Trading Bot Automatisé avec Claude Control

Plateforme de trading spot automatisée sur Bybit, avec validation et contrôle avancé par Claude AI.

## ✨ Fonctionnalités principales

- **5 bots de trading spot** — Gold, Bitcoin, Ethereum, Solana, XRP
- **Stratégie RSI + EMA** — Détection de survendus/surachetés
- **Stop Loss & Take Profit** — Gestion des risques automatisée
- **Claude AI Validation** — Validation intelligente de chaque signal d'achat
- **🧠 Claude Control** — Contrôle avancé et autonome des bots
- **Capital composé** — Les gains réinvestis se capitalisent automatiquement
- **Persistance** — Positions et historique des décisions survie aux redéploiements via Volume Railway

## 🚀 Déploiement Railway

### Variables d'environnement requises

```bash
BYBIT_API_KEY=xxxxxxxx              # Clé API Bybit
BYBIT_SECRET=xxxxxxxx               # Secret Bybit
ANTHROPIC_API_KEY=sk-ant-...        # Clé API Claude (pour validation + contrôle)
ADMIN_PASSWORD=votre-mdp            # Protège les endpoints critiques
JWT_SECRET=jwt-secret-2026          # Pour la signature des tokens
SESSION_SECRET=session-secret        # Pour les sessions Express
```

### Déploiement

```bash
# 1. Railway Dashboard → New Project → GitHub Repo
# 2. Connecter le repo: Tamati987/nextrade-ai
# 3. Ajouter Volume Railway (5GB) → monter à /data
# 4. Ajouter variables d'env (voir ci-dessus)
# 5. Deploy!
```

Les positions et l'historique des décisions persisteront automatiquement dans `/data`.

## 📊 Architecture

```
┌─ Trading Engine (trading-engine.js)
│  ├─ Fetch candles Bybit (15min)
│  ├─ Calcul RSI(14) + EMA9/EMA21
│  ├─ Détection signaux d'achat/vente
│  ├─ Validation Claude AI (avant achat)
│  └─ Exécution ordres Bybit
│
├─ Claude Bot Controller (claude-bot-controller.js) ← NOUVEAU
│  ├─ Monitoring continu du système
│  ├─ Décisions autonomes toutes les 15 min
│  ├─ Actions: PAUSE, RESUME, CLOSE_ALL, ADJUST_TP/SL
│  └─ Historique persistant des commandes
│
└─ Server (server.js)
   ├─ REST API pour accéder aux bots
   ├─ Dashboard HTML/JS
   └─ Endpoints Claude Control
```

## 🧠 Claude Control — Contrôle Avancé

Claude n'est plus juste un validateur — il est maintenant un **contrôleur actif** du système.

### Actions disponibles

| Action | Description | Exemple |
|--------|-------------|---------|
| **PAUSE_BOT** | Met en pause un bot | 3 pertes → mise en pause auto |
| **RESUME_BOT** | Réactive un bot en pause | Après analyse, relance |
| **BUY_BOT** | Force un achat | Opportunité détectée |
| **SELL_BOT** | Force une vente | Volatilité anormale |
| **CLOSE_ALL** | Ferme ALL positions | 🚨 Urgence / Crash détecté |
| **ADJUST_TP** | Modifie Take Profit | Série gagnante → TP +2% |
| **ADJUST_SL** | Modifie Stop Loss | Volatilité ↑ → SL tighter |
| **REPORT** | Rapport de performance | Analyse + recommandations |

### Logique de décision

Claude utilise ces critères pour décider automatiquement :

1. **Volatilité extrême** (RSI >90 ou <10 partout) → `CLOSE_ALL`
2. **3 pertes consécutives** → `PAUSE_BOT` (30 min)
3. **Série 2+ gagnants** → `ADJUST_TP` (laisser courir)
4. **Marché calme + signal RSI confirmé** → `BUY_BOT`
5. **Rendement >5%** → `REPORT` (analyser + célébrer)

### Cycle de contrôle Claude

- Exécuté **toutes les 15 minutes** (même cadence que les trades)
- Analyse l'état global : bots, positions, historique
- Prend des décisions basées sur les 5 critères ci-dessus
- Chaque commande est enregistrée avec raison + résultat

## 📡 API REST

### Authentification

Les endpoints critiques requièrent une connexion admin :

```bash
curl -X POST http://localhost:3000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"password":"votre-mdp"}'

# Récupère un token JWT valide 30 jours
# Utilise le token : -H "Authorization: Bearer <token>"
```

### Endpoints Claude Control

#### Historique des commandes Claude

```bash
GET /api/claude/commands/history?limit=20
Authorization: Bearer <token>

Response:
{
  "ok": true,
  "commands": [
    {
      "timestamp": "2026-09-16T10:30:00Z",
      "action": "PAUSE_BOT",
      "target": "gold",
      "reason": "3 pertes consécutives",
      "status": "executed"
    }
  ],
  "total": 45
}
```

#### Exécuter une commande Claude manuelle

```bash
POST /api/claude/command
Authorization: Bearer <token>
Content-Type: application/json

{
  "action": "PAUSE_BOT",
  "target": "gold",
  "parameters": {}
}

Response:
{
  "ok": true,
  "command": {
    "timestamp": "2026-09-16T10:35:00Z",
    "action": "PAUSE_BOT",
    "target": "gold",
    "reason": "Commande manuelle via API",
    "status": "pending"
  }
}
```

#### Status du système Claude Control

```bash
GET /api/claude/status
Authorization: Bearer <token>

Response:
{
  "ok": true,
  "status": {
    "botsActive": 3,
    "totalBots": 5,
    "openPositions": 2,
    "lastCommand": {
      "timestamp": "2026-09-16T10:30:00Z",
      "action": "PAUSE_BOT",
      "reason": "..."
    },
    "apiKey": true,
    "claudeEnabled": true
  }
}
```

### Autres endpoints

```bash
# Status bots + positions
GET /api/real/bots

# Balance Bybit
GET /api/real/balance

# Historique des décisions IA
GET /api/real/decisions?limit=10

# Activer/désactiver validation Claude
POST /api/real/ai/toggle
{ "enabled": true }

# Activer/désactiver un bot
POST /api/real/bots/:id/toggle

# Historique ordres Bybit
GET /api/real/orders
```

## 📋 Exemple : Scénario autonome

### Heure 10:00 — Démarrage
```
🚀 NexTrade AI démarrée
🧠 Claude Control — ACTIVÉ
💰 Solde: $22.15 USDT
```

### Heure 10:15 — Premier cycle de trading
```
📊 Gold Sentinel: RSI=32, signal confirmé
🧠 Claude valide: CONFIRM (confiance 92%)
🟢 Achat: 0.005 BTC @ $45,000 = $225
```

### Heure 10:15 — Cycle de contrôle Claude
```
🧠 Analyse de l'état global...
✅ 1 position ouverte (+1.2%)
✅ Rendement session: +0.5%
➡️  Action: NONE (tout nominal)
```

### Heure 10:30 — Trade gagnant + deuxième cycle
```
🎯 Gold atteint TP (+5%)
💰 Position vendue | PnL: +$11.25
📊 Capital composé: $233.40 (était $222.15)

🧠 Cycle Claude:
✅ Série 1 gagnant observée
➡️  Action: NONE (attendre 1+ gagnant supplémentaire)
```

### Heure 10:45 — Deuxième gagnant
```
🎯 ETH atteint TP (+5%)
💰 Position vendue | PnL: +$10.50

🧠 Cycle Claude:
✅ Série 2 gagnants confirmée
➡️  Action: ADJUST_TP (5% → 7% sur tous les bots)
📋 Raison: Momentum positif, laisser courir les gagnants
```

### Heure 11:15 — Volatilité extrême
```
📊 RSI sur BTC: 92 (EXTRÊME)
📊 RSI sur ETH: 88 (EXTRÊME)

🧠 Cycle Claude:
🚨 Volatilité extrême détectée
➡️  Action: CLOSE_ALL
📋 Raison: Protection du capital
```

## 🔐 Sécurité

- ✅ **Validation IA obligatoire** — Chaque signal d'achat approuvé par Claude avant exécution
- ✅ **Timeouts** — Claude doit répondre <12s, sinon fallback aux règles RSI
- ✅ **Circuit breaker** — Pause auto si perte >30% du capital initial
- ✅ **Audit complet** — Historique persistant de chaque décision (timestamp, contexte, raison)
- ✅ **Admin auth** — Endpoints critiques protégés par JWT + mot de passe
- ✅ **Capital limité** — ~$22 au total, réparti en 5 petits bots

## 🛠️ Développement local

```bash
# Cloner
git clone https://github.com/Tamati987/nextrade-ai.git
cd nextrade-ai

# Installer dépendances
npm install

# Variables d'env locales (.env)
BYBIT_API_KEY=xxx
BYBIT_SECRET=xxx
ANTHROPIC_API_KEY=sk-ant-xxx
# ... autres

# Lancer localement (simul + test)
npm start
```

Pas de vraies ordres sans `BYBIT_API_KEY` + mode simulation marché disponible via l'UI.

## 📊 Monitoring

### Logs principaux

```bash
# Cycle de trading (toutes les 15 min)
⏰ Cycle trading: ...
📊 Gold Sentinel | $45,200 | RSI:32 | ...
🟢 ACHAT ...
💰 Vendé | PnL: ...

# Cycle de contrôle Claude (toutes les 15 min)
🧠 Cycle contrôle Claude: ...
🧠 Claude Contrôleur: PAUSE_BOT | 3 pertes consécutives
```

### Dashboard

- Accès à `http://localhost:3000` (ou `https://votre-domaine-railway.app`)
- Voir les bots, positions, historique des décisions
- Endpoints Claude Control disponibles via l'API

## 🚨 Troubleshooting

### Claude ne répond pas

```bash
# Vérifier la clé API
curl -H "x-api-key: sk-ant-..." https://api.anthropic.com/v1/models

# Si timeout: fallback sur les règles RSI seules
# Logs: "Claude indisponible — règles RSI appliquées"
```

### Bybit blocage géographique

```bash
# Railway Settings → Region
# Changer vers EU West (Europe eu-west-1)
```

### Positions fantômes

```bash
# Si `position.json` est corrompue:
# 1. Vérifier solde réel sur Bybit
# 2. Recréer `position.json` vide: {}
# 3. Le bot se re-synchronisera au prochain cycle
```

## 📝 Notes

- Capital initial: ~$22 USDT (très petit, pour dev/test)
- Rendement cible: +5-10% / mois (hypothétique, passé non garant)
- Fees Bybit: ~0.2% (achat + vente)
- Timeframe: 15 min (bougies 15 min)
- Volume Railway: 5GB (persiste bots + historique)

## 🔮 Roadmap

- [ ] Multi-exchange (OKX, Kraken)
- [ ] Leverage trading (2-5x)
- [ ] ML prédiction RSI
- [ ] Notification Telegram
- [ ] Dashboard avancé (graphiques, heatmaps)

---

**Créé par:** Tamati987  
**Déploiement:** Railway  
**IA:** Claude Sonnet 4.6 (validation + contrôle)  
**Dernière mise à jour:** Sept 2026
