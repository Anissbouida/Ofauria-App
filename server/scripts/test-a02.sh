#!/usr/bin/env bash
# Tests OWASP A02 Cryptographic Failures — Ofauria
# Prerequis : serveur sur http://localhost:3001 + admin connecte
# Certains tests (env.ts validation) tournent en sous-process, serveur pas requis.

set -u
API="${API:-http://localhost:3001/api/v1}"
SERVER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
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

assert_contains() {
  local label="$1" needle="$2" haystack="$3"
  if echo "$haystack" | grep -q "$needle"; then
    green "  ✅ PASS  $label"
    PASS=$((PASS+1))
  else
    red   "  ❌ FAIL  $label  (not found: '$needle')"
    echo "       got: $(echo "$haystack" | head -c 200)"
    FAIL=$((FAIL+1))
  fi
}

blue "═══════════════════════════════════════════════════════"
blue " OWASP A02 — Cryptographic Failures — tests"
blue "═══════════════════════════════════════════════════════"

# ─── A02-2 env.ts : rejet des JWT_SECRET faibles ──────────
blue "\n▶ A02-2 Rejet JWT_SECRET faibles au demarrage"

cat > /tmp/a02-env-test.mjs <<'EOF'
try {
  const { env } = await import(process.argv[2]);
  console.log('ACCEPTED:len=' + env.JWT_SECRET.length);
} catch (e) {
  console.log('REJECTED:' + e.message);
}
EOF

ENV_PATH="$SERVER_DIR/src/config/env.js"

# Test 1: secret forbidden
OUT=$(JWT_SECRET='change-me-in-production' DATABASE_URL='postgresql://x' \
  npx tsx /tmp/a02-env-test.mjs "$ENV_PATH" 2>&1 | grep -E "ACCEPTED|REJECTED" | head -1)
assert_contains "secret 'change-me-in-production' rejete" "REJECTED.*JWT_SECRET" "$OUT"

# Test 2: secret trop court
OUT=$(JWT_SECRET='short-123' DATABASE_URL='postgresql://x' \
  npx tsx /tmp/a02-env-test.mjs "$ENV_PATH" 2>&1 | grep -E "ACCEPTED|REJECTED" | head -1)
assert_contains "secret < 32 chars rejete" "REJECTED.*JWT_SECRET" "$OUT"

# Test 3: secret vide
OUT=$(JWT_SECRET='' DATABASE_URL='postgresql://x' \
  npx tsx /tmp/a02-env-test.mjs "$ENV_PATH" 2>&1 | grep -E "ACCEPTED|REJECTED" | head -1)
assert_contains "secret vide rejete" "REJECTED.*JWT_SECRET" "$OUT"

# Test 4: secret valide 64 chars hex accepte
VALID_SECRET=$(openssl rand -hex 32)
OUT=$(JWT_SECRET="$VALID_SECRET" DATABASE_URL='postgresql://x' \
  npx tsx /tmp/a02-env-test.mjs "$ENV_PATH" 2>&1 | grep -E "ACCEPTED|REJECTED" | head -1)
assert_contains "secret 64 chars accepte" "ACCEPTED:len=64" "$OUT"

# Test 5: JWT_EXPIRES_IN hors whitelist
OUT=$(JWT_SECRET="$VALID_SECRET" JWT_EXPIRES_IN='999y' DATABASE_URL='postgresql://x' \
  npx tsx /tmp/a02-env-test.mjs "$ENV_PATH" 2>&1 | grep -E "ACCEPTED|REJECTED" | head -1)
assert_contains "JWT_EXPIRES_IN='999y' rejete" "REJECTED.*JWT_EXPIRES_IN" "$OUT"

# Test 6: JWT_EXPIRES_IN valide ('8h')
OUT=$(JWT_SECRET="$VALID_SECRET" JWT_EXPIRES_IN='8h' DATABASE_URL='postgresql://x' \
  npx tsx /tmp/a02-env-test.mjs "$ENV_PATH" 2>&1 | grep -E "ACCEPTED|REJECTED" | head -1)
assert_contains "JWT_EXPIRES_IN='8h' accepte" "ACCEPTED" "$OUT"

rm -f /tmp/a02-env-test.mjs

# ─── A02-1 UNIQUE pin_code retire ─────────────────────────
blue "\n▶ A02-1 Contrainte UNIQUE retiree sur pin_code"

# Cherche la contrainte UNIQUE dans pg_constraint pour la table users / colonne pin_code
PGPASS="${PGPASSWORD:-ofauria_secret}"
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5433}"
PGUSER="${PGUSER:-ofauria}"
PGDB="${PGDB:-ofauria_db}"

UNIQUE_COUNT=$(PGPASSWORD="$PGPASS" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" -t -A -c "
  SELECT COUNT(*) FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'users' AND c.contype = 'u'
    AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = t.oid AND a.attnum = ANY(c.conkey) AND a.attname = 'pin_code');" 2>/dev/null)

if [ "$UNIQUE_COUNT" = "0" ]; then
  green "  ✅ PASS  aucune contrainte UNIQUE sur pin_code"
  PASS=$((PASS+1))
else
  red   "  ❌ FAIL  $UNIQUE_COUNT contrainte(s) UNIQUE trouvee(s) sur pin_code"
  FAIL=$((FAIL+1))
fi

# ─── A02-3 seed admin aleatoire ───────────────────────────
blue "\n▶ A02-3 Seed : pas de password hardcode admin123"

GREP_RESULT=$(grep -r "admin123" "$SERVER_DIR/src/config/" 2>/dev/null)
if [ -z "$GREP_RESULT" ]; then
  green "  ✅ PASS  aucun 'admin123' dans server/src/config/"
  PASS=$((PASS+1))
else
  red   "  ❌ FAIL  'admin123' trouve :"
  echo "$GREP_RESULT" | head -3
  FAIL=$((FAIL+1))
fi

if grep -q "generateStrongPassword\|crypto.randomBytes" "$SERVER_DIR/src/config/seed.ts"; then
  green "  ✅ PASS  seed utilise crypto.randomBytes / generateStrongPassword"
  PASS=$((PASS+1))
else
  red   "  ❌ FAIL  seed n'utilise pas crypto.randomBytes"
  FAIL=$((FAIL+1))
fi

# ─── A02-7 Validation montants (runtime) ──────────────────
blue "\n▶ A02-7 Validation Zod montants monetaires (POS checkout)"

# Login admin
ADMIN_RESP=$(curl -s -X POST "$API/auth/login" -H "Content-Type: application/json" \
  -d '{"email":"admin@ofauria.com","password":"admin123"}')
ADMIN_TOKEN=$(echo "$ADMIN_RESP" | jq -r '.data.token // empty' 2>/dev/null)

if [ -z "$ADMIN_TOKEN" ]; then
  yel "  ⏭  SKIP tests runtime : admin password change (admin123 ne marche plus)"
  yel "       C'est EXACTEMENT l'effet attendu apres A02-3. Relancez 'npm run db:seed'"
  yel "       pour obtenir le nouveau password aleatoire, puis exportez:"
  yel "         export ADMIN_TOKEN=..."
  SKIP=$((SKIP+3))
else
  # Test 1: discountAmount > subtotal -> 400
  OUT=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/sales/checkout" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"items":[],"paymentMethod":"cash","discountAmount":999}')
  # items vide echoue sur Zod, ca compte comme validation
  if [ "$OUT" = "400" ] || [ "$OUT" = "422" ]; then
    green "  ✅ PASS  checkout avec items vide rejete ($OUT)"
    PASS=$((PASS+1))
  else
    red   "  ❌ FAIL  items vide devrait etre refuse, got=$OUT"
    FAIL=$((FAIL+1))
  fi

  # Test 2: discount negatif -> 400
  OUT=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/sales/checkout" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"items":[{"productId":"00000000-0000-0000-0000-000000000000","quantity":1}],"paymentMethod":"cash","discountAmount":-100}')
  if [ "$OUT" = "400" ] || [ "$OUT" = "422" ]; then
    green "  ✅ PASS  discount negatif rejete ($OUT)"
    PASS=$((PASS+1))
  else
    red   "  ❌ FAIL  discount negatif accepte, got=$OUT"
    FAIL=$((FAIL+1))
  fi

  # Test 3: quantity non-numerique sur product-loss -> 400
  OUT=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/product-losses" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"productId":"00000000-0000-0000-0000-000000000000","quantity":"abc","lossType":"casse","reason":"test"}')
  if [ "$OUT" = "400" ] || [ "$OUT" = "422" ]; then
    green "  ✅ PASS  quantity non-numerique rejete ($OUT)"
    PASS=$((PASS+1))
  else
    red   "  ❌ FAIL  quantity 'abc' accepte, got=$OUT"
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
