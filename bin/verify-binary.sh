#!/usr/bin/env bash
# verify-binary.sh — Verify self-contained binary integrity (T-035)
#
# Checks:
#   1. Source code patterns not exposed (no TS/JS exports, no type declarations)
#   2. No secrets or credentials embedded
#   3. No internal endpoints hardcoded
#   4. Embedded scripts are present and accessible via list-scripts
#   5. Cross-client data isolation
#
# Usage:
#   ./bin/verify-binary.sh --binary dist/binaries/examples/linux_amd64/k6-examples
#   ./bin/verify-binary.sh --binary ./k6-examples --verbose

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'

BINARY=""
VERBOSE="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --binary)   BINARY="$2";      shift 2 ;;
    --verbose)  VERBOSE="true";   shift   ;;
    --binary=*) BINARY="${1#--binary=}"; shift ;;
    --help|-h)
      echo "Usage: ./bin/verify-binary.sh --binary <path> [--verbose]"
      exit 0 ;;
    *) shift ;;
  esac
done

if [[ -z "${BINARY}" || ! -f "${BINARY}" ]]; then
  echo -e "${RED}[ERROR]${RESET} Binary path required and must exist. Use --binary <path>"
  exit 1
fi

echo -e "${BOLD}Source Protection Verification${RESET}"
echo -e "Binary: ${BINARY}"
BINARY_SIZE=$(du -sh "${BINARY}" | cut -f1)
echo -e "Size:   ${BINARY_SIZE}"
echo ""

PASS=0; FAIL=0; WARN=0

check_pass() { echo -e "  ${GREEN}✓${RESET} $*"; PASS=$((PASS+1)); }
check_fail() { echo -e "  ${RED}✗${RESET} $*"; FAIL=$((FAIL+1)); }
check_warn() { echo -e "  ${YELLOW}!${RESET} $*"; WARN=$((WARN+1)); }

# binary_grep: search for a pattern directly in the binary file.
# Uses grep in binary mode (-a treats binary as text), which streams the file
# without loading it fully into memory — much faster than `strings` on macOS.
binary_grep() {
  grep -ao "${1}" "${BINARY}" 2>/dev/null | head -20 || true
}
binary_grep_q() {
  grep -qaP "${1}" "${BINARY}" 2>/dev/null || grep -qa "${1}" "${BINARY}" 2>/dev/null || false
}

# binary_strings: extract printable ASCII strings (length >= 6) from the binary.
# Streamed via dd+tr to avoid loading the entire file into memory on macOS.
binary_strings() {
  # Use grep -ao to extract runs of printable ASCII — streams file without buffering all output
  grep -ao '[[:print:]]\{6,\}' "${BINARY}" 2>/dev/null | head -200000 || true
}

# ── 1. Embedded scripts present ───────────────────────────────────────────────
echo -e "${BOLD}1. Embedded scripts${RESET}"

# Check binary responds to list-scripts (only if same arch)
HOST_OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
HOST_ARCH="$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')"
FILE_OUTPUT=$(file "${BINARY}" 2>/dev/null || true)

IS_NATIVE=false
if echo "${FILE_OUTPUT}" | grep -qi "${HOST_OS}\|Mach-O\|ELF" 2>/dev/null; then
  # More precise: check arch matches
  if [[ "${HOST_OS}" == "darwin" ]] && echo "${FILE_OUTPUT}" | grep -qi "Mach-O"; then
    IS_NATIVE=true
  elif [[ "${HOST_OS}" == "linux" ]] && echo "${FILE_OUTPUT}" | grep -qi "ELF"; then
    IS_NATIVE=true
  fi
fi

if [[ "${IS_NATIVE}" == "true" ]]; then
  LIST_OUTPUT=$("${BINARY}" list-scripts 2>&1 || true)
  if echo "${LIST_OUTPUT}" | grep -q "embedded://"; then
    SCRIPT_COUNT=$(echo "${LIST_OUTPUT}" | grep -c "embedded://" || true)
    check_pass "list-scripts: ${SCRIPT_COUNT} embedded scripts accessible"
    if [[ "${VERBOSE}" == "true" ]]; then
      echo "${LIST_OUTPUT}" | grep "embedded://" | sed 's/^/      /'
    fi
  else
    check_fail "list-scripts returned no embedded:// entries (output: ${LIST_OUTPUT:0:100})"
  fi

  # Verify binary responds to version
  VERSION_OUTPUT=$("${BINARY}" version 2>&1 </dev/null || true)
  if echo "${VERSION_OUTPUT}" | grep -qE 'k6.* v[0-9]'; then
    K6_VER=$(echo "${VERSION_OUTPUT}" | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -1)
    check_pass "Binary identifies as k6 ${K6_VER}"
  else
    check_fail "Binary does not respond to 'version' as k6"
  fi
else
  # Cross-compiled: verify via strings that go:embed data is present
  if binary_strings | grep -q "embedded://\|k6-embedded\|scripts/"; then
    check_pass "Embedded script paths found in binary strings (cross-compiled)"
  else
    check_warn "Could not confirm embedded scripts (cross-compiled, no strings match)"
  fi
fi

# ── 2. Source code patterns not exposed ───────────────────────────────────────
echo -e "\n${BOLD}2. Source code exposure${RESET}"

BSTRINGS="$(binary_strings)"

if echo "${BSTRINGS}" | grep -qE '(^export function |^export class |^export const |^import \{ )'; then
  check_fail "Found TypeScript/JS export/import patterns in binary"
else
  check_pass "No export/import source patterns found"
fi

if echo "${BSTRINGS}" | grep -qE '(interface [A-Z][a-zA-Z]+ \{|type [A-Z][a-zA-Z]+ =|\.d\.ts)'; then
  check_fail "Found TypeScript type declarations in binary"
else
  check_pass "No TypeScript type declarations found"
fi

if echo "${BSTRINGS}" | grep -qE '(// T-[0-9]{3}:|/\*\*\s*\n|\* @param |\* @returns )'; then
  check_warn "Found JSDoc/source comments (may be from Go runtime, verify manually)"
else
  check_pass "No JSDoc source comments found"
fi

# ── 3. Secrets and credentials ────────────────────────────────────────────────
echo -e "\n${BOLD}3. Secret/credential scan${RESET}"

if echo "${BSTRINGS}" | grep -qiE '(api[_-]?key\s*[:=]\s*["\x27][a-zA-Z0-9]{16,}|bearer [a-zA-Z0-9._-]{20,}|password\s*[:=]\s*["\x27][^$\{])'; then
  check_fail "Found potential hardcoded secrets/API keys in binary"
else
  check_pass "No hardcoded secrets detected"
fi

if echo "${BSTRINGS}" | grep -qE '(K6_SECRET_[A-Z]+=[^$]|VAULT_TOKEN=[^$]|AWS_SECRET_ACCESS_KEY=[^$])'; then
  check_fail "Found resolved secret environment variables in binary"
else
  check_pass "No resolved secret environment variables found"
fi

# ── 4. Internal endpoints ─────────────────────────────────────────────────────
echo -e "\n${BOLD}4. Internal endpoint scan${RESET}"

# k6's own localhost:6565 (API server) is expected — exclude it
INTERNAL=$(echo "${BSTRINGS}" | \
  grep -E '(127\.0\.0\.1:[0-9]{4,5}|internal\.[a-z]+\.[a-z]+|\.local:[0-9]+)' | \
  grep -v "localhost:6565\|127.0.0.1:6565" || true)

if [[ -n "${INTERNAL}" ]]; then
  check_warn "Found internal endpoint references (verify these are expected):"
  echo "${INTERNAL}" | head -5 | sed 's/^/      /'
else
  check_pass "No unexpected internal endpoints detected"
fi

# ── 5. Cross-client isolation ─────────────────────────────────────────────────
echo -e "\n${BOLD}5. Cross-client isolation${RESET}"

CLIENT_REFS=$(echo "${BSTRINGS}" | grep -cE 'clients/[a-zA-Z0-9_-]+/' || true)
if [[ "${CLIENT_REFS}" -le 5 ]]; then
  check_pass "Minimal client directory references (${CLIENT_REFS})"
else
  check_warn "Found ${CLIENT_REFS} client directory path references — verify only target client is included"
fi

# Binary name should hint at client (k6-{client})
BINARY_BASENAME=$(basename "${BINARY}")
if [[ "${BINARY_BASENAME}" == k6-* ]]; then
  DERIVED_CLIENT="${BINARY_BASENAME#k6-}"
  OTHER_CLIENTS=$(echo "${BSTRINGS}" | \
    grep -E 'clients/[a-zA-Z0-9_-]+/' | \
    grep -v "clients/${DERIVED_CLIENT}\|clients/_" | \
    grep -v "node_modules" | head -3 || true)
  if [[ -n "${OTHER_CLIENTS}" ]]; then
    check_warn "Found references to other client directories:"
    echo "${OTHER_CLIENTS}" | sed 's/^/      /'
  else
    check_pass "No other client directory references found"
  fi
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Verification Summary${RESET}"
echo -e "  Passed:   ${GREEN}${PASS}${RESET}"
echo -e "  Warnings: ${YELLOW}${WARN}${RESET}"
echo -e "  Failed:   ${RED}${FAIL}${RESET}"
echo ""

if [[ "${FAIL}" -gt 0 ]]; then
  echo -e "${RED}${BOLD}VERIFICATION FAILED${RESET} — ${FAIL} check(s) did not pass"
  exit 1
else
  echo -e "${GREEN}${BOLD}VERIFICATION PASSED${RESET}"
  exit 0
fi
