# 🚀 DÉPLOIEMENT IMMÉDIAT — Claude Multi-Horizon Trading

## ✅ Status: PRÊT À DÉPLOYER

Tous les fichiers ont été créés et committé localement. Maintenant il suffit de **pousser vers GitHub**, et Railway redéploiera automatiquement.

---

## 📝 FICHIERS NOUVEAUX/MODIFIÉS

```
✅ claude-trading-decisioner.js    [NOUVEAU] — Décisionnaire multi-horizon
✅ trading-engine-advanced.js       [NOUVEAU] — Moteur avancé Claude
✅ deploy.sh                        [NOUVEAU] — Script déploiement auto
✅ DEPLOYMENT_CONFIG.md             [NOUVEAU] — Documentation config
✅ railway.json                     [MODIFIÉ] — Exécute deploy.sh avant start
```

### Commits prêts:
```
768345b 🚀 Claude Multi-Horizon Trading
0010a82 ⚙️ Script de déploiement automatique Railway
```

---

## 🔐 AUTHENTIFICATION GITHUB

### Option 1: GitHub CLI (Recommandée)

```bash
# 1. Installer GitHub CLI
# https://cli.github.com/

# 2. Authentifier
gh auth login
# → Choisir: GitHub.com
# → Choisir: SSH ou HTTPS
# → Suivre les prompts

# 3. Vérifier
gh auth status
# Doit afficher: "✓ Authenticated"

# 4. POUSSER!
cd /tmp/nextrade-ai
git push origin main

# Railway détecte le push automatiquement
# Redéploiement commence dans ~10s
```

### Option 2: Token Personal GitHub

```bash
# 1. Créer un token: https://github.com/settings/tokens
#    - Permissions minimales: repo (full control)
#    - Expiration: 30 jours ou plus

# 2. Configurer Git avec le token
git remote set-url origin https://<TOKEN>@github.com/Tamati987/nextrade-ai.git

# 3. POUSSER!
git push origin main
```

### Option 3: SSH Keys

```bash
# 1. Si vous avez déjà des clés SSH:
git remote set-url origin git@github.com:Tamati987/nextrade-ai.git

# 2. Sinon, générer:
ssh-keygen -t ed25519 -C "tamati987@nextrade"
# Ajouter la clé à GitHub: https://github.com/settings/keys

# 3. POUSSER!
git push origin main
```

---

## 🎯 APRÈS LE PUSH

### Ce qui se passe automatiquement:

```
⏱️  T+0s:   GitHub reçoit le push
⏱️  T+5s:   Railway détecte le changement
⏱️  T+10s:  Build commence
              - npm install
              - bash deploy.sh (setup automatique)
⏱️  T+20s:  Server démarre
              - Logs: "🚀 NexTrade AI ADVANCED"
              - Logs: "🧠 Claude Multi-Horizon"
⏱️  T+30s:  Système LIVE et OPÉRATIONNEL
```

### Vérifier le déploiement:

**Option A: Railway Dashboard**
1. Allez sur https://railway.app/dashboard
2. Cliquez sur le projet "diligent-courage"
3. Service "nextrade-ai" → Onglet "Logs"
4. Cherchez: `🚀 NexTrade AI ADVANCED`

**Option B: Curl depuis terminal**
```bash
# Vérifier que le serveur répond
curl https://votre-domaine-railway.app/api/real/bots

# Doit retourner JSON avec les bots
```

---

## 🧠 PREMIÈRE EXÉCUTION

Après le déploiement:

### 1. Premier cycle (attendre 15 min)

```
⏰ 10:00 — Démarrage
🚀 NexTrade AI ADVANCED — Moteur Multi-Horizon
🧠 Claude Multi-Horizon — ACTIVÉ

💰 Solde Bybit: $22.15 USDT
✅ ANTHROPIC_API_KEY configurée
✅ BYBIT_API_KEY configurée
```

### 2. Analyse des bots (attendre 1 min par bot)

```
📊 Gold Sentinel | $2,450 | RSI:32 | EMA9:2445 | EMA21:2440
🧠 Claude Multi-Horizon [Gold Sentinel]:
  ├─ Court terme: BUY (TP +102%, SL -99%) — Scalp opportunity
  ├─ Moyen terme: HOLD (TP +108%, SL -95%) — Wait for confirmation
  └─ Long terme: BUY (TP +125%, SL -80%) — 30d trend solid

🟢 ACHAT COURT TERME Gold @ $2,450 | $6.65 (30% capital)
📈 Positions actives: SHORT_TERM: +0% | Capital: $6.65
```

### 3. Positions en cours

Vous verrez apparaître:
```
🟢 ACHAT COURT TERME    — Position 4-8h (gains 0-2%)
🟡 ACHAT MOYEN TERME    — Position 1 jour (gains 2-5%)
🔵 ACHAT LONG TERME     — Position 7 jours (gains 5-15%+)
```

---

## 📊 MONITORING

### Commandes de monitoring

```bash
# Voir les logs en temps réel
# Railway Dashboard → Logs → "Live"

# Historique des décisions Claude
curl -H "Authorization: Bearer <token>" \
  https://votre-app.railway.app/api/real/decisions?limit=20

# Status système
curl https://votre-app.railway.app/api/real/bots
```

### Signaux à surveiller

✅ **Tout va bien:**
```
✅ Solde Bybit: $XX.XX USDT
✅ ANTHROPIC_API_KEY configurée
✅ BYBIT_API_KEY configurée
🧠 Claude Multi-Horizon [Bot]: SHORT|MEDIUM|LONG
```

❌ **Problèmes à corriger:**
```
❌ Connexion Bybit: ...
❌ ANTHROPIC_API_KEY: undefined
❌ Erreur IA: Timeout ...
```

---

## 🔄 SI QQCH NE FONCTIONNE PAS

### Problème 1: "Cannot find module"

```bash
# Solution: Railway manque un fichier
# → Vérifier que tous les fichiers sont committé
git status
git add claude-trading-decisioner.js
git commit -m "Fix: Ajouter fichier manquant"
git push origin main
```

### Problème 2: "Claude not responding"

```bash
# Solution: ANTHROPIC_API_KEY manquante
# 1. Railway Dashboard → Settings → Environment Variables
# 2. Vérifier: ANTHROPIC_API_KEY=sk-ant-...
# 3. Redéployer: Railway → Deploy
```

### Problème 3: "Bybit API error"

```bash
# Solution: Clés Bybit invalides ou blocage géographique
# 1. Vérifier: BYBIT_API_KEY + BYBIT_SECRET corrects
# 2. Railway Settings → Region → Changer EU West
# 3. Redéployer
```

### Rollback à la version simple

```bash
# Si la version avancée a des problèmes:
git revert 768345b --no-edit
git push origin main

# Railway redéploie avec l'ancienne version
# Puis: Déboguer et relancer
```

---

## 🎯 ÉTAPES FINALES

### Checklist avant de pousser:

- [ ] GitHub CLI installé et authentifié (`gh auth status`)
- [ ] Terminal positionné sur le repo (`cd /tmp/nextrade-ai`)
- [ ] Vérifier les commits (`git log --oneline -5`)
- [ ] Vérifier que deploy.sh existe (`ls deploy.sh`)
- [ ] ANTHROPIC_API_KEY dans Railway ✅
- [ ] BYBIT_API_KEY dans Railway ✅

### COMMANDE FINALE:

```bash
git push origin main
```

**C'est tout!** Railway s'occupe du reste. ✅

---

## 📈 APRÈS LE DÉPLOIEMENT

### Premières 24h:

- Vous verrez les décisions Claude multi-horizon dans les logs
- Positions ouvertes simultanément sur 3 horizons
- Rendement attendu: 2-10% première journée (hypothétique)

### Suivre les profits:

```bash
# Vérifier l'historique des décisions
GET /api/real/decisions?limit=50

# Format:
{
  "shortTerm": { "action": "BUY", "tp": 102, "sl": 99 },
  "mediumTerm": { "action": "BUY", "tp": 108, "sl": 95 },
  "longTerm": { "action": "HOLD", "tp": 125, "sl": 80 }
}
```

---

## 🚀 C'EST PARTI!

```bash
cd /tmp/nextrade-ai
git push origin main

# Railway redéploie automatiquement
# Attendez ~30s
# Cherchez dans les logs: "🚀 NexTrade AI ADVANCED"

# 🎉 VOILÀ!
```

**Questions?** Consultez:
- `DEPLOYMENT_CONFIG.md` — Configuration
- `README.md` — Documentation complète
- Railway Dashboard → Logs — Diagnostic en temps réel

Bonne chance! 🎯
