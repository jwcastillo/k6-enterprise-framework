#!/usr/bin/env bash
# bin/testing/gate-selftest.sh — proves that the quality gates fail when they must.
#
# A gate that never fails is worthless, and nothing else tests that end to end. This runs
# clients/_reference/scenarios/api/gate-selftest.ts against bin/mock-server.js three times
# and asserts:
#   1. healthy target         -> run-test.sh exits 0
#   2. 20% injected HTTP 500s -> run-test.sh exits 99 (thresholds crossed)
#   3. 300ms injected latency -> thresholds still pass, but auto-comparison flags the
#                                regression and escalates the run to exit 1
#
# Only talks to 127.0.0.1. Requires k6 on PATH.
# Usage: bash bin/testing/gate-selftest.sh
#
# ponytail: the LATAM original had a fourth case (an abortOnFail threshold stopping a
# collapsed run early). Here thresholds come from the scenario or the profile, so testing
# it would mean first building a way to inject abortOnFail from outside. Left out.

set -uo pipefail

PORT=38100
CLIENT=_reference
SCENARIO=api/gate-selftest
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARTIFACTS_DIR="${ROOT_DIR}/reports/${CLIENT}/${SCENARIO//\//_}"
MOCK_PID=""
FAILURES=0

cleanup() {
  [ -n "${MOCK_PID}" ] && kill "${MOCK_PID}" 2>/dev/null
}
trap cleanup EXIT

# start_mock <extra mock-server args...>
start_mock() {
  cleanup
  node "${ROOT_DIR}/bin/mock-server.js" --port="${PORT}" "$@" >/dev/null 2>&1 &
  MOCK_PID=$!
  for _ in $(seq 1 50); do
    # Any HTTP answer means the server is up (with --error-rate the probe may get a 500)
    curl -s -o /dev/null "http://127.0.0.1:${PORT}/health" && return 0
    sleep 0.2
  done
  echo "  Mock server did not start on port ${PORT}"
  exit 2
}

# run_test -> sets RUN_EXIT
run_test() {
  API_BASE_URL="http://127.0.0.1:${PORT}" \
  K6_RBAC_PERMISSIVE=true \
    bash "${ROOT_DIR}/bin/run-test.sh" \
      --client="${CLIENT}" \
      --scenario="${SCENARIO}" \
      --env=default \
      --profile=smoke \
      "$@" >/dev/null 2>&1
  RUN_EXIT=$?
}

newest_summary() {
  ls -t "${ARTIFACTS_DIR}"/summary-*.json 2>/dev/null | head -1
}

# expect <description> <actual> <expected>
expect() {
  if [ "$2" = "$3" ]; then
    echo "  [OK] $1"
  else
    echo "  [!!] $1 (expected: $3, got: $2)"
    FAILURES=$((FAILURES + 1))
  fi
}

command -v k6 >/dev/null || { echo "k6 not found on PATH"; exit 2; }
# A foreign listener on the port (e.g. an ssh tunnel) would silently answer instead of the mock
if (exec 3<>"/dev/tcp/127.0.0.1/${PORT}") 2>/dev/null; then
  echo "Port ${PORT} is already in use. Free it or change PORT here and in the scenario."
  exit 2
fi

echo "1/3 Healthy target: the gate must pass"
start_mock
run_test
expect "run-test.sh exits 0" "${RUN_EXIT}" "0"
HEALTHY_SUMMARY=$(newest_summary)

echo "2/3 20% injected errors: the gate must fail"
start_mock --error-rate=0.2
run_test --skip-build
expect "run-test.sh exits 99 (thresholds crossed)" "${RUN_EXIT}" "99"
# Keep the broken run out of the history step 3 compares against
BROKEN_SUMMARY=$(newest_summary)
[ -n "${BROKEN_SUMMARY}" ] && [ "${BROKEN_SUMMARY}" != "${HEALTHY_SUMMARY}" ] && rm -f "${BROKEN_SUMMARY}"

echo "3/3 300ms injected latency: thresholds pass, auto-comparison must flag the regression"
start_mock --latency=300
run_test --skip-build
expect "run-test.sh exits 1 (degradation escalated)" "${RUN_EXIT}" "1"
LATENCY_SUMMARY=$(newest_summary)
[ -n "${LATENCY_SUMMARY}" ] && [ "${LATENCY_SUMMARY}" != "${HEALTHY_SUMMARY}" ] && rm -f "${LATENCY_SUMMARY}"

echo ""
if [ "${FAILURES}" -gt 0 ]; then
  echo "Gate self-test: ${FAILURES} assertion(s) failed. The gates cannot be trusted."
  exit 1
fi
echo "Gate self-test passed: the gates pass when healthy and fail when they must."
