#!/bin/bash

# 🚀 Script de déploiement NexTrade AI Multi-Horizon
# Exécuté automatiquement par Railway au démarrage

echo "🚀 NexTrade AI — Déploiement Multi-Horizon"
echo "==========================================="

# Vérifier quelle version utiliser (défaut: ADVANCED)
USE_ADVANCED=${USE_ADVANCED:-true}

if [ "$USE_ADVANCED" = "true" ]; then
  echo "✅ Mode: AVANCÉ (Multi-Horizon)"
  echo "Activation des fichiers avancés..."
  
  # Garder une sauvegarde de la version simple
  if [ -f "trading-engine.js" ] && [ ! -f "trading-engine.simple.js" ]; then
    cp trading-engine.js trading-engine.simple.js
    echo "📦 Backup créé: trading-engine.simple.js"
  fi
  
  # Vérifier que la version avancée existe
  if [ ! -f "trading-engine-advanced.js" ]; then
    echo "❌ ERREUR: trading-engine-advanced.js non trouvé!"
    exit 1
  fi
  
  if [ ! -f "claude-trading-decisioner.js" ]; then
    echo "❌ ERREUR: claude-trading-decisioner.js non trouvé!"
    exit 1
  fi
  
  # Créer un symlink ou copier (selon l'environnement)
  if [ -f "trading-engine.js" ]; then
    rm trading-engine.js
  fi
  cp trading-engine-advanced.js trading-engine.js
  echo "✅ Version avancée activée"
  
else
  echo "⚙️ Mode: SIMPLE (Original)"
  echo "Utilisation de la version simple..."
  
  if [ -f "trading-engine.simple.js" ]; then
    cp trading-engine.simple.js trading-engine.js
    echo "✅ Version simple restaurée"
  fi
fi

# Vérifier l'intégrité des fichiers
echo ""
echo "🔍 Vérification des fichiers..."

REQUIRED_FILES=(
  "server.js"
  "trading-engine.js"
  "claude-bot-controller.js"
  "claude-trading-decisioner.js"
  "package.json"
)

MISSING=0
for file in "${REQUIRED_FILES[@]}"; do
  if [ -f "$file" ]; then
    echo "✅ $file"
  else
    echo "❌ $file MANQUANT!"
    MISSING=$((MISSING + 1))
  fi
done

if [ $MISSING -gt 0 ]; then
  echo ""
  echo "❌ $MISSING fichier(s) manquant(s)!"
  exit 1
fi

# Vérifier les variables d'env
echo ""
echo "🔐 Vérification des variables d'environnement..."

if [ -z "$BYBIT_API_KEY" ]; then
  echo "⚠️ BYBIT_API_KEY non définie (trading désactivé)"
else
  echo "✅ BYBIT_API_KEY configurée"
fi

if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "⚠️ ANTHROPIC_API_KEY non définie (Claude désactivé)"
else
  echo "✅ ANTHROPIC_API_KEY configurée"
fi

# Installer les dépendances
echo ""
echo "📦 Installation des dépendances..."
npm install

# Prêt!
echo ""
echo "✅ DÉPLOIEMENT PRÊT!"
echo ""
if [ "$USE_ADVANCED" = "true" ]; then
  echo "🚀 Version: AVANCÉE (Claude Multi-Horizon)"
  echo "   ├─ Court terme (0-4h)"
  echo "   ├─ Moyen terme (4h-1d)"
  echo "   └─ Long terme (1-30j)"
else
  echo "⚙️ Version: SIMPLE (Original)"
fi

echo ""
echo "Le serveur démarre maintenant..."
echo "Logs:"
echo "  - Chercher: '🚀 NexTrade AI'"
echo "  - Chercher: '🧠 Claude'"
echo ""
