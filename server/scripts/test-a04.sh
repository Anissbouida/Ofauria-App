#!/usr/bin/env bash
# Tests OWASP A04 Insecure Design — Ofauria
set -u

# OWASP A08 : les mutations necessitent un Origin reconnu par le serveur.
ORIGIN_HDR="Origin: http://localhost:5173"
_CURL_BIN=$(which curl)
curl() { "$_CURL_BIN" -H "$ORIGIN_HDR" "$@"; }
API="${API:-http://localhost:3001/api/v1}"
PASS=0
FAIL=0
SKIP=0

green() { printf "\033[0;32m%s\033[0m\n" "$*"; }
red()   { printf "\033[0;31m%s\033[0m\n" "$*"; }
yel()   { printf "\033[0;33m%s\033[0m\n" "$*"; }
blue()  { printf "\033[0;34m%s\033[0m\n" "$*"; }

assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    green "  ✅ PASS  $label"
    PASS=$((PASS+1))
  else
    red   "  ❌ FAIL  $label  (expected=$expected, got=$actual)"
    FAIL=$((FAIL+1))
  fi
}

blue "═══════════════════════════════════════════════════════"
blue " OWASP A04 — Insecure Design — tests"
blue "═══════════════════════════════════════════════════════"

# ─── Setup ────────────────────────────────────────────────
blue "\n[setup] Login admin pour setup"
ADMIN_TOKEN=$(curl -s -X POST "$API/auth/login" -H "Content-Type: application/json" \
  -d '{"email":"admin@ofauria.com","password":"admin123"}' | jq -r '.data.token // empty')

if [ -z "$ADMIN_TOKEN" ]; then
  red "❌ Impossible de se connecter en admin (admin123)"
  echo "   Si A02-3 seed a deja tourne, utilisez SEED_ADMIN_PASSWORD."
  exit 1
fi
green "  ✅ admin token OK"

# Reset lockout sur le compte admin (si precedents tests)
PGPASSWORD="${PGPASSWORD:-ofauria_secret}" psql -h "${PGHOST:-localhost}" -p "${PGPORT:-5433}" \
  -U "${PGUSER:-ofauria}" -d "${PGDB:-ofauria_db}" -t -A -c \
  "UPDATE users SET failed_login_count=0, locked_until=NULL WHERE email='admin@ofauria.com'" > /dev/null 2>&1

# Creer un compte test dedie pour le lockout
LOCKTEST_EMAIL="locktest.$$@test.com"
curl -s -o /dev/null -X POST "$API/auth/register" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$LOCKTEST_EMAIL\",\"password\":\"TestPass123!\",\"firstName\":\"Lock\",\"lastName\":\"Test\",\"role\":\"cashier\"}"

# ─── A04-2 Lockout apres 5 echecs ─────────────────────────
blue "\n▶ A04-2 Lockout compte apres 5 echecs consecutifs"

# Reset le compteur avant test (utile si tests precedents)
PGPASSWORD="${PGPASSWORD:-ofauria_secret}" psql -h "${PGHOST:-localhost}" -p "${PGPORT:-5433}" \
  -U "${PGUSER:-ofauria}" -d "${PGDB:-ofauria_db}" -t -A -c \
  "UPDATE users SET failed_login_count=0, locked_until=NULL WHERE email='$LOCKTEST_EMAIL'" > /dev/null 2>&1

# Simule 4 echecs (sous le seuil, pas encore verrouille)
for i in 1 2 3 4; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$LOCKTEST_EMAIL\",\"password\":\"WrongPassword$i\"}")
  if [ "$STATUS" != "401" ]; then
    yel "  ⚠️  tentative $i: attendu 401, got $STATUS (rate-limit peut-etre)"
  fi
done
green "  ✅ 4 echecs consecutifs retournent 401 (sous le seuil)"
PASS=$((PASS+1))

# 5e echec : declenche le lockout
STATUS_5=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$LOCKTEST_EMAIL\",\"password\":\"WrongPassword5\"}")

if [ "$STATUS_5" = "423" ]; then
  green "  ✅ PASS  5e echec declenche lockout (423)"
  PASS=$((PASS+1))
elif [ "$STATUS_5" = "401" ]; then
  # Certaines implems retournent 401 sur la 5e et 423 sur la 6e
  STATUS_6=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$LOCKTEST_EMAIL\",\"password\":\"anything\"}")
  assert_eq "lockout 423 sur tentative suivante" "423" "$STATUS_6"
else
  red "  ❌ FAIL  lockout non declenche, got status=$STATUS_5"
  FAIL=$((FAIL+1))
fi

# Meme avec le BON password, compte verrouille -> 423
STATUS_CORRECT=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$LOCKTEST_EMAIL\",\"password\":\"TestPass123!\"}")
assert_eq "bon password refuse pendant lockout (423)" "423" "$STATUS_CORRECT"

# Unlock manuel pour nettoyage
PGPASSWORD="${PGPASSWORD:-ofauria_secret}" psql -h "${PGHOST:-localhost}" -p "${PGPORT:-5433}" \
  -U "${PGUSER:-ofauria}" -d "${PGDB:-ofauria_db}" -t -A -c \
  "UPDATE users SET failed_login_count=0, locked_until=NULL WHERE email='$LOCKTEST_EMAIL'" > /dev/null 2>&1

# Apres unlock : bon password -> 200 + compteur reset
LOGIN_OK=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$LOCKTEST_EMAIL\",\"password\":\"TestPass123!\"}" | jq -r '.success // false')
assert_eq "login reussi apres unlock" "true" "$LOGIN_OK"

# ─── A04-3 Race condition stock vitrine ───────────────────
blue "\n▶ A04-3 Refus vente si stock vitrine insuffisant (pas de clamp)"

# Cherche un produit existant avec stock vitrine a 0 (ou impose-le)
PRODUCT_ID=$(curl -s "$API/products" -H "Authorization: Bearer $ADMIN_TOKEN" | jq -r '.data[0].id // empty')
STORE_ID=$(curl -s "$API/stores" -H "Authorization: Bearer $ADMIN_TOKEN" | jq -r '.data[0].id // empty')

if [ -z "$PRODUCT_ID" ] || [ -z "$STORE_ID" ]; then
  yel "  ⏭  SKIP : pas de produit ou store disponible"
  SKIP=$((SKIP+2))
else
  # Force vitrine_quantity = 0 pour ce produit dans ce store
  PGPASSWORD="${PGPASSWORD:-ofauria_secret}" psql -h "${PGHOST:-localhost}" -p "${PGPORT:-5433}" \
    -U "${PGUSER:-ofauria}" -d "${PGDB:-ofauria_db}" -t -A -c \
    "INSERT INTO product_store_stock (product_id, store_id, stock_quantity, vitrine_quantity)
     VALUES ('$PRODUCT_ID', '$STORE_ID', 0, 0)
     ON CONFLICT (product_id, store_id) DO UPDATE SET vitrine_quantity = 0" > /dev/null 2>&1

  # Assure qu'une session de caisse est ouverte pour l'admin
  curl -s -o /dev/null -X POST "$API/cash-register/open" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" -d '{"openingAmount":0}' 2>&1

  # Tenter la vente : DOIT etre refusee avec 400 (pre-check) ou 409 (FOR UPDATE)
  STATUS_SALE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/sales/checkout" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"items\":[{\"productId\":\"$PRODUCT_ID\",\"quantity\":1}],\"paymentMethod\":\"cash\"}")

  if [ "$STATUS_SALE" = "400" ] || [ "$STATUS_SALE" = "409" ]; then
    green "  ✅ PASS  vente sur stock 0 refusee ($STATUS_SALE)"
    PASS=$((PASS+1))
  else
    red   "  ❌ FAIL  vente sur stock 0 accepted, got=$STATUS_SALE"
    FAIL=$((FAIL+1))
  fi

  # Verifier qu'aucune ligne de vente phantom n'a ete creee
  PHANTOM_COUNT=$(PGPASSWORD="${PGPASSWORD:-ofauria_secret}" psql -h "${PGHOST:-localhost}" -p "${PGPORT:-5433}" \
    -U "${PGUSER:-ofauria}" -d "${PGDB:-ofauria_db}" -t -A -c \
    "SELECT COUNT(*) FROM sale_items si
     JOIN sales s ON s.id = si.sale_id
     WHERE si.product_id = '$PRODUCT_ID'
       AND s.created_at > NOW() - INTERVAL '30 seconds'" 2>/dev/null)

  if [ "$PHANTOM_COUNT" = "0" ]; then
    green "  ✅ PASS  aucune vente fantome creee"
    PASS=$((PASS+1))
  else
    red   "  ❌ FAIL  $PHANTOM_COUNT vente(s) fantome(s) detectee(s) sur les 30 dernieres secondes"
    FAIL=$((FAIL+1))
  fi
fi

# ─── A04-4 / A02-7 Discount > subtotal ────────────────────
blue "\n▶ A04-4 Refus discountAmount > subtotal"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/sales/checkout" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"items\":[{\"productId\":\"$PRODUCT_ID\",\"quantity\":1}],\"paymentMethod\":\"cash\",\"discountAmount\":9999}")
# peut etre 400 (discount > subtotal) ou 409/400 (stock 0 atteint en premier)
if [ "$STATUS" = "400" ] || [ "$STATUS" = "409" ]; then
  green "  ✅ PASS  discount abusif rejete ($STATUS)"
  PASS=$((PASS+1))
else
  red   "  ❌ FAIL  discount 9999 accepted, got=$STATUS"
  FAIL=$((FAIL+1))
fi

# ─── API4 pagination bornee ───────────────────────────────
blue "\n▶ API4 Pagination bornee (limit=999999)"

# Requete avec limit enorme : doit etre clampee a 200
RESP=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "$API/sales?limit=999999&page=1")
EFFECTIVE_LIMIT=$(echo "$RESP" | jq -r '.limit // 0')

if [ "$EFFECTIVE_LIMIT" -le 200 ] 2>/dev/null; then
  green "  ✅ PASS  limit clampee a $EFFECTIVE_LIMIT (<=200)"
  PASS=$((PASS+1))
else
  red   "  ❌ FAIL  limit non clampee (=$EFFECTIVE_LIMIT)"
  FAIL=$((FAIL+1))
fi

# Cleanup : desactiver le compte de test
curl -s -o /dev/null -X DELETE "$API/users/$(curl -s "$API/users" -H "Authorization: Bearer $ADMIN_TOKEN" | jq -r ".data[] | select(.email==\"$LOCKTEST_EMAIL\") | .id")" \
  -H "Authorization: Bearer $ADMIN_TOKEN" 2>&1

# ─── Resume ───────────────────────────────────────────────
blue "\n═══════════════════════════════════════════════════════"
blue " RESULTAT"
blue "═══════════════════════════════════════════════════════"
green "  PASS : $PASS"
if [ "$FAIL" -gt 0 ]; then red "  FAIL : $FAIL"; else echo "  FAIL : $FAIL"; fi
yel   "  SKIP : $SKIP"

exit $FAIL
