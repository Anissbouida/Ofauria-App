#!/usr/bin/env bash
# =====================================================================
# Migration des données économat (local → Google Cloud SQL Postgres)
# =====================================================================
#
# Périmètre :
#   - ingredients (catalogue + coûts + fournisseur + catégorie)
#   - ingredient_lots (stock + traçabilité par lot)
#   - daily_inventory_checks + daily_inventory_check_items
#
# Stratégie : UPSERT sur l'id (UUID) — préserve l'historique côté prod,
# met à jour les champs modifiés depuis le local.
#
# Pré-requis côté Cloud SQL :
#   - Les tables suppliers, stores, users, products doivent déjà exister
#     avec les mêmes UUIDs (sinon les lignes FK seront rejetées).
#   - L'IP de la machine qui exécute ce script doit être whitelistée dans
#     Cloud SQL > Connexions > Réseaux autorisés.
#   - Variable GCP_DB_PASSWORD exportée (ou .pgpass configuré).
#
# Usage :
#   GCP_DB_HOST=34.x.x.x \
#   GCP_DB_PORT=5432 \
#   GCP_DB_USER=ofauria \
#   GCP_DB_PASSWORD=xxx \
#   GCP_DB_NAME=ofauria_db \
#   ./scripts/migrate-economat-to-gcp.sh
#
#   Options :
#     --dry-run        Génère le SQL mais ne l'applique pas (revue manuelle)
#     --no-confirm     Saute la confirmation interactive
#     --tables ing,lots,inv   Migre seulement certaines catégories
#
# =====================================================================

set -euo pipefail

# ─── Defaults locales ──────────────────────────────────────────────
LOCAL_DB_HOST="${LOCAL_DB_HOST:-localhost}"
LOCAL_DB_PORT="${LOCAL_DB_PORT:-5433}"
LOCAL_DB_USER="${LOCAL_DB_USER:-ofauria}"
LOCAL_DB_PASSWORD="${LOCAL_DB_PASSWORD:-ofauria_secret}"
LOCAL_DB_NAME="${LOCAL_DB_NAME:-ofauria_db}"

# ─── GCP requis ────────────────────────────────────────────────────
: "${GCP_DB_HOST:?Variable GCP_DB_HOST obligatoire (IP publique Cloud SQL)}"
: "${GCP_DB_USER:?Variable GCP_DB_USER obligatoire}"
: "${GCP_DB_PASSWORD:?Variable GCP_DB_PASSWORD obligatoire}"
: "${GCP_DB_NAME:?Variable GCP_DB_NAME obligatoire}"
GCP_DB_PORT="${GCP_DB_PORT:-5432}"

# ─── Options CLI ───────────────────────────────────────────────────
DRY_RUN=0
NO_CONFIRM=0
TABLES_FILTER="ingredients,lots,inventory"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --no-confirm) NO_CONFIRM=1; shift ;;
    --tables) TABLES_FILTER="$2"; shift 2 ;;
    *) echo "Option inconnue : $1" >&2; exit 1 ;;
  esac
done

# ─── Préparation ───────────────────────────────────────────────────
TS=$(date +%Y%m%d_%H%M%S)
OUT_DIR="/tmp/economat-migration-${TS}"
mkdir -p "$OUT_DIR"
DUMP_FILE="$OUT_DIR/economat-upsert.sql"

PSQL_LOCAL=(psql -h "$LOCAL_DB_HOST" -p "$LOCAL_DB_PORT" -U "$LOCAL_DB_USER" -d "$LOCAL_DB_NAME" -v ON_ERROR_STOP=1 --no-password)
PSQL_GCP=(psql -h "$GCP_DB_HOST" -p "$GCP_DB_PORT" -U "$GCP_DB_USER" -d "$GCP_DB_NAME" -v ON_ERROR_STOP=1 --no-password)

echo "──────────────────────────────────────────────────────────────────"
echo "  Migration économat → Google Cloud SQL"
echo "──────────────────────────────────────────────────────────────────"
echo "  Source : ${LOCAL_DB_USER}@${LOCAL_DB_HOST}:${LOCAL_DB_PORT}/${LOCAL_DB_NAME}"
echo "  Cible  : ${GCP_DB_USER}@${GCP_DB_HOST}:${GCP_DB_PORT}/${GCP_DB_NAME}"
echo "  Tables : $TABLES_FILTER"
echo "  Dump   : $DUMP_FILE"
echo "──────────────────────────────────────────────────────────────────"

# ─── 1. Test de connectivité ───────────────────────────────────────
echo ""
echo "▶ Test connexion locale…"
PGPASSWORD="$LOCAL_DB_PASSWORD" "${PSQL_LOCAL[@]}" -c "SELECT current_database(), current_user;" >/dev/null
echo "  ✓ Local OK"

if [[ "$DRY_RUN" -ne 1 ]]; then
  echo "▶ Test connexion Cloud SQL…"
  PGPASSWORD="$GCP_DB_PASSWORD" "${PSQL_GCP[@]}" -c "SELECT current_database(), current_user;" >/dev/null
  echo "  ✓ Cloud SQL OK"
else
  echo "▶ Skip test Cloud SQL (dry-run)"
fi

# ─── 2. Vérification des dépendances FK côté GCP ───────────────────
if [[ "$DRY_RUN" -ne 1 ]]; then
  echo ""
  echo "▶ Vérification des dépendances FK sur Cloud SQL…"
  DEPS=$(PGPASSWORD="$GCP_DB_PASSWORD" "${PSQL_GCP[@]}" -t -A -F'|' -c "
  SELECT
    (SELECT COUNT(*) FROM suppliers),
    (SELECT COUNT(*) FROM stores),
    (SELECT COUNT(*) FROM users),
    (SELECT COUNT(*) FROM products);
  ")
  IFS='|' read -r N_SUPP N_STORES N_USERS N_PROD <<< "$DEPS"
  echo "  suppliers=${N_SUPP}  stores=${N_STORES}  users=${N_USERS}  products=${N_PROD}"
  if [[ "$N_STORES" -eq 0 ]] || [[ "$N_USERS" -eq 0 ]]; then
    echo "  ⚠ ATTENTION : Cloud SQL semble vide. Migrez d'abord les tables parent (users, stores)." >&2
    if [[ "$NO_CONFIRM" -ne 1 ]]; then
      read -rp "Continuer quand même ? [y/N] " CONT
      [[ "$CONT" =~ ^[yY]$ ]] || exit 1
    fi
  fi
fi

# ─── 3. Génération du dump UPSERT ──────────────────────────────────
echo ""
echo "▶ Génération du dump UPSERT…"

cat > "$DUMP_FILE" <<'SQL_HEADER'
-- =====================================================================
-- Migration économat — UPSERT généré automatiquement
-- =====================================================================
-- Stratégie : ON CONFLICT (id) DO UPDATE — mise à jour des lignes existantes
-- par id (UUID). Préserve created_at d'origine côté prod.
-- =====================================================================

BEGIN;
-- Note : session_replication_role retiré car Cloud SQL n'autorise pas ce parametre
-- (privileges superuser requis). Les triggers s'executeront normalement.

SQL_HEADER

# ─── 3a. Ingredients ──────────────────────────────────────────────
if [[ "$TABLES_FILTER" == *"ingredients"* ]]; then
  echo "  ↳ Export ingredients…"
  cat >> "$DUMP_FILE" <<'SQL_ING_HEADER'

-- ─── INGREDIENTS ─────────────────────────────────────────────────────
SQL_ING_HEADER

  PGPASSWORD="$LOCAL_DB_PASSWORD" "${PSQL_LOCAL[@]}" -t -A -q -c "
SELECT format(
  'INSERT INTO ingredients (id, name, unit, unit_cost, supplier, allergens, category, container_size, supplier_reference, supplier_id, created_at) VALUES (%L, %L, %L, %s, %L, %L, %L, %s, %L, %L, %L) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, unit=EXCLUDED.unit, unit_cost=EXCLUDED.unit_cost, supplier=EXCLUDED.supplier, allergens=EXCLUDED.allergens, category=EXCLUDED.category, container_size=EXCLUDED.container_size, supplier_reference=EXCLUDED.supplier_reference, supplier_id=EXCLUDED.supplier_id;',
  id, name, unit, unit_cost,
  supplier, allergens, category,
  COALESCE(container_size::text, 'NULL'),
  supplier_reference, supplier_id, created_at
)
FROM ingredients
ORDER BY name;
" >> "$DUMP_FILE"
  ING_COUNT=$(grep -c "^INSERT INTO ingredients" "$DUMP_FILE" || true)
  echo "    → $ING_COUNT lignes"
fi

# ─── 3b. Ingredient lots ──────────────────────────────────────────
if [[ "$TABLES_FILTER" == *"lots"* ]]; then
  echo "  ↳ Export ingredient_lots…"
  cat >> "$DUMP_FILE" <<'SQL_LOT_HEADER'

-- ─── INGREDIENT_LOTS ─────────────────────────────────────────────────
SQL_LOT_HEADER

  PGPASSWORD="$LOCAL_DB_PASSWORD" "${PSQL_LOCAL[@]}" -t -A -q -c "
SELECT format(
  'INSERT INTO ingredient_lots (id, ingredient_id, supplier_id, lot_number, supplier_lot_number, quantity_received, quantity_remaining, unit_cost, manufactured_date, expiration_date, received_at, store_id, status, notes, economat_quantity, pesage_quantity, first_opened_at, opening_history, effective_expiry_after_opening, created_at) VALUES (%L, %L, %L, %L, %L, %s, %s, %s, %L, %L, %L, %L, %L, %L, %s, %s, %L, %L::jsonb, %L, %L) ON CONFLICT (id) DO UPDATE SET quantity_remaining=EXCLUDED.quantity_remaining, economat_quantity=EXCLUDED.economat_quantity, pesage_quantity=EXCLUDED.pesage_quantity, status=EXCLUDED.status, notes=EXCLUDED.notes, first_opened_at=EXCLUDED.first_opened_at, opening_history=EXCLUDED.opening_history, effective_expiry_after_opening=EXCLUDED.effective_expiry_after_opening, supplier_lot_number=EXCLUDED.supplier_lot_number, unit_cost=EXCLUDED.unit_cost;',
  id, ingredient_id, supplier_id, lot_number, supplier_lot_number,
  quantity_received, quantity_remaining,
  COALESCE(unit_cost::text, 'NULL'),
  manufactured_date, expiration_date, received_at, store_id, status, notes,
  economat_quantity, pesage_quantity,
  first_opened_at, opening_history::text, effective_expiry_after_opening, created_at
)
FROM ingredient_lots
WHERE status IN ('active', 'depleted', 'expired', 'quarantine')
ORDER BY received_at;
" >> "$DUMP_FILE"
  LOT_COUNT=$(grep -c "^INSERT INTO ingredient_lots" "$DUMP_FILE" || true)
  echo "    → $LOT_COUNT lignes"
fi

# ─── 3c. Daily inventory checks ───────────────────────────────────
if [[ "$TABLES_FILTER" == *"inventory"* ]]; then
  echo "  ↳ Export daily_inventory_checks…"
  cat >> "$DUMP_FILE" <<'SQL_INV_HEADER'

-- ─── DAILY_INVENTORY_CHECKS ──────────────────────────────────────────
SQL_INV_HEADER

  PGPASSWORD="$LOCAL_DB_PASSWORD" "${PSQL_LOCAL[@]}" -t -A -q -c "
SELECT format(
  'INSERT INTO daily_inventory_checks (id, store_id, session_id, checked_by, total_replenished, total_sold, total_remaining, total_discrepancy, notes, check_type, previous_check_id, status, validated_by, validated_at, rejection_reason, created_at) VALUES (%L, %L, %L, %L, %s, %s, %s, %s, %L, %L, %L, %L, %L, %L, %L, %L) ON CONFLICT (id) DO UPDATE SET total_replenished=EXCLUDED.total_replenished, total_sold=EXCLUDED.total_sold, total_remaining=EXCLUDED.total_remaining, total_discrepancy=EXCLUDED.total_discrepancy, status=EXCLUDED.status, validated_by=EXCLUDED.validated_by, validated_at=EXCLUDED.validated_at, rejection_reason=EXCLUDED.rejection_reason;',
  id, store_id, session_id, checked_by,
  total_replenished, total_sold, total_remaining, total_discrepancy,
  notes, check_type, previous_check_id, status, validated_by, validated_at, rejection_reason, created_at
)
FROM daily_inventory_checks
ORDER BY created_at;
" >> "$DUMP_FILE"
  CHK_COUNT=$(grep -c "^INSERT INTO daily_inventory_checks" "$DUMP_FILE" || true)
  echo "    → $CHK_COUNT checks"

  echo "  ↳ Export daily_inventory_check_items…"
  cat >> "$DUMP_FILE" <<'SQL_ITEM_HEADER'

-- ─── DAILY_INVENTORY_CHECK_ITEMS ─────────────────────────────────────
SQL_ITEM_HEADER

  PGPASSWORD="$LOCAL_DB_PASSWORD" "${PSQL_LOCAL[@]}" -t -A -q -c "
SELECT format(
  'INSERT INTO daily_inventory_check_items (id, check_id, product_id, product_name, replenished_qty, sold_qty, remaining_qty, discrepancy, destination, reexposition_count, display_status, expected_qty, found_qty, missing_reason, created_at) VALUES (%L, %L, %L, %L, %s, %s, %s, %s, %L, %s, %L, %s, %s, %L, %L) ON CONFLICT (id) DO UPDATE SET replenished_qty=EXCLUDED.replenished_qty, sold_qty=EXCLUDED.sold_qty, remaining_qty=EXCLUDED.remaining_qty, discrepancy=EXCLUDED.discrepancy, destination=EXCLUDED.destination, expected_qty=EXCLUDED.expected_qty, found_qty=EXCLUDED.found_qty, missing_reason=EXCLUDED.missing_reason;',
  id, check_id, product_id, product_name,
  replenished_qty, sold_qty, remaining_qty, discrepancy,
  destination,
  COALESCE(reexposition_count::text, '0'),
  display_status,
  COALESCE(expected_qty::text, 'NULL'),
  COALESCE(found_qty::text, 'NULL'),
  missing_reason, created_at
)
FROM daily_inventory_check_items
ORDER BY created_at;
" >> "$DUMP_FILE"
  ITEM_COUNT=$(grep -c "^INSERT INTO daily_inventory_check_items" "$DUMP_FILE" || true)
  echo "    → $ITEM_COUNT items"
fi

cat >> "$DUMP_FILE" <<'SQL_FOOTER'

COMMIT;
SQL_FOOTER

DUMP_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
echo ""
echo "✓ Dump généré : $DUMP_FILE ($DUMP_SIZE)"

# ─── 4. Dry-run ? ─────────────────────────────────────────────────
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo ""
  echo "── DRY-RUN — fichier prêt à inspecter ──"
  echo "$DUMP_FILE"
  echo ""
  echo "Pour appliquer manuellement :"
  echo "  PGPASSWORD=\"\$GCP_DB_PASSWORD\" psql -h $GCP_DB_HOST -p $GCP_DB_PORT -U $GCP_DB_USER -d $GCP_DB_NAME -v ON_ERROR_STOP=1 -f $DUMP_FILE"
  exit 0
fi

# ─── 5. Confirmation ──────────────────────────────────────────────
echo ""
echo "──────────────────────────────────────────────────────────────────"
echo "  PRÊT À APPLIQUER SUR ${GCP_DB_HOST}:${GCP_DB_PORT}/${GCP_DB_NAME}"
echo "──────────────────────────────────────────────────────────────────"
if [[ "$NO_CONFIRM" -ne 1 ]]; then
  read -rp "Appliquer maintenant ? [y/N] " CONFIRM
  if [[ ! "$CONFIRM" =~ ^[yY]$ ]]; then
    echo "Annulé. Le dump reste disponible : $DUMP_FILE"
    exit 0
  fi
fi

# ─── 6. Application ───────────────────────────────────────────────
echo ""
echo "▶ Application sur Cloud SQL…"
LOG_FILE="$OUT_DIR/apply.log"

START_TS=$(date +%s)
if PGPASSWORD="$GCP_DB_PASSWORD" "${PSQL_GCP[@]}" -f "$DUMP_FILE" > "$LOG_FILE" 2>&1; then
  END_TS=$(date +%s)
  echo "  ✓ Appliqué en $((END_TS - START_TS))s"
else
  echo "  ✗ Échec — voir log : $LOG_FILE" >&2
  tail -20 "$LOG_FILE" >&2
  exit 1
fi

# ─── 7. Vérification post-migration ───────────────────────────────
echo ""
echo "▶ Vérification post-migration…"
PGPASSWORD="$GCP_DB_PASSWORD" "${PSQL_GCP[@]}" -c "
SELECT
  (SELECT COUNT(*) FROM ingredients)                       AS ingredients_gcp,
  (SELECT COUNT(*) FROM ingredient_lots WHERE status='active') AS lots_actifs_gcp,
  (SELECT COUNT(*) FROM daily_inventory_checks)            AS checks_gcp,
  (SELECT COUNT(*) FROM daily_inventory_check_items)       AS items_gcp;
"

echo ""
echo "──────────────────────────────────────────────────────────────────"
echo "  ✓ Migration terminée"
echo "──────────────────────────────────────────────────────────────────"
echo "  Dump conservé : $DUMP_FILE"
echo "  Log           : $LOG_FILE"
echo "──────────────────────────────────────────────────────────────────"
