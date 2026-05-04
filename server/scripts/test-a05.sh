#!/usr/bin/env bash
# Tests OWASP A05 Security Misconfiguration + A09 Logging — Ofauria
set -u
API="${API:-http://localhost:3001/api/v1}"
HOST="${HOST:-http://localhost:3001}"
PASS=0
FAIL=0
SKIP=0

green() { printf "\033[0;32m%s\033[0m\n" "$*"; }
red()   { printf "\033[0;31m%s\033[0m\n" "$*"; }
yel()   { printf "\033[0;33m%s\033[0m\n" "$*"; }
blue()  { printf "\033[0;34m%s\033[0m\n" "$*"; }

assert_header_present() {
  local label="$1" header="$2" headers="$3"
  if echo "$headers" | grep -qi "^$header:"; then
    green "  ✅ PASS  $label"
    PASS=$((PASS+1))
  else
    red   "  ❌ FAIL  $label (header '$header' manquant)"
    FAIL=$((FAIL+1))
  fi
}

assert_header_contains() {
  local label="$1" header="$2" needle="$3" headers="$4"
  local val
  val=$(echo "$headers" | grep -i "^$header:" | head -1)
  if echo "$val" | grep -qi "$needle"; then
    green "  ✅ PASS  $label"
    PASS=$((PASS+1))
  else
    red   "  ❌ FAIL  $label (attendu '$needle' dans '$header')"
    echo "       got: $val"
    FAIL=$((FAIL+1))
  fi
}

assert_header_absent() {
  local label="$1" header="$2" headers="$3"
  if echo "$headers" | grep -qi "^$header:"; then
    red   "  ❌ FAIL  $label (header '$header' ne devrait pas etre present)"
    FAIL=$((FAIL+1))
  else
    green "  ✅ PASS  $label"
    PASS=$((PASS+1))
  fi
}

blue "═══════════════════════════════════════════════════════"
blue " OWASP A05 — Security Misconfiguration — tests"
blue "═══════════════════════════════════════════════════════"

# ─── A05-4 Headers de securite ────────────────────────────
blue "\n▶ A05-4 Headers Helmet presents"

HEADERS=$(curl -s -I "$HOST/health" 2>&1)

assert_header_present   "CSP present"                           "content-security-policy" "$HEADERS"
assert_header_contains  "CSP frame-ancestors 'none'"           "content-security-policy" "frame-ancestors 'none'" "$HEADERS"
assert_header_contains  "CSP object-src 'none'"                "content-security-policy" "object-src 'none'" "$HEADERS"
assert_header_contains  "X-Content-Type-Options: nosniff"      "x-content-type-options"  "nosniff" "$HEADERS"
assert_header_contains  "X-Frame-Options: SAMEORIGIN ou DENY"  "x-frame-options"         "sameorigin\|deny" "$HEADERS"
assert_header_present   "Referrer-Policy"                       "referrer-policy"         "$HEADERS"
assert_header_absent    "X-Powered-By (fuite tech stack)"      "x-powered-by"            "$HEADERS"

# ─── A05-3 /uploads durcis ────────────────────────────────
blue "\n▶ A05-3 Static /uploads durcis"

# Creer un fichier HTML de test dans uploads si possible (via upload endpoint)
# Sinon, tester les headers sur un fichier existant ou inexistant
UPLOAD_HEADERS=$(curl -s -I "$HOST/uploads/nonexistent.png" 2>&1)

# Si 404, tester sur / (les headers statiques sont appliques quand meme sur match d'une ressource reelle)
# Tentons avec un fichier qui existe potentiellement
UPLOAD_404=$(curl -s -o /dev/null -w "%{http_code}" "$HOST/uploads/../../etc/passwd")
if [ "$UPLOAD_404" = "404" ] || [ "$UPLOAD_404" = "403" ]; then
  green "  ✅ PASS  path traversal sur /uploads rejete ($UPLOAD_404)"
  PASS=$((PASS+1))
else
  red   "  ❌ FAIL  path traversal got=$UPLOAD_404"
  FAIL=$((FAIL+1))
fi

# ─── A05-2 CORS ───────────────────────────────────────────
blue "\n▶ A05-2 CORS environnemental"

# Origine non autorisee -> pas d'Access-Control-Allow-Origin
ORIGIN_EVIL=$(curl -s -I -H "Origin: https://evil.com" "$HOST/health" 2>&1 | grep -i "^access-control-allow-origin:")
if [ -z "$ORIGIN_EVIL" ]; then
  green "  ✅ PASS  origine evil.com rejetee (pas d'ACAO)"
  PASS=$((PASS+1))
else
  # En pratique express renvoie une erreur 500, on verifie plutot que l'origin n'est pas reflechi
  if echo "$ORIGIN_EVIL" | grep -qi "evil.com"; then
    red "  ❌ FAIL  evil.com reflechie dans ACAO : $ORIGIN_EVIL"
    FAIL=$((FAIL+1))
  else
    green "  ✅ PASS  evil.com non reflechie"
    PASS=$((PASS+1))
  fi
fi

# Origine autorisee localhost:5173 (dev) -> ACAO match
ORIGIN_OK=$(curl -s -I -H "Origin: http://localhost:5173" "$HOST/health" 2>&1 | grep -i "^access-control-allow-origin:" | head -1)
if echo "$ORIGIN_OK" | grep -qi "localhost:5173"; then
  green "  ✅ PASS  origine localhost:5173 acceptee"
  PASS=$((PASS+1))
else
  red "  ❌ FAIL  localhost:5173 non acceptee : $ORIGIN_OK"
  FAIL=$((FAIL+1))
fi

# ─── A09 Stack trace pas exposee au client ────────────────
blue "\n▶ A09 Stack traces jamais exposees au client"

# Provoquer une 500 : impossible simplement, on teste une 404 et on regarde
# que le body n'a PAS de stack
RESP_404=$(curl -s "$HOST/api/v1/nonexistent-route")
if echo "$RESP_404" | grep -q "\.ts:\|at [A-Z][a-z]*\." ; then
  red "  ❌ FAIL  stack trace visible dans reponse 404:"
  echo "       $RESP_404" | head -c 200
  FAIL=$((FAIL+1))
else
  green "  ✅ PASS  pas de stack trace dans les reponses d'erreur"
  PASS=$((PASS+1))
fi

# ─── A09 Redaction headers sensibles ──────────────────────
blue "\n▶ A09 Redaction config verifiable"

# On ne peut pas verifier directement les logs (stdout du serveur)
# mais on peut verifier que le fichier logger.ts mentionne bien la redaction
LOGGER_FILE="$(cd "$(dirname "$0")/.." && pwd)/src/utils/logger.ts"
if [ -f "$LOGGER_FILE" ] && grep -q "redact" "$LOGGER_FILE" && grep -q "password" "$LOGGER_FILE" && grep -q "authorization" "$LOGGER_FILE"; then
  green "  ✅ PASS  logger.ts contient redaction passwords + Authorization"
  PASS=$((PASS+1))
else
  red "  ❌ FAIL  logger.ts ne contient pas la redaction attendue"
  FAIL=$((FAIL+1))
fi

# ─── Mobile : verif fichiers config ───────────────────────
blue "\n▶ MOB-1/2 Mobile hardening"

MOBILE_DIR="$(cd "$(dirname "$0")/../../mobile" && pwd)"

if [ -f "$MOBILE_DIR/capacitor.config.ts" ]; then
  if grep -q "androidScheme: 'https'" "$MOBILE_DIR/capacitor.config.ts"; then
    green "  ✅ PASS  capacitor.config.ts androidScheme=https"
    PASS=$((PASS+1))
  else
    red "  ❌ FAIL  androidScheme pas en https"
    FAIL=$((FAIL+1))
  fi

  if grep -q "cleartext: true" "$MOBILE_DIR/capacitor.config.ts"; then
    red "  ❌ FAIL  cleartext hardcode a true"
    FAIL=$((FAIL+1))
  else
    green "  ✅ PASS  cleartext pas hardcode a true"
    PASS=$((PASS+1))
  fi
fi

MANIFEST="$MOBILE_DIR/android/app/src/main/AndroidManifest.xml"
if [ -f "$MANIFEST" ]; then
  if grep -q 'android:usesCleartextTraffic="false"' "$MANIFEST"; then
    green "  ✅ PASS  AndroidManifest usesCleartextTraffic=false"
    PASS=$((PASS+1))
  else
    red "  ❌ FAIL  usesCleartextTraffic pas false"
    FAIL=$((FAIL+1))
  fi

  if grep -q 'android:allowBackup="false"' "$MANIFEST"; then
    green "  ✅ PASS  AndroidManifest allowBackup=false"
    PASS=$((PASS+1))
  else
    yel "  ⚠️  allowBackup pas explicitement false"
  fi
fi

GRADLE="$MOBILE_DIR/android/app/build.gradle"
if [ -f "$GRADLE" ]; then
  if grep -A5 "release {" "$GRADLE" | grep -q "debuggable false"; then
    green "  ✅ PASS  build.gradle release debuggable=false"
    PASS=$((PASS+1))
  else
    red "  ❌ FAIL  release n'a pas debuggable=false"
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
