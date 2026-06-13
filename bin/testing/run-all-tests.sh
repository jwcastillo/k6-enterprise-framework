#!/usr/bin/env bash
# run-all-tests.sh — Batch test executor
#
# T-055: Runs all tests for a client sequentially or via parallel runner.
# T-170 (Phase 8): Real-time batch progress display, consolidated summary table,
#   human-readable artifact names, clear pass/fail per test.
#
# Usage:
#   bin/testing/run-all-tests.sh --client=myapp
#   bin/testing/run-all-tests.sh --client=myapp --profile=load --env=staging
#   bin/testing/run-all-tests.sh --client=myapp --parallel --concurrency=4
#   bin/testing/run-all-tests.sh --client=myapp --pattern="api/*.ts"

set -euo pipefail
shopt -s extglob 2>/dev/null || EXTGLOB_UNSUPPORTED=true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BIN_DIR="${ROOT_DIR}/bin"

# ── Colors ────────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
  BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'; CYAN='\033[0;36m'
  MAGENTA='\033[0;35m'; DIM='\033[2m'
else
  RED=''; GREEN=''; YELLOW=''; BLUE=''; BOLD=''; RESET=''; CYAN=''; MAGENTA=''; DIM=''
fi

log_info()    { echo -e "${BLUE}[INFO]${RESET}  $*"; }
log_success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
log_error()   { echo -e "${RED}[ERROR]${RESET} $*" >&2; }

# ── Defaults ──────────────────────────────────────────────────────────────────
CLIENT=""
ENV="default"
PROFILE="smoke"
CONCURRENCY=1       # default: sequential (parallel via --parallel flag)
PARALLEL=false
PATTERN="scenarios/**/*.ts"
HELP=false
SKIP_BUILD=false

# ── Argument parsing ──────────────────────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    --client=*)      CLIENT="${arg#*=}" ;;
    --env=*)         ENV="${arg#*=}" ;;
    --profile=*)     PROFILE="${arg#*=}" ;;
    --concurrency=*) CONCURRENCY="${arg#*=}"; PARALLEL=true ;;
    --pattern=*)     PATTERN="${arg#*=}" ;;
    --parallel)      PARALLEL=true; [[ "${CONCURRENCY}" -eq 1 ]] && CONCURRENCY=4 ;;
    --skip-build)    SKIP_BUILD=true ;;
    --help|-h)       HELP=true ;;
    *) log_error "Unknown argument: $arg (use --help for usage)"; exit 1 ;;
  esac
done

# ── Help ──────────────────────────────────────────────────────────────────────
if [[ "$HELP" == "true" ]]; then
  cat <<EOF

${BOLD}k6 Enterprise Framework — Batch Test Runner${RESET}

USAGE:
  bin/testing/run-all-tests.sh --client=<name> [OPTIONS]

OPTIONS:
  --client=<name>       Client name (required)
  --profile=<name>      Load profile for all tests (default: smoke)
  --env=<name>          Environment config (default: default)
  --parallel            Run tests in parallel (uses run-parallel.js)
  --concurrency=<n>     Max parallel tests (default: 4 when --parallel)
  --pattern=<glob>      File glob relative to client dir (default: scenarios/**/*.ts)
  --skip-build          Skip npm build step (faster re-runs)

EXAMPLES:
  # Run all smoke tests sequentially (safest, easiest to read output)
  run-all-tests.sh --client=myapp --profile=smoke

  # Run all API tests in parallel against staging
  run-all-tests.sh --client=myapp --pattern="scenarios/api/*.ts" --parallel --env=staging

  # Skip build for faster iteration
  run-all-tests.sh --client=myapp --skip-build --profile=quick

  # Run all examples with load profile
  run-all-tests.sh --client=examples --profile=load

CONCURRENCY GUIDE:
  CPU-bound tests  : equal to # of CPU cores
  I/O-bound tests  : 2-4x CPU cores  (recommended: 4)
  Browser tests    : 1-2  (resource intensive)

EOF
  exit 0
fi

# ── Validation ────────────────────────────────────────────────────────────────
if [[ -z "$CLIENT" ]]; then
  log_error "--client is required. Use --help for usage."
  exit 1
fi

CLIENT_DIR="${ROOT_DIR}/clients/${CLIENT}"
if [[ ! -d "$CLIENT_DIR" ]]; then
  AVAILABLE=$(ls "${ROOT_DIR}/clients" 2>/dev/null | tr '\n' ' ' || echo "_reference examples")
  log_error "Client '${CLIENT}' not found."
  echo ""
  echo -e "  ${BOLD}Available clients:${RESET} ${AVAILABLE}"
  echo -e "  ${BOLD}Create new:${RESET} ./bin/create-client.sh ${CLIENT}"
  exit 1
fi

if [[ ! -f "${CLIENT_DIR}/config/default.json" ]]; then
  log_error "Client '${CLIENT}' is missing config/default.json"
  exit 1
fi

# Warn about extglob patterns if not supported
if [[ "${EXTGLOB_UNSUPPORTED:-false}" == "true" && "$PATTERN" == *"!("* ]]; then
  log_warn "Your shell does not support extglob negation patterns."
  log_warn "Upgrade to bash 4+ or use a positive pattern instead."
fi

# ── Validate client config ────────────────────────────────────────────────────
log_info "Validating client configuration..."
if node -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('${CLIENT_DIR}/config/default.json', 'utf8'));
// Only 'client' is required per the JSON schema; version is strongly recommended
const required = ['client'];
const missing = required.filter(k => !config[k]);
if (missing.length) {
  console.error('Config missing required fields: ' + missing.join(', '));
  process.exit(1);
}
// Verify at least one service endpoint exists (services or endpoints)
if (!config.services && !config.endpoints && !config.baseUrl) {
  console.error('Config must define at least one of: services, endpoints, or baseUrl');
  process.exit(1);
}
" 2>&1; then
  log_success "Client config valid."
else
  log_error "Fix config errors before running tests."
  exit 1
fi

# ── Build once before batch run ───────────────────────────────────────────────
if [[ "${SKIP_BUILD}" == "false" ]]; then
  log_info "Building TypeScript bundle..."
  if ! npm run build --prefix "${ROOT_DIR}" 2>&1; then
    log_error "Build failed. Fix TypeScript errors and retry."
    exit 107
  fi
  log_success "Build complete."
fi

# ── Discover scenarios ────────────────────────────────────────────────────────
SCENARIOS=()
while IFS= read -r -d '' f; do
  rel="${f#${CLIENT_DIR}/scenarios/}"
  rel="${rel%.ts}"
  SCENARIOS+=("${rel}")
done < <(find "${CLIENT_DIR}/scenarios" -name "*.ts" -print0 2>/dev/null | sort -z)

if [[ "${#SCENARIOS[@]}" -eq 0 ]]; then
  log_error "No .ts scenarios found in ${CLIENT_DIR}/scenarios/"
  exit 1
fi

TOTAL="${#SCENARIOS[@]}"

# ── Banner ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}  ┌──────────────────────────────────────────────────────┐${RESET}"
printf   "${BOLD}  │${RESET}  %-54s${BOLD}│${RESET}\n" "Batch Execution: ${CLIENT} (${TOTAL} tests)"
printf   "${BOLD}  │${RESET}  %-54s${BOLD}│${RESET}\n" "Profile: ${PROFILE}  |  Env: ${ENV}  |  Mode: $([ "${PARALLEL}" == "true" ] && echo "parallel (${CONCURRENCY})" || echo "sequential")"
echo -e "${BOLD}  └──────────────────────────────────────────────────────┘${RESET}"
echo ""

# ── Parallel mode: delegate to run-parallel.js ────────────────────────────────
if [[ "${PARALLEL}" == "true" ]]; then
  log_info "Launching parallel runner (concurrency: ${CONCURRENCY})..."
  node "${SCRIPT_DIR}/run-parallel.js" \
    --client="${CLIENT}" \
    --tests="${PATTERN}" \
    --concurrency="${CONCURRENCY}" \
    --env="${ENV}"
  exit $?
fi

# ── Sequential batch execution (T-170: real-time per-test progress) ────────────
BATCH_START=$(date +%s)
PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
declare -A TEST_RESULTS
declare -A TEST_DURATIONS

for i in "${!SCENARIOS[@]}"; do
  SCENARIO="${SCENARIOS[$i]}"
  IDX=$(( i + 1 ))
  TEST_START=$(date +%s)

  # T-170: real-time progress display
  echo -e "${MAGENTA}[${IDX}/${TOTAL}]${RESET} RUNNING ${BOLD}${SCENARIO}${RESET}... $(date +%H:%M:%S)"

  RUN_EXIT=0
  "${BIN_DIR}/run-test.sh" \
    --client="${CLIENT}" \
    --scenario="${SCENARIO}" \
    --profile="${PROFILE}" \
    --env="${ENV}" \
    --skip-build \
    --batch-index="${IDX}" \
    --batch-total="${TOTAL}" \
    2>&1 | sed 's/^/    /' || RUN_EXIT=${PIPESTATUS[0]}

  TEST_END=$(date +%s)
  ELAPSED=$(( TEST_END - TEST_START ))
  ELAPSED_FMT=$(printf "%dm%02ds" $((ELAPSED / 60)) $((ELAPSED % 60)))
  TEST_DURATIONS["${SCENARIO}"]="${ELAPSED_FMT}"

  if [[ "${RUN_EXIT}" -eq 0 ]]; then
    TEST_RESULTS["${SCENARIO}"]="PASS"
    PASS_COUNT=$(( PASS_COUNT + 1 ))
    echo -e "    ${GREEN}✓ PASSED${RESET} (${ELAPSED_FMT})"
  elif [[ "${RUN_EXIT}" -eq 99 ]]; then
    TEST_RESULTS["${SCENARIO}"]="THRESHOLD"
    FAIL_COUNT=$(( FAIL_COUNT + 1 ))
    echo -e "    ${YELLOW}⚠ THRESHOLD FAILURE${RESET} (exit 99, ${ELAPSED_FMT})"
  else
    TEST_RESULTS["${SCENARIO}"]="FAIL"
    FAIL_COUNT=$(( FAIL_COUNT + 1 ))
    echo -e "    ${RED}✗ FAILED${RESET} (exit ${RUN_EXIT}, ${ELAPSED_FMT})"
  fi
  echo ""
done

# ── Consolidated batch summary (T-170) ────────────────────────────────────────
BATCH_END=$(date +%s)
BATCH_ELAPSED=$(( BATCH_END - BATCH_START ))
BATCH_ELAPSED_FMT=$(printf "%dm%02ds" $((BATCH_ELAPSED / 60)) $((BATCH_ELAPSED % 60)))
PASS_RATE=0
[[ "${TOTAL}" -gt 0 ]] && PASS_RATE=$(( PASS_COUNT * 100 / TOTAL ))

echo ""
echo -e "${BOLD}  ┌──────────────────────────────────────────────────────────────────┐${RESET}"
printf   "${BOLD}  │${RESET}  %-66s${BOLD}│${RESET}\n" "Batch Summary — ${CLIENT} | ${TOTAL} tests | ${BATCH_ELAPSED_FMT} total"
echo -e "${BOLD}  ├──────────────────────────────────────────────────────────────────┤${RESET}"
printf   "${BOLD}  │${RESET}  ${GREEN}%-4s Passed${RESET}  ${RED}%-4s Failed${RESET}  ${YELLOW}%-4s Threshold${RESET}  Pass rate: %-8s${BOLD}│${RESET}\n" \
  "${PASS_COUNT}" "${FAIL_COUNT}" "${SKIP_COUNT}" "${PASS_RATE}%"
echo -e "${BOLD}  ├──────────────────────────────────────────────────────────────────┤${RESET}"
printf   "${BOLD}  │${RESET}  %-30s %-12s %-20s${BOLD}│${RESET}\n" "Test" "Result" "Duration"
echo -e "${BOLD}  ├──────────────────────────────────────────────────────────────────┤${RESET}"

for SCENARIO in "${SCENARIOS[@]}"; do
  RESULT="${TEST_RESULTS[$SCENARIO]:-SKIP}"
  DURATION="${TEST_DURATIONS[$SCENARIO]:-N/A}"
  if [[ "${RESULT}" == "PASS" ]]; then
    RESULT_FMT="${GREEN}PASS${RESET}"
  elif [[ "${RESULT}" == "THRESHOLD" ]]; then
    RESULT_FMT="${YELLOW}THRESHOLD${RESET}"
  else
    RESULT_FMT="${RED}FAIL${RESET}"
  fi
  # Truncate scenario name to 30 chars
  SHORT="${SCENARIO:0:30}"
  printf   "${BOLD}  │${RESET}  %-30s %-12b %-20s${BOLD}│${RESET}\n" "${SHORT}" "${RESULT_FMT}" "${DURATION}"
done

echo -e "${BOLD}  └──────────────────────────────────────────────────────────────────┘${RESET}"
echo ""

# Reports path (T-170: prominent and copiable)
echo -e "  ${BOLD}Reports:${RESET} ${ROOT_DIR}/reports/${CLIENT}/"
echo ""

# Final verdict
if [[ "${FAIL_COUNT}" -eq 0 ]]; then
  echo -e "  ${GREEN}${BOLD}╔═══════════════════════════════════════╗${RESET}"
  echo -e "  ${GREEN}${BOLD}║     ALL ${TOTAL} TESTS PASSED (${PASS_RATE}%)       ║${RESET}"
  echo -e "  ${GREEN}${BOLD}╚═══════════════════════════════════════╝${RESET}"
  exit 0
else
  echo -e "  ${RED}${BOLD}╔═══════════════════════════════════════╗${RESET}"
  echo -e "  ${RED}${BOLD}║  ${FAIL_COUNT} of ${TOTAL} TESTS FAILED                   ║${RESET}"
  echo -e "  ${RED}${BOLD}╚═══════════════════════════════════════╝${RESET}"
  exit 1
fi
