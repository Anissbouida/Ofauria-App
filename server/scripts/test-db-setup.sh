#!/usr/bin/env bash
# Base de test jetable pour les tests d'integration (vitest + TEST_DATABASE_URL).
#
# Cree (ou recree avec --reset) la base, pose le magasin par defaut dont
# plusieurs migrations de donnees dependent (070, 214), puis joue TOUTES les
# migrations. Les migrations de DONNEES qui referencent des UUID de la base de
# production (seeds de recettes 115/144, fiches...) echouent forcement sur une
# base vierge : elles sont marquees executees sans etre jouees, et listees a la
# fin pour controle. Une migration de SCHEMA qui echoue arrete le script.
#
# Usage :
#   server/scripts/test-db-setup.sh            # cree si absente, migre
#   server/scripts/test-db-setup.sh --reset    # drop + create + migre
#   TEST_PG_HOST=localhost TEST_PG_PORT=5432 TEST_DB_NAME=kalum_test
set -euo pipefail

HOST="${TEST_PG_HOST:-localhost}"
PORT="${TEST_PG_PORT:-5432}"
DB="${TEST_DB_NAME:-kalum_test}"
URL="postgres://${HOST}:${PORT}/${DB}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"

if [[ "${1:-}" == "--reset" ]]; then
  dropdb -h "$HOST" -p "$PORT" --if-exists "$DB"
fi
if ! psql -h "$HOST" -p "$PORT" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${DB}'" | grep -q 1; then
  createdb -h "$HOST" -p "$PORT" "$DB"
fi

# Pre-requis de donnees : table stores (mig 025) + magasin par defaut.
psql -h "$HOST" -p "$PORT" -d "$DB" -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE TABLE IF NOT EXISTS stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL, city VARCHAR(100), address TEXT, phone VARCHAR(30),
  is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO stores (id, name, city) VALUES ('00000000-0000-0000-0000-000000000001', 'Magasin test', 'Casablanca')
ON CONFLICT (id) DO NOTHING;
SQL

# Derives de schema : colonnes presentes en production mais creees par AUCUNE
# migration (ajoutees a la main). Une base vierge ne les a pas ; on les pose
# juste avant la migration qui en depend, sans toucher a cette migration (son
# checksum est fige en prod). Chaque entree est un constat a documenter.
drift_fix() {
  case "$1" in
    150_sales_special_type.sql)
      # sales.sale_type n'est cree nulle part ; la 150 etend seulement son CHECK.
      psql -h "$HOST" -p "$PORT" -d "$DB" -v ON_ERROR_STOP=1 -q -c \
        "ALTER TABLE sales ADD COLUMN IF NOT EXISTS sale_type VARCHAR(20) NOT NULL DEFAULT 'standard';"
      return 0 ;;
    *) return 1 ;;
  esac
}

SKIPPED=()
DRIFTED=()
for i in $(seq 1 80); do
  set +e
  OUT=$(cd "$HERE" && DATABASE_URL="$URL" JWT_SECRET="${JWT_SECRET:-0123456789abcdef0123456789abcdef0123456789abcdef}" npx tsx src/config/migrate.ts 2>&1)
  RC=$?
  set -e
  if [[ $RC -eq 0 ]]; then
    break
  fi
  FAILED=$(echo "$OUT" | grep -oE "❌ [0-9]+_[A-Za-z0-9_.-]+\.sql" | head -1 | sed 's/❌ //')
  if [[ -z "$FAILED" ]]; then
    echo "$OUT" | tail -20; echo "Echec sans migration identifiee"; exit 1
  fi
  # Derive de schema connue : on pose la colonne manquante et on rejoue (une seule fois).
  if [[ ! " ${DRIFTED[*]:-} " =~ " ${FAILED} " ]] && drift_fix "$FAILED"; then
    DRIFTED+=("$FAILED")
    continue
  fi
  # Migration de donnees (seed / fiche / recette / backfill / reprise) : on la marque executee.
  if echo "$FAILED" | grep -qiE "seed|fiche|recette|recipes_|opera|masterclass|backfill|reprise|restamp|convert_|densites_liquides|dedup"; then
    SUM=$(shasum -a 256 "$HERE/migrations/$FAILED" | cut -d' ' -f1)
    psql -h "$HOST" -p "$PORT" -d "$DB" -q -c "INSERT INTO _migrations (name, checksum) VALUES ('$FAILED', '$SUM') ON CONFLICT (name) DO NOTHING;"
    SKIPPED+=("$FAILED")
    continue
  fi
  echo "$OUT" | grep -A6 "❌" | head -12
  echo "Migration de SCHEMA en echec : $FAILED — a corriger."; exit 1
done

echo "Base ${URL} prete : $(psql -h "$HOST" -p "$PORT" -d "$DB" -tAc 'SELECT count(*) FROM _migrations') migrations."
if [[ ${#SKIPPED[@]} -gt 0 ]]; then
  echo "Migrations de donnees marquees sans etre jouees (${#SKIPPED[@]}) :"
  printf '  - %s\n' "${SKIPPED[@]}"
fi
if [[ ${#DRIFTED[@]} -gt 0 ]]; then
  echo "Derives de schema corrigees avant rejeu (${#DRIFTED[@]}) :"
  printf '  - %s\n' "${DRIFTED[@]}"
fi
echo "export TEST_DATABASE_URL=${URL}"
