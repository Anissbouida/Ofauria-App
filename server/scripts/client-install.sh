#!/usr/bin/env bash
# Installation de Kalum chez un nouveau client : base VIDE prête pour l'assistant de configuration.
#
#   server/scripts/client-install.sh "postgresql://user:motdepasse@hote:port/base"
#
# 1. Joue TOUTES les migrations sur la base (vide ou neuve) avec le lanceur du projet ;
#    les migrations de données liées aux identifiants d'Ofauria (fiches 115 à 303) qui échouent
#    sur une base vierge sont marquées exécutées sans être jouées, comme dans test-db-setup.sh.
# 2. Retire les données d'Ofauria que d'anciennes migrations sèment sur toute base vierge
#    (catalogue de la mig 128, fond de caisse et salariés de la mig 214, équipements, ateliers,
#    contenants, emplacements, tâches HACCP, catégories de fiches) — ces migrations sont figées
#    en production (empreinte), on ne peut pas les modifier.
# 3. Crée l'administrateur seul (mot de passe aléatoire affiché UNE fois) : SEED_ADMIN_ONLY=1.
#
# Garde-fou : refuse de nettoyer une base qui contient déjà des ventes, des écritures comptables
# ou des factures (ce n'est plus une installation neuve).
set -euo pipefail

URL="${1:?Usage : client-install.sh <DATABASE_URL>}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
PSQL=(psql "$URL" -v ON_ERROR_STOP=1 -q)

has_table() { [[ "$(psql "$URL" -tAc "SELECT to_regclass('public.$1') IS NOT NULL")" == "t" ]]; }

if has_table sales; then
  USED=$(psql "$URL" -tAc "SELECT (SELECT count(*) FROM sales) + (SELECT count(*) FROM journal_entries) + (SELECT count(*) FROM invoices)")
  if [[ "$USED" != "0" ]]; then
    echo "Base déjà utilisée ($USED ventes / écritures / factures) : installation refusée." >&2
    exit 1
  fi
fi

# Pré-requis de données de certaines migrations (070, 214) : magasin par défaut.
"${PSQL[@]}" <<'SQL'
CREATE TABLE IF NOT EXISTS stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL, city VARCHAR(100), address TEXT, phone VARCHAR(30),
  is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO stores (id, name) VALUES ('00000000-0000-0000-0000-000000000001', 'Magasin principal')
ON CONFLICT (id) DO NOTHING;
SQL

echo "==> Migrations…"
SKIPPED=()
for i in $(seq 1 80); do
  set +e
  OUT=$(cd "$HERE" && DATABASE_URL="$URL" npx tsx src/config/migrate.ts 2>&1)
  RC=$?
  set -e
  [[ $RC -eq 0 ]] && break
  FAILED=$(echo "$OUT" | grep -oE "❌ [0-9]+_[A-Za-z0-9_.-]+\.sql" | head -1 | sed 's/❌ //')
  if [[ -z "$FAILED" ]]; then echo "$OUT" | tail -20; exit 1; fi
  if [[ "$FAILED" == "150_sales_special_type.sql" ]]; then
    "${PSQL[@]}" -c "ALTER TABLE sales ADD COLUMN IF NOT EXISTS sale_type VARCHAR(20) NOT NULL DEFAULT 'standard';"
    continue
  fi
  if echo "$FAILED" | grep -qiE "seed|fiche|recette|recipes_|opera|masterclass|torsade|foret_noire|darija|bases_transversales|backfill|reprise|restamp|convert_|densites_liquides|dedup"; then
    SUM=$(shasum -a 256 "$HERE/migrations/$FAILED" | cut -d' ' -f1)
    "${PSQL[@]}" -c "INSERT INTO _migrations (name, checksum) VALUES ('$FAILED', '$SUM') ON CONFLICT (name) DO NOTHING;"
    SKIPPED+=("$FAILED")
    continue
  fi
  echo "$OUT" | grep -A6 "❌" | head -12; echo "Migration de schéma en échec : $FAILED" >&2; exit 1
done
echo "    $(psql "$URL" -tAc 'SELECT count(*) FROM _migrations') migrations appliquées (${#SKIPPED[@]} reprises Ofauria non jouées)."

echo "==> Retrait des données d'Ofauria semées par les migrations…"
"${PSQL[@]}" <<'SQL'
BEGIN;
-- Fond de caisse initial d'Ofauria (mig 214) : paiement exécuté, protégé contre la suppression.
-- Base neuve, aucune écriture n'en dépend : garde-fou levé et rétabli dans la même transaction.
ALTER TABLE payments DISABLE TRIGGER payments_no_delete;
DELETE FROM payments;
ALTER TABLE payments ENABLE TRIGGER payments_no_delete;
DELETE FROM employee_salary_history;
DELETE FROM employees;
DELETE FROM products;
DELETE FROM categories;
-- Audit des profils (L1) : identité à blanc (la migration 013 sème celle d'Ofauria) ; fidélité
-- éteinte jusqu'à ce que la société active la capacité.
UPDATE company_settings SET company_name = '', subtitle = '', logo_url = NULL WHERE id = 1;
UPDATE loyalty_settings SET enabled = false;
DELETE FROM production_workshops;
DELETE FROM stock_locations;
DELETE FROM production_equipements;
DELETE FROM production_contenants;
DELETE FROM haccp_cleaning_tasks;
DELETE FROM quality_control_plan_lines;
DELETE FROM recipe_categories;
UPDATE stores SET name = 'Magasin principal', city = NULL WHERE id = '00000000-0000-0000-0000-000000000001';
COMMIT;
SQL

echo "==> Administrateur…"
(cd "$HERE" && DATABASE_URL="$URL" SEED_ADMIN_ONLY=1 npx tsx src/config/seed.ts)

echo "==> Contrôle…"
psql "$URL" -f "$HERE/scripts/post-migration-check.sql"
echo "Installation terminée : connectez-vous avec l'administrateur ci-dessus ; l'assistant de configuration démarre (choix du secteur)."
