#!/usr/bin/env bash
set -euo pipefail

INSTANCE="ofauria:europe-west1:ofauria-db"
PROXY_PORT=5434
PROD_USER="ofauria"
PROD_DB="ofauria_db"

LOCAL_URL="postgresql://ofauria:ofauria_secret@localhost:5433/ofauria_db"

PG16="/opt/homebrew/opt/postgresql@16/bin"
DUMP_FILE="/tmp/ofauria_prod_$(date +%Y%m%d_%H%M%S).dump"

PROD_PASS=$(gcloud secrets versions access latest --secret="DATABASE_URL" --project="ofauria" \
  | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')

start_proxy() {
  if lsof -i :"$PROXY_PORT" -sTCP:LISTEN &>/dev/null; then
    echo "    Proxy déjà actif sur le port $PROXY_PORT"
    return
  fi
  cloud-sql-proxy "$INSTANCE" --port "$PROXY_PORT" &
  PROXY_PID=$!
  sleep 3
  if ! kill -0 "$PROXY_PID" 2>/dev/null; then
    echo "ERREUR: le proxy n'a pas démarré." >&2
    exit 1
  fi
  echo "    Proxy démarré (PID $PROXY_PID)"
}

cleanup() {
  if [ -n "${PROXY_PID:-}" ] && kill -0 "$PROXY_PID" 2>/dev/null; then
    echo "Arrêt du proxy..."
    kill "$PROXY_PID" 2>/dev/null || true
    wait "$PROXY_PID" 2>/dev/null || true
  fi
  rm -f "$DUMP_FILE"
}
trap cleanup EXIT

echo "==> Connexion à Cloud SQL..."
start_proxy

echo "==> Export de la base de production..."
PGPASSWORD="$PROD_PASS" "$PG16/pg_dump" \
  -h 127.0.0.1 -p "$PROXY_PORT" -U "$PROD_USER" -d "$PROD_DB" \
  --no-owner --no-acl -Fc \
  -f "$DUMP_FILE"
echo "    Dump enregistré: $(du -h "$DUMP_FILE" | cut -f1)"

echo "==> Reset du schema local..."
psql "$LOCAL_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" 2>&1

echo "==> Import dans la base locale..."
"$PG16/pg_restore" --no-owner --no-acl -d "$LOCAL_URL" "$DUMP_FILE" 2>&1 \
  | grep "^pg_restore: error:" || true

NB=$(psql "$LOCAL_URL" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';")
echo "==> Terminé ! $NB tables synchronisées."
