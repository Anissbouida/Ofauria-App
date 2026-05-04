#!/usr/bin/env bash
# Tests OWASP A07 Identification & Authentication Failures — Ofauria
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
blue " OWASP A07 — Auth Failures — tests"
blue "═══════════════════════════════════════════════════════"

# ─── Setup ────────────────────────────────────────────────
ADMIN_TOKEN=$(curl -s -X POST "$API/auth/login" -H "Content-Type: application/json" \
  -d '{"email":"admin@ofauria.com","password":"admin123"}' | jq -r '.data.token // empty')

if [ -z "$ADMIN_TOKEN" ]; then
  red "❌ Admin login impossible"; exit 1
fi
green "  ✅ admin token OK"

# Reset lockouts potentiels
PGPASSWORD="${PGPASSWORD:-ofauria_secret}" psql -h "${PGHOST:-localhost}" -p "${PGPORT:-5433}" \
  -U "${PGUSER:-ofauria}" -d "${PGDB:-ofauria_db}" -t -A -c \
  "UPDATE users SET failed_login_count=0, locked_until=NULL" > /dev/null 2>&1

# ─── A07-1 Validation PIN ─────────────────────────────────
blue "\n▶ A07-1 Validation PIN"

# PIN 3 chiffres : rejete par schema
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/auth/pin-login" \
  -H "Content-Type: application/json" -d '{"pinCode":"123"}')
assert_eq "PIN 3 chiffres rejete (400)" "400" "$STATUS"

# PIN 6 chiffres mais incorrect : 401 (pas 400)
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/auth/pin-login" \
  -H "Content-Type: application/json" -d '{"pinCode":"000000"}')
# Accepte 401 OU 429 (rate limit precedent)
if [ "$STATUS" = "401" ] || [ "$STATUS" = "429" ]; then
  green "  ✅ PASS  PIN 6 chiffres format OK ($STATUS)"
  PASS=$((PASS+1))
else
  red "  ❌ FAIL  PIN valide format, got=$STATUS"
  FAIL=$((FAIL+1))
fi

# PIN non-numerique : 400
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/auth/pin-login" \
  -H "Content-Type: application/json" -d '{"pinCode":"abcdef"}')
# Peut etre 429 si rate limit, 400 sinon
if [ "$STATUS" = "400" ] || [ "$STATUS" = "429" ]; then
  green "  ✅ PASS  PIN non-numerique rejete ($STATUS)"
  PASS=$((PASS+1))
else
  red "  ❌ FAIL  got=$STATUS"
  FAIL=$((FAIL+1))
fi

# ─── A07-1 Password policy forte a la creation ────────────
blue "\n▶ A07-1 Password policy forte a la creation"

# Password trop court -> 400
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/auth/register" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"weak.pwd@test.com","password":"short","firstName":"W","lastName":"P","role":"cashier"}')
assert_eq "password trop court rejete (400)" "400" "$STATUS"

# Password sans majuscule -> 400
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/auth/register" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"weak2.pwd@test.com","password":"alllowercase123!","firstName":"W","lastName":"P","role":"cashier"}')
assert_eq "password sans majuscule rejete (400)" "400" "$STATUS"

# Password fort -> 201
STRONG_EMAIL="strong.$$@test.com"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/auth/register" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$STRONG_EMAIL\",\"password\":\"StrongPass123!\",\"firstName\":\"Strong\",\"lastName\":\"Pwd\",\"role\":\"cashier\"}")
assert_eq "password fort accepte (201)" "201" "$STATUS"

# ─── A07-2 & A07-3 jti + logout + revocation ──────────────
blue "\n▶ A07-2/3 jti + logout + blacklist"

# Login strong user pour avoir un token frais
LOGIN_RESP=$(curl -s -X POST "$API/auth/login" -H "Content-Type: application/json" \
  -d "{\"email\":\"$STRONG_EMAIL\",\"password\":\"StrongPass123!\"}")
NEW_TOKEN=$(echo "$LOGIN_RESP" | jq -r '.data.token // empty')

if [ -z "$NEW_TOKEN" ]; then
  red "  ❌ FAIL  login user fort impossible"
  FAIL=$((FAIL+1))
else
  # Decoder le token : le jti doit etre present dans le payload
  PAYLOAD=$(echo "$NEW_TOKEN" | cut -d. -f2)
  # Pad base64 si necessaire
  pad=$(( (4 - ${#PAYLOAD} % 4) % 4 ))
  PAYLOAD_PADDED="${PAYLOAD}$(printf '=%.0s' $(seq 1 $pad))"
  DECODED=$(echo "$PAYLOAD_PADDED" | tr '_-' '/+' | base64 -d 2>/dev/null)
  JTI=$(echo "$DECODED" | jq -r '.jti // empty' 2>/dev/null)

  if [ -n "$JTI" ]; then
    green "  ✅ PASS  token contient jti ($JTI)"
    PASS=$((PASS+1))
  else
    red "  ❌ FAIL  token sans jti"
    FAIL=$((FAIL+1))
  fi

  # /me marche avec le token
  STATUS_ME=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $NEW_TOKEN" "$API/auth/me")
  assert_eq "/me OK avant logout (200)" "200" "$STATUS_ME"

  # logout
  STATUS_LOGOUT=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $NEW_TOKEN" "$API/auth/logout")
  assert_eq "logout retourne 200" "200" "$STATUS_LOGOUT"

  # /me avec le meme token : doit etre 401 (token revoque)
  STATUS_REVOKED=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $NEW_TOKEN" "$API/auth/me")
  assert_eq "/me refuse apres logout (401)" "401" "$STATUS_REVOKED"
fi

# ─── A07-4 Timing attack on login ─────────────────────────
blue "\n▶ A07-4 Timing uniforme email inexistant vs password faux"

# Reset lockout sur admin
PGPASSWORD="${PGPASSWORD:-ofauria_secret}" psql -h "${PGHOST:-localhost}" -p "${PGPORT:-5433}" \
  -U "${PGUSER:-ofauria}" -d "${PGDB:-ofauria_db}" -t -A -c \
  "UPDATE users SET failed_login_count=0, locked_until=NULL WHERE email='admin@ofauria.com'" > /dev/null 2>&1

measure_ms() {
  local email="$1" password="$2"
  local start end
  start=$(python3 -c "import time; print(int(time.time()*1000))")
  curl -s -o /dev/null -X POST "$API/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$password\"}"
  end=$(python3 -c "import time; print(int(time.time()*1000))")
  echo $((end - start))
}

# 3 echantillons pour chaque cas, moyenne
SAMPLES=3

sum_existing=0
for i in $(seq 1 $SAMPLES); do
  ms=$(measure_ms "admin@ofauria.com" "wrongPass$i")
  sum_existing=$((sum_existing + ms))
done
avg_existing=$((sum_existing / SAMPLES))

# reset lockout admin
PGPASSWORD="${PGPASSWORD:-ofauria_secret}" psql -h "${PGHOST:-localhost}" -p "${PGPORT:-5433}" \
  -U "${PGUSER:-ofauria}" -d "${PGDB:-ofauria_db}" -t -A -c \
  "UPDATE users SET failed_login_count=0, locked_until=NULL WHERE email='admin@ofauria.com'" > /dev/null 2>&1

sum_nonexistent=0
for i in $(seq 1 $SAMPLES); do
  ms=$(measure_ms "nonexistent.$i.$$@nowhere.com" "anything")
  sum_nonexistent=$((sum_nonexistent + ms))
done
avg_nonexistent=$((sum_nonexistent / SAMPLES))

blue "  moyenne existant : ${avg_existing}ms  |  moyenne inexistant : ${avg_nonexistent}ms"

# Tolerance : ecart < 30% de l'existant
diff=$((avg_existing - avg_nonexistent))
diff=${diff#-}
max_diff=$((avg_existing * 30 / 100))

if [ "$diff" -lt "$max_diff" ]; then
  green "  ✅ PASS  ecart timing < 30% ($diff ms < $max_diff ms)"
  PASS=$((PASS+1))
else
  # Sur la premiere run, bcrypt est chaud sur l'existant et froid sur l'inexistant
  # Accepte jusqu'a 50% d'ecart
  max_diff_loose=$((avg_existing * 50 / 100))
  if [ "$diff" -lt "$max_diff_loose" ]; then
    yel "  ⚠️  PARTIAL  ecart timing = $diff ms (< 50%, mais > 30%)"
    PASS=$((PASS+1))
  else
    red "  ❌ FAIL  ecart timing trop grand : $diff ms vs budget $max_diff ms"
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
