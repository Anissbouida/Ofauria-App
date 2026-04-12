#!/bin/bash
# Script de build pour l'application mobile Ofauria
# Ce script build le client web avec l'URL API mobile, puis sync avec Capacitor

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
MOBILE_DIR="$SCRIPT_DIR"

echo "=== Build Ofauria Mobile ==="

# 1. Charger les variables d'environnement mobile
if [ -f "$MOBILE_DIR/.env.production" ]; then
  echo "→ Chargement de .env.production..."
  export $(grep -v '^#' "$MOBILE_DIR/.env.production" | xargs)
fi

# 2. Build du client web avec l'URL API mobile
echo "→ Build du client web..."
cd "$PROJECT_ROOT/client"
npx vite build

# 3. Sync avec Capacitor
echo "→ Synchronisation Capacitor..."
cd "$MOBILE_DIR"
npx cap sync

echo ""
echo "=== Build terminé ! ==="
echo "Pour ouvrir dans Android Studio : cd mobile && npx cap open android"
echo "Pour lancer sur un appareil    : cd mobile && npx cap run android"
