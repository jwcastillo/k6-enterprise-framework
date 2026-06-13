#!/usr/bin/env bash
# T-073: test-summary.sh — Standalone summary regenerator
#
# Reads a JSON summary from a past execution and prints the formatted console output.
# Useful for re-displaying results or integrating into custom pipelines.
#
# Usage:
#   bin/testing/test-summary.sh reports/myapp/smoke-users/2026-02-17T235845/
#   bin/testing/test-summary.sh reports/myapp/smoke-users/2026-02-17T235845/summary.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# ── Colors ────────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
  BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BLUE=''; BOLD=''; RESET=''
fi

# ── Help ──────────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" || -z "${1:-}" ]]; then
  cat <<EOF

k6 Enterprise Framework — Test Summary Regenerator

USAGE:
  bin/testing/test-summary.sh <path>

ARGUMENTS:
  <path>   Path to a report directory or summary.json file

EXAMPLES:
  bin/testing/test-summary.sh reports/myapp/smoke-users/2026-02-17T235845/
  bin/testing/test-summary.sh reports/myapp/smoke-users/2026-02-17T235845/summary.json

EOF
  exit 0
fi

INPUT_PATH="$1"

# Resolve to summary.json
if [[ -d "$INPUT_PATH" ]]; then
  SUMMARY_FILE="${INPUT_PATH%/}/summary.json"
elif [[ -f "$INPUT_PATH" ]]; then
  SUMMARY_FILE="$INPUT_PATH"
else
  echo -e "${RED}[ERROR]${RESET} Path not found: $INPUT_PATH" >&2
  exit 1
fi

if [[ ! -f "$SUMMARY_FILE" ]]; then
  echo -e "${RED}[ERROR]${RESET} summary.json not found at: $SUMMARY_FILE" >&2
  exit 1
fi

# ── Print formatted summary ───────────────────────────────────────────────────
node -e "
const fs = require('fs');
const s = JSON.parse(fs.readFileSync('${SUMMARY_FILE}', 'utf8'));

const G = '\\x1b[32m', R = '\\x1b[31m', Y = '\\x1b[33m', B = '\\x1b[34m';
const BOLD = '\\x1b[1m', RESET = '\\x1b[0m';
const isTTY = process.stdout.isTTY;
const c = (code, txt) => isTTY ? code + txt + RESET : txt;

console.log('');
console.log(c(BOLD, '─────────────────────────────────────────────────'));
console.log(c(BOLD, ' k6 Test Execution Summary'));
console.log(c(BOLD, '─────────────────────────────────────────────────'));
console.log('  Client     : ' + (s.client || 'n/a'));
console.log('  Service    : ' + (s.service || 'n/a'));
console.log('  Profile    : ' + (s.profile || 'n/a'));
console.log('  Start      : ' + (s.startTime || 'n/a'));
console.log('  Duration   : ' + ((s.durationMs || 0) / 1000).toFixed(1) + 's');
console.log('');
console.log(c(BOLD, ' Metrics'));
if (s.httpDuration) {
  console.log('  P95 latency: ' + (s.httpDuration.p95 || 'n/a') + 'ms');
  console.log('  P99 latency: ' + (s.httpDuration.p99 || 'n/a') + 'ms');
  console.log('  Avg latency: ' + (s.httpDuration.avg || 'n/a') + 'ms');
}
if (s.httpFailedRate !== undefined)
  console.log('  Error rate : ' + (s.httpFailedRate * 100).toFixed(2) + '%');
if (s.httpRequestsTotal !== undefined)
  console.log('  Requests   : ' + s.httpRequestsTotal);
if (s.vus !== undefined)
  console.log('  VUs        : ' + s.vus);
console.log('');
const status = s.passed ? c(G, '[PASS]') : c(R, '[FAIL]');
console.log('  Result     : ' + status);
if (s.thresholdsPassed === false)
  console.log('  ' + c(Y, '[WARN]') + ' Thresholds failed');
console.log(c(BOLD, '─────────────────────────────────────────────────'));
console.log('');
"
