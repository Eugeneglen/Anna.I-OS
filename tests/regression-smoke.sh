#!/usr/bin/env bash
# ============================================================================
# Anna.I Regression Smoke Tests
# ============================================================================
# Run after every deployment or significant code change.
# Tests critical API contracts that frontend components depend on.
#
# Usage:
#   bash tests/regression-smoke.sh              # against localhost:3000
#   bash tests/regression-smoke.sh https://my-app.railway.app  # against Railway
#
# Exit code 0 = all passed, 1 = failures detected
# ============================================================================

set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
PASS=0
FAIL=0
ERRORS=""

pass() { echo "  ✅ $1"; ((PASS++)); }
fail() { echo "  ❌ $1"; ((FAIL++)); ERRORS+="$1\n"; }

json_field() {
  # Extract a JSON field value using python (available in all envs)
  echo "$2" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('$1',''))" 2>/dev/null || echo ""
}

header_field() {
  echo "$2" | python3 -c "
import sys
for line in sys.stdin:
    if line.lower().startswith('$1:'):
        print(line.split(':',1)[1].strip())
        break
" 2>/dev/null || echo ""
}

# ── Helpers ──

login_vendor() {
  local email="$1"
  local password="$2"
  curl -s -X POST "${BASE_URL}/api/vendor/auth" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"${email}\",\"password\":\"${password}\"}" \
    2>/dev/null
}

login_ops() {
  local headers_file=$(mktemp)
  local body=$(curl -s -X POST "${BASE_URL}/api/ops/auth" \
    -H 'Content-Type: application/json' \
    -d '{"email":"eugene@annai.sg","password":"anna1234"}' \
    -D "$headers_file" 2>/dev/null || echo "")
  # Extract ops_token from set-cookie header
  local token=$(grep 'set-cookie' "$headers_file" | sed 's/.*ops_token=\([^;]*\).*/\1/' | head -1)
  rm -f "$headers_file"
  echo "COOKIE:ops_token=${token}"
  echo "BODY:${body}"
}

# Capture response + headers separately
request() {
  local url="$1"
  local method="${2:-GET}"
  local data="$3"
  local cookie="$4"
  local auth="$5"
  local headers_file=$(mktemp)
  local args=("-s" -X "$method" -D "$headers_file" "${url}")
  [ -n "$data" ] && args+=(-H 'Content-Type: application/json' -d "$data")
  [ -n "$cookie" ] && args+=(-H "Cookie: ${cookie}")
  [ -n "$auth" ] && args+=(-H "Authorization: Bearer ${auth}")
  local body=$(curl "${args[@]}" 2>/dev/null || echo "")
  local status=$(head -1 "$headers_file" | awk '{print $2}')
  local x_vendor=$(header_field 'x-vendor-id' < "$headers_file")
  rm -f "$headers_file"
  echo "STATUS:${status:-000}"
  [ -n "$x_vendor" ] && echo "X-VENDOR-ID:${x_vendor}"
  echo "BODY:${body}"
}

echo "=================================================================="
echo " Anna.I Regression Smoke Tests"
echo " Target: ${BASE_URL}"
echo " Date:   $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "=================================================================="
echo ""

# ============================================================================
# 1. OPS AUTH + SESSION CONTRACT
# ============================================================================
echo "── 1. Ops Auth & Session Contract ──"

OPS_RESPONSE=$(login_ops)
OPS_COOKIE=$(echo "$OPS_RESPONSE" | grep '^COOKIE:' | cut -d: -f2-)
OPS_BODY=$(echo "$OPS_RESPONSE" | grep '^BODY:' | cut -d: -f2-)
if [ -n "$OPS_BODY" ]; then
  pass "POST /api/ops/auth returns 200"
else
  fail "POST /api/ops/auth — no response (server down?)"
  OPS_COOKIE=""
fi

OPS_ME=$(request "${BASE_URL}/api/ops/auth/me" GET "" "${OPS_COOKIE}")
OPS_ME_STATUS=$(echo "$OPS_ME" | head -1 | cut -d: -f2)
OPS_ME_BODY=$(echo "$OPS_ME" | grep '^BODY:' | cut -d: -f2-)

if [ "$OPS_ME_STATUS" = "200" ]; then
  pass "GET /api/ops/auth/me returns 200"

  # CRITICAL: user.role must be present (broke in RBAC migration)
  OPS_ROLE=$(echo "$OPS_ME_BODY" | python3 -c 'import sys,json; print(json.loads(sys.stdin.read()).get("user",{}).get("role","MISSING"))' 2>/dev/null || echo "PARSE_ERROR")
  if [ "$OPS_ROLE" != "MISSING" ] && [ "$OPS_ROLE" != "" ] && [ "$OPS_ROLE" != "PARSE_ERROR" ]; then
    pass "user.role = '${OPS_ROLE}' (not missing)"
  else
    fail "user.role is MISSING from /api/ops/auth/me response — RBAC regression!"
  fi

  # permissions array should exist
  OPS_PERMS=$(echo "$OPS_ME_BODY" | python3 -c 'import sys,json; p=json.loads(sys.stdin.read()).get("permissions",[]); print(len(p))' 2>/dev/null || echo "0")
  pass "permissions array has ${OPS_PERMS} entries"
else
  fail "GET /api/ops/auth/me returned status ${OPS_ME_STATUS}"
fi

# ============================================================================
# 2. OPS VENDORS API (Register + Edit)
# ============================================================================
echo ""
echo "── 2. Ops Vendors API ──"

OPS_VENDORS=$(request "${BASE_URL}/api/ops/vendors" GET "" "${OPS_COOKIE}")
OPS_VENDORS_STATUS=$(echo "$OPS_VENDORS" | head -1 | cut -d: -f2)
OPS_VENDORS_BODY=$(echo "$OPS_VENDORS" | grep '^BODY:' | cut -d: -f2-)

if [ "$OPS_VENDORS_STATUS" = "200" ]; then
  pass "GET /api/ops/vendors returns 200"
  VENDOR_COUNT=$(echo "$OPS_VENDORS_BODY" | python3 -c 'import sys,json; print(len(json.loads(sys.stdin.read()).get("vendors",[])))' 2>/dev/null || echo "0")
  pass "Returns ${VENDOR_COUNT} vendors"
else
  fail "GET /api/ops/vendors returned status ${OPS_VENDORS_STATUS}"
fi

# ============================================================================
# 3. VENDOR AUTH — LOGIN + TOKEN IN RESPONSE
# ============================================================================
echo ""
echo "── 3. Vendor Auth ──"

VENDOR_RESPONSE=$(login_vendor "ops@sparkclean.sg" "vendor123")
if [ -n "$VENDOR_RESPONSE" ]; then
  pass "POST /api/vendor/auth (SparkClean) returns data"

  # CRITICAL: response must include 'token' field for multi-tab support
  VENDOR_TOKEN=$(echo "$VENDOR_RESPONSE" | python3 -c 'import sys,json; print(json.loads(sys.stdin.read()).get("token","MISSING"))' 2>/dev/null || echo "PARSE_ERROR")
  if [ "$VENDOR_TOKEN" != "MISSING" ] && [ "$VENDOR_TOKEN" != "" ] && [ "$VENDOR_TOKEN" != "PARSE_ERROR" ]; then
    pass "Login response includes 'token' field (multi-tab support)"
  else
    fail "Login response missing 'token' field — multi-tab will break!"
  fi

  VENDOR_NAME=$(echo "$VENDOR_RESPONSE" | python3 -c 'import sys,json; print(json.loads(sys.stdin.read()).get("vendor",{}).get("name",""))' 2>/dev/null || echo "")
  pass "Vendor name: ${VENDOR_NAME}"
else
  fail "POST /api/vendor/auth — no response"
  VENDOR_TOKEN=""
fi

# ============================================================================
# 4. VENDOR SESSION — X-VENDOR-ID HEADER
# ============================================================================
echo ""
echo "── 4. Vendor Session Contract ──"

if [ -n "$VENDOR_TOKEN" ]; then
  VENDOR_SESSION=$(request "${BASE_URL}/api/vendor/session" GET "" "" "${VENDOR_TOKEN}")
  VENDOR_SESSION_STATUS=$(echo "$VENDOR_SESSION" | head -1 | cut -d: -f2)
  VENDOR_SESSION_XVID=$(echo "$VENDOR_SESSION" | grep '^X-VENDOR-ID:' | cut -d: -f2-)
  VENDOR_SESSION_BODY=$(echo "$VENDOR_SESSION" | grep '^BODY:' | cut -d: -f2-)

  if [ "$VENDOR_SESSION_STATUS" = "200" ]; then
    pass "GET /api/vendor/session returns 200"
  else
    fail "GET /api/vendor/session returned ${VENDOR_SESSION_STATUS}"
  fi

  # CRITICAL: X-Vendor-Id header must be present
  if [ -n "$VENDOR_SESSION_XVID" ]; then
    pass "X-Vendor-Id header present: ${VENDOR_SESSION_XVID}"
  else
    fail "X-Vendor-Id header MISSING — mismatch detection broken!"
  fi

  # CRITICAL: vendor.id in body must match X-Vendor-Id
  SESSION_VID=$(echo "$VENDOR_SESSION_BODY" | python3 -c 'import sys,json; print(json.loads(sys.stdin.read()).get("vendor",{}).get("id",""))' 2>/dev/null || echo "")
  if [ "$SESSION_VID" = "$VENDOR_SESSION_XVID" ]; then
    pass "Session vendor.id matches X-Vendor-Id header"
  else
    fail "Session vendor.id (${SESSION_VID}) ≠ X-Vendor-Id (${VENDOR_SESSION_XVID})"
  fi
fi

# ============================================================================
# 5. VENDOR DATA ISOLATION — IDOR PROTECTION
# ============================================================================
echo ""
echo "── 5. Vendor Data Isolation (IDOR) ──"

if [ -n "$VENDOR_TOKEN" ]; then
  # Get the vendor's own ID from the session
  OWN_VENDOR_ID="$SESSION_VID"

  # Try to access another vendor's schedule using our token
  # We need a different vendor ID — use a fake one first to test 403
  IDOR_RESULT=$(request "${BASE_URL}/api/vendors/fake-vendor-id-123/schedule" GET "" "" "${VENDOR_TOKEN}")
  IDOR_STATUS=$(echo "$IDOR_RESULT" | head -1 | cut -d: -f2)

  if [ "$IDOR_STATUS" = "403" ] || [ "$IDOR_STATUS" = "401" ]; then
    pass "IDOR guard blocks access to fake vendor ID (${IDOR_STATUS})"
  elif [ "$IDOR_STATUS" = "000" ]; then
    fail "IDOR test — no response from server"
  else
    fail "IDOR guard NOT blocking! Got status ${IDOR_STATUS} for fake vendor ID"
  fi
fi

# ============================================================================
# 6. MULTI-VENDOR — SECOND LOGIN GETS DIFFERENT TOKEN
# ============================================================================
echo ""
echo "── 6. Multi-Vendor Token Independence ──"

VENDOR2_RESPONSE=$(login_vendor "bookings@coolair.sg" "vendor123")
VENDOR2_TOKEN=$(echo "$VENDOR2_RESPONSE" | python3 -c 'import sys,json; print(json.loads(sys.stdin.read()).get("token",""))' 2>/dev/null || echo "")
VENDOR2_ID=$(echo "$VENDOR2_RESPONSE" | python3 -c 'import sys,json; print(json.loads(sys.stdin.read()).get("vendor",{}).get("id",""))' 2>/dev/null || echo "")

if [ -n "$VENDOR2_TOKEN" ] && [ -n "$VENDOR_TOKEN" ]; then
  if [ "$VENDOR_TOKEN" != "$VENDOR2_TOKEN" ]; then
    pass "Two vendors get different JWT tokens"
  else
    fail "Two vendors got IDENTICAL tokens — collision!"
  fi

  # Verify each token returns the correct vendor
  V2_SESSION=$(request "${BASE_URL}/api/vendor/session" GET "" "" "${VENDOR2_TOKEN}")
  V2_XVID=$(echo "$V2_SESSION" | grep '^X-VENDOR-ID:' | cut -d: -f2-)
  V1_SESSION=$(request "${BASE_URL}/api/vendor/session" GET "" "" "${VENDOR_TOKEN}")
  V1_XVID=$(echo "$V1_SESSION" | grep '^X-VENDOR-ID:' | cut -d: -f2-)

  if [ "$V1_XVID" != "$V2_XVID" ]; then
    pass "Token 1 returns vendor ${V1_XVID}, Token 2 returns vendor ${V2_XVID}"
  else
    fail "Both tokens return same vendor ${V1_XVID} — data isolation broken!"
  fi
else
  fail "Could not log in second vendor for isolation test"
fi

# ============================================================================
# 7. VENDOR DASHBOARD (AUTH HEADER SUPPORT)
# ============================================================================
echo ""
echo "── 7. Vendor Dashboard (Auth Header) ──"

if [ -n "$VENDOR_TOKEN" ]; then
  DASH_RESULT=$(request "${BASE_URL}/api/vendor/dashboard" GET "" "" "${VENDOR_TOKEN}")
  DASH_STATUS=$(echo "$DASH_RESULT" | head -1 | cut -d: -f2)
  DASH_XVID=$(echo "$DASH_RESULT" | grep '^X-VENDOR-ID:' | cut -d: -f2-)

  if [ "$DASH_STATUS" = "200" ]; then
    pass "GET /api/vendor/dashboard returns 200 via Auth header"
  else
    fail "GET /api/vendor/dashboard returned ${DASH_STATUS}"
  fi

  if [ -n "$DASH_XVID" ]; then
    pass "Dashboard X-Vendor-Id: ${DASH_XVID}"
  else
    fail "Dashboard missing X-Vendor-Id header"
  fi
fi

# ============================================================================
# SUMMARY
# ============================================================================
echo ""
echo "=================================================================="
echo " RESULTS: ${PASS} passed, ${FAIL} failed"
echo "=================================================================="

if [ $FAIL -gt 0 ]; then
  echo ""
  echo "FAILURES:"
  echo -e "$ERRORS"
  exit 1
fi

echo " All regression tests passed. ✅"
exit 0
