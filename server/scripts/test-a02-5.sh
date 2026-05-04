#!/usr/bin/env bash
# Tests OWASP A02-5 (JWT HttpOnly cookie) + A08 (CSRF Origin check)
set -u
API="${API:-http://localhost:3001/api/v1}"
ORIGIN="${ORIGIN:-http://localhost:5173}"
PASS=0
FAIL=0
JAR=$(mktemp)
trap "rm -f $JAR" EXIT

green() { printf "\033[0;32m%s\033[0m\n" "$*"; }
red()   { printf "\033[0;31m%s\033[0m\n" "$*"; }
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
blue " OWASP A02-5 + A08 — HttpOnly cookie + CSRF — tests"
blue "═══════════════════════════════════════════════════════"

# ─── Login pose un cookie HttpOnly + SameSite=Strict ──────
blue "\n▶ Login pose un cookie HttpOnly SameSite=Strict Secure(prod)"

RESP=$(curl -s -i -c "$JAR" -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d '{"email":"admin@ofauria.com","password":"admin123"}')

SETCOOKIE=$(echo "$RESP" | grep -i '^set-cookie:' | head -1)

if echo "$SETCOOKIE" | grep -qi 'ofauria_auth='; then
  green "  ✅ PASS  cookie 'ofauria_auth' present"
  PASS=$((PASS+1))
else
  red "  ❌ FAIL  pas de Set-Cookie ofauria_auth"
  FAIL=$((FAIL+1))
fi

if echo "$SETCOOKIE" | grep -qi 'HttpOnly'; then
  green "  ✅ PASS  flag HttpOnly"
  PASS=$((PASS+1))
else
  red "  ❌ FAIL  pas de HttpOnly"
  FAIL=$((FAIL+1))
fi

if echo "$SETCOOKIE" | grep -qi 'SameSite=Strict'; then
  green "  ✅ PASS  flag SameSite=Strict"
  PASS=$((PASS+1))
else
  red "  ❌ FAIL  pas de SameSite=Strict"
  FAIL=$((FAIL+1))
fi

# Verifier que la reponse contient encore le user (reponse sans headers)
BODY_USER=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" -H "Origin: $ORIGIN" \
  -d '{"email":"admin@ofauria.com","password":"admin123"}' | jq -r '.data.user.email // empty' 2>/dev/null)
assert_eq "reponse login contient user.email" "admin@ofauria.com" "$BODY_USER"

# ─── /auth/me fonctionne avec cookie seul (sans Bearer) ───
blue "\n▶ /auth/me accepte le cookie sans Bearer"

ME_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -b "$JAR" "$API/auth/me")
assert_eq "GET /auth/me via cookie (200)" "200" "$ME_STATUS"

# Sans cookie : 401
ME_NO_COOKIE=$(curl -s -o /dev/null -w "%{http_code}" "$API/auth/me")
assert_eq "GET /auth/me sans cookie (401)" "401" "$ME_NO_COOKIE"

# ─── Origin check CSRF ────────────────────────────────────
blue "\n▶ CSRF Origin check sur mutations"

# Refuser POST sans Origin
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -b "$JAR" -X POST "$API/auth/logout")
assert_eq "POST sans Origin refuse (403)" "403" "$STATUS"

# Refuser POST avec Origin etrangere
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -b "$JAR" -X POST \
  -H "Origin: https://evil.com" "$API/auth/logout")
assert_eq "POST Origin evil.com refuse (403)" "403" "$STATUS"

# Accepter POST avec bon Origin (on logout vraiment ici, donc re-login ensuite)
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -b "$JAR" -c "$JAR" -X POST \
  -H "Origin: $ORIGIN" "$API/auth/logout")
assert_eq "POST /logout avec bon Origin (200)" "200" "$STATUS"

# ─── Logout efface le cookie + revoque le token ───────────
blue "\n▶ Logout efface le cookie + revoque le jti"

# Re-login pour un nouveau cookie
curl -s -c "$JAR" -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d '{"email":"admin@ofauria.com","password":"admin123"}' > /dev/null

# Sauvegarde le cookie actuel
TOKEN_BEFORE=$(grep 'ofauria_auth' "$JAR" | awk '{print $NF}')

# Logout
curl -s -b "$JAR" -c "$JAR" -X POST -H "Origin: $ORIGIN" "$API/auth/logout" > /dev/null

# Le cookie est-il efface dans le jar ?
TOKEN_AFTER=$(grep 'ofauria_auth' "$JAR" | awk '{print $NF}' | head -1)
if [ -z "$TOKEN_AFTER" ] || [ "$TOKEN_AFTER" != "$TOKEN_BEFORE" ]; then
  green "  ✅ PASS  cookie efface ou change apres logout"
  PASS=$((PASS+1))
else
  red "  ❌ FAIL  cookie inchange apres logout"
  FAIL=$((FAIL+1))
fi

# Reutiliser le token revoque via Bearer header = 401 (blacklist jti)
if [ -n "$TOKEN_BEFORE" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $TOKEN_BEFORE" "$API/auth/me")
  assert_eq "token revoque via Bearer = 401" "401" "$STATUS"
fi

# ─── Backward compat : Bearer fonctionne encore ───────────
blue "\n▶ Backward compat : Bearer header toujours accepte"

# Login avec Bearer uniquement (pas de jar)
TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d '{"email":"admin@ofauria.com","password":"admin123"}' | jq -r '.data.token // empty')

if [ -n "$TOKEN" ] && [ "$TOKEN" != "null" ]; then
  green "  ✅ PASS  reponse login expose encore data.token (pour mobile/legacy)"
  PASS=$((PASS+1))
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $TOKEN" "$API/auth/me")
  assert_eq "Bearer header accepte par /auth/me (200)" "200" "$STATUS"
else
  red "  ❌ FAIL  plus de token dans reponse login"
  FAIL=$((FAIL+1))
fi

# ─── Resume ───────────────────────────────────────────────
blue "\n═══════════════════════════════════════════════════════"
blue " RESULTAT"
blue "═══════════════════════════════════════════════════════"
green "  PASS : $PASS"
if [ "$FAIL" -gt 0 ]; then red "  FAIL : $FAIL"; else echo "  FAIL : $FAIL"; fi

exit $FAIL
