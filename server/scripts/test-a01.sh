#!/usr/bin/env bash
# Tests OWASP A01 Broken Access Control — Ofauria
# Prerequis : serveur sur http://localhost:3001 + seed avec admin@ofauria.com / admin123

set -u
API="${API:-http://localhost:3001/api/v1}"
PASS=0
FAIL=0
SKIP=0

green() { printf "\033[0;32m%s\033[0m\n" "$*"; }
red()   { printf "\033[0;31m%s\033[0m\n" "$*"; }
yel()   { printf "\033[0;33m%s\033[0m\n" "$*"; }
blue()  { printf "\033[0;34m%s\033[0m\n" "$*"; }

assert_status() {
  local label="$1" expected="$2" actual="$3" body="${4:-}"
  if [ "$actual" = "$expected" ]; then
    green "  ✅ PASS  $label  (status=$actual)"
    PASS=$((PASS+1))
  else
    red   "  ❌ FAIL  $label  (expected=$expected, got=$actual)"
    [ -n "$body" ] && echo "       body: $(echo "$body" | head -c 200)"
    FAIL=$((FAIL+1))
  fi
}

call() {
  # call METHOD URL TOKEN [BODY] -> prints "STATUS\nBODY"
  local method="$1" url="$2" token="${3:-}" body="${4:-}"
  local args=(-s -w "\n%{http_code}" -X "$method" "$url")
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  if [ -n "$body" ]; then
    args+=(-H "Content-Type: application/json" -d "$body")
  fi
  curl "${args[@]}"
}

blue "═══════════════════════════════════════════════════════"
blue " OWASP A01 — Broken Access Control — tests"
blue "═══════════════════════════════════════════════════════"

# ─── Setup ────────────────────────────────────────────────
blue "\n[setup] Login admin"
ADMIN_RESP=$(curl -s -X POST "$API/auth/login" -H "Content-Type: application/json" \
  -d '{"email":"admin@ofauria.com","password":"admin123"}')
ADMIN_TOKEN=$(echo "$ADMIN_RESP" | jq -r '.data.token // empty')

if [ -z "$ADMIN_TOKEN" ]; then
  red "❌ Impossible de se connecter en admin. Reponse :"
  echo "$ADMIN_RESP"
  exit 1
fi
green "  ✅ Admin token obtenu"

# Stores disponibles
STORES_JSON=$(curl -s "$API/stores" -H "Authorization: Bearer $ADMIN_TOKEN")
STORE_A_ID=$(echo "$STORES_JSON" | jq -r '.data[0].id // empty')
STORE_B_ID=$(echo "$STORES_JSON" | jq -r '.data[1].id // empty')

if [ -z "$STORE_A_ID" ]; then
  yel "  ⚠️  Aucun store trouve — les tests multi-tenant seront limites"
else
  green "  ✅ Store A: $STORE_A_ID"
  [ -n "$STORE_B_ID" ] && green "  ✅ Store B: $STORE_B_ID" || yel "  ⚠️  Un seul store disponible"
fi

# Creer / reutiliser les users de test
create_or_get_user() {
  local email="$1" firstName="$2" role="$3"
  local existing
  existing=$(curl -s "$API/users" -H "Authorization: Bearer $ADMIN_TOKEN" \
    | jq -r ".data[] | select(.email==\"$email\") | .id" | head -1)
  if [ -n "$existing" ]; then
    echo "$existing"
    return
  fi
  local resp
  resp=$(curl -s -X POST "$API/auth/register" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"TestPass123!\",\"firstName\":\"$firstName\",\"lastName\":\"Test\",\"role\":\"$role\"}")
  echo "$resp" | jq -r '.data.id // empty'
}

assign_store() {
  local user_id="$1" store_id="$2"
  curl -s -o /dev/null -X PUT "$API/users/$user_id" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"storeId\":\"$store_id\"}"
}

login_user() {
  local email="$1"
  curl -s -X POST "$API/auth/login" -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"TestPass123!\"}" | jq -r '.data.token // empty'
}

blue "\n[setup] Creation / recuperation des users de test"
CASHIER_A_ID=$(create_or_get_user "cashier.a@test.com" "CashierA" "cashier")
CASHIER_B_ID=$(create_or_get_user "cashier.b@test.com" "CashierB" "cashier")
ORPHAN_ID=$(create_or_get_user "orphan.cashier@test.com" "Orphan"   "cashier")

if [ -z "$CASHIER_A_ID" ] || [ -z "$CASHIER_B_ID" ] || [ -z "$ORPHAN_ID" ]; then
  red "❌ Echec creation users. CASHIER_A_ID=$CASHIER_A_ID CASHIER_B_ID=$CASHIER_B_ID ORPHAN_ID=$ORPHAN_ID"
  exit 1
fi

green "  ✅ cashier A: $CASHIER_A_ID"
green "  ✅ cashier B: $CASHIER_B_ID"
green "  ✅ orphan  :  $ORPHAN_ID"

if [ -n "$STORE_A_ID" ]; then
  assign_store "$CASHIER_A_ID" "$STORE_A_ID"
  assign_store "$CASHIER_B_ID" "$STORE_A_ID"
fi

CASHIER_A_TOKEN=$(login_user "cashier.a@test.com")
CASHIER_B_TOKEN=$(login_user "cashier.b@test.com")
ORPHAN_TOKEN=$(login_user   "orphan.cashier@test.com")

[ -z "$CASHIER_A_TOKEN" ] && { red "❌ Login cashier A impossible"; exit 1; }
[ -z "$CASHIER_B_TOKEN" ] && { red "❌ Login cashier B impossible"; exit 1; }
[ -z "$ORPHAN_TOKEN"    ] && { red "❌ Login orphan impossible";    exit 1; }
green "  ✅ Tokens obtenus"

# ─── A01-1 Mass assignment ────────────────────────────────
blue "\n▶ A01-1 Mass assignment (cashier -> admin escalation)"

OUT=$(call PUT "$API/users/$CASHIER_A_ID" "$CASHIER_A_TOKEN" '{"role":"admin"}')
STATUS=$(echo "$OUT" | tail -n1); BODY=$(echo "$OUT" | sed '$d')
assert_status "cashier ne peut pas s'auto-promouvoir admin" "403" "$STATUS" "$BODY"

if [ -n "$STORE_B_ID" ]; then
  OUT=$(call PUT "$API/users/$CASHIER_A_ID" "$CASHIER_A_TOKEN" "{\"storeId\":\"$STORE_B_ID\"}")
  STATUS=$(echo "$OUT" | tail -n1); BODY=$(echo "$OUT" | sed '$d')
  assert_status "cashier ne peut pas changer son storeId" "403" "$STATUS" "$BODY"
else
  yel "  ⏭  SKIP changement storeId (un seul store)"
  SKIP=$((SKIP+1))
fi

# ─── A01-3 IDOR cash-register ─────────────────────────────
blue "\n▶ A01-3 IDOR cash-register (cashier A lit session cashier B)"

# Fermer d'eventuelles sessions ouvertes, sinon 'open' retourne 400
curl -s -X POST "$API/cash-register/close" -H "Authorization: Bearer $CASHIER_A_TOKEN" \
  -H "Content-Type: application/json" -d '{}' > /dev/null
curl -s -X POST "$API/cash-register/close" -H "Authorization: Bearer $CASHIER_B_TOKEN" \
  -H "Content-Type: application/json" -d '{}' > /dev/null

OUT_A=$(call POST "$API/cash-register/open" "$CASHIER_A_TOKEN" '{"openingAmount":100}')
SESSION_A=$(echo "$OUT_A" | sed '$d' | jq -r '.data.id // empty')
OUT_B=$(call POST "$API/cash-register/open" "$CASHIER_B_TOKEN" '{"openingAmount":50}')
SESSION_B=$(echo "$OUT_B" | sed '$d' | jq -r '.data.id // empty')

if [ -z "$SESSION_A" ] || [ -z "$SESSION_B" ]; then
  yel "  ⚠️  Impossible d'ouvrir les sessions (SESSION_A=$SESSION_A SESSION_B=$SESSION_B)"
  echo "  A resp: $(echo "$OUT_A" | sed '$d' | head -c 200)"
  echo "  B resp: $(echo "$OUT_B" | sed '$d' | head -c 200)"
  SKIP=$((SKIP+2))
else
  green "  ✅ Session A: $SESSION_A"
  green "  ✅ Session B: $SESSION_B"

  OUT=$(call GET "$API/cash-register/$SESSION_B" "$CASHIER_A_TOKEN")
  STATUS=$(echo "$OUT" | tail -n1); BODY=$(echo "$OUT" | sed '$d')
  assert_status "cashier A bloque sur session cashier B" "403" "$STATUS" "$BODY"

  OUT=$(call GET "$API/cash-register/$SESSION_A" "$CASHIER_A_TOKEN")
  STATUS=$(echo "$OUT" | tail -n1); BODY=$(echo "$OUT" | sed '$d')
  assert_status "cashier A peut lire sa propre session" "200" "$STATUS" "$BODY"
fi

# ─── A01-4 storeId:null non-admin ─────────────────────────
blue "\n▶ A01-4 Politique storeId null non-admin (orphan -> /sales)"

OUT=$(call GET "$API/sales" "$ORPHAN_TOKEN")
STATUS=$(echo "$OUT" | tail -n1); BODY=$(echo "$OUT" | sed '$d')
assert_status "orphan cashier bloque sur /sales" "403" "$STATUS" "$BODY"

# Check admin OK
OUT=$(call GET "$API/sales" "$ADMIN_TOKEN")
STATUS=$(echo "$OUT" | tail -n1)
assert_status "admin peut lister les ventes" "200" "$STATUS"

# ─── A01-5 Rate limit ─────────────────────────────────────
blue "\n▶ A01-5 Rate limit sur /customers/:id/stats (35 req en parallel, limite=30/min)"

# Obtenir un customer_id existant
CUSTOMER_ID=$(curl -s "$API/customers" -H "Authorization: Bearer $ADMIN_TOKEN" | jq -r '.data[0].id // empty')

if [ -z "$CUSTOMER_ID" ]; then
  yel "  ⏭  SKIP : aucun client en base, impossible de tester /customers/:id/stats"
  SKIP=$((SKIP+1))
else
  # 35 appels en parallele
  TMP_RESULTS=$(mktemp)
  for i in $(seq 1 35); do
    (
      STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
        -H "Authorization: Bearer $ADMIN_TOKEN" \
        "$API/customers/$CUSTOMER_ID/stats")
      echo "$STATUS" >> "$TMP_RESULTS"
    ) &
  done
  wait

  COUNT_200=$(grep -c "^200$" "$TMP_RESULTS" || echo 0)
  COUNT_429=$(grep -c "^429$" "$TMP_RESULTS" || echo 0)
  COUNT_OTHER=$(($(wc -l < "$TMP_RESULTS") - COUNT_200 - COUNT_429))
  rm -f "$TMP_RESULTS"

  blue "  200: $COUNT_200  |  429: $COUNT_429  |  autres: $COUNT_OTHER"

  if [ "$COUNT_429" -gt 0 ]; then
    green "  ✅ PASS  rate limit actif (429 observes)"
    PASS=$((PASS+1))
  else
    red   "  ❌ FAIL  rate limit inactif (aucun 429 sur 35 requetes)"
    FAIL=$((FAIL+1))
  fi
fi

# ─── Resume ───────────────────────────────────────────────
blue "\n═══════════════════════════════════════════════════════"
blue " RESULTAT"
blue "═══════════════════════════════════════════════════════"
green "  PASS : $PASS"
if [ "$FAIL" -gt 0 ]; then red "  FAIL : $FAIL"; else echo "  FAIL : $FAIL"; fi
yel   "  SKIP : $SKIP"

exit $FAIL
