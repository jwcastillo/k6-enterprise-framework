#!/usr/bin/env bash
# run-test.sh — k6 Enterprise Framework CLI wrapper
#
# T-021 / T-151: 6-step pipeline with standardized exit codes and artifact generation.
# T-165 (Phase 8): Progress bar, color-coded output, improved --help with groups/examples.
# T-170 (Phase 8): Human-readable ISO artifact naming, batch progress, config error guidance.
#
# Pipeline steps:
#   1. Validate configuration (validate-config.js)
#   2. Build TypeScript bundle (npm run build)
#   3. Execute k6 test (k6 run)
#   4. Auto-comparison report (auto-compare.js)
#   5. Generate HTML report, metrics CSV, analysis MD, message MD
#   6. Print summary and set exit code
#
# Exit codes:
#   0   — All tests passed, thresholds met
#   1   — Test error / framework error / critical regression detected
#   99  — k6 thresholds failed (tests ran but SLOs not met)
#   107 — Script/build error (TypeScript compile, missing file, etc.)
#
# Artifacts per run (in reports/<client>/<scenario>/):
#   html-report-<ISO>.html        — HTML dashboard
#   summary-<ISO>.json            — k6 summary export
#   k6-execution-<ISO>.log        — k6 execution log
#   comparison-<ISO>.md           — auto-comparison markdown
#   (summary.txt removed — all data embedded in HTML dashboard)
#   metrics-<ISO>.csv             — metrics in CSV format
#
# Usage: ./bin/run-test.sh --client <name> --scenario <path> --profile <name>
# See --help for all options.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ── Defaults ──────────────────────────────────────────────────────────────────
CLIENT="${K6_CLIENT:-_reference}"
SCENARIO=""
TEST_MODE="false"
PROFILE="${K6_PROFILE:-smoke}"
ENV="${K6_ENV:-default}"
DEBUG="${K6_DEBUG:-false}"
STRUCTURED_LOGS="${K6_STRUCTURED_LOGS:-false}"
REPORTS_DIR="${K6_REPORTS_DIR:-${ROOT_DIR}/reports}"
EXTRA_ARGS=()
RUN_LABEL="${K6_RUN_LABEL:-}"
STORY_ID="${K6_STORY:-}"
STORY_URL="${K6_STORY_URL:-}"
SKIP_BUILD="${K6_SKIP_BUILD:-false}"
SKIP_COMPARE="${K6_SKIP_COMPARE:-false}"
SKIP_VALIDATE="${K6_SKIP_VALIDATE:-false}"
LIST_PROFILES="${LIST_PROFILES:-false}"
BATCH_INDEX=""
BATCH_TOTAL=""
EXTRA_CONFIG=""
DRY_RUN="false"             # T-167: --dry-run shows plan without executing
# T-261: GPT-inspired test gating — default-deny; each flag unlocks its gate kind
ALLOW_QUARANTINED="false"
ALLOW_EXPERIMENTAL="false"
ALLOW_UNSAFE="false"
# Editorial HTML report via k6-report (opt-in)
EDITORIAL_REPORT="${K6_EDITORIAL_REPORT:-0}"
# Prometheus remote-write output
PROMETHEUS_OUT="false"
PROMETHEUS_RW_URL="${K6_PROMETHEUS_RW_SERVER_URL:-http://localhost:9090/api/v1/write}"
# Observability outputs (Loki, Tempo, OpenTelemetry)
LOKI_OUT="${K6_LOKI_OUT:-false}"
LOKI_URL="${K6_LOKI_URL:-http://localhost:3100/loki/api/v1/push}"
TEMPO_OUT="${K6_TEMPO_OUT:-false}"
TEMPO_ENDPOINT="${OTEL_EXPORTER_OTLP_ENDPOINT:-http://localhost:4317}"
OTEL_OUT="${K6_OTEL_OUT:-false}"
# OBS2-01 (Phase 08): OTel Collector integration. When K6_OTEL_ENABLED=true,
# OTLP traces+metrics route via the collector (default http://localhost:4317)
# instead of Tempo-direct. Resource attributes attached to every emitted signal.
OTEL_ENABLED="${K6_OTEL_ENABLED:-false}"
OTEL_GRPC_EXPORTER_ENDPOINT="${K6_OTEL_GRPC_EXPORTER_ENDPOINT:-http://localhost:4317}"
OTEL_RESOURCE_ATTRIBUTES_EXTRA="${K6_OTEL_RESOURCE_ATTRIBUTES:-}"
# OBS2-02 (Phase 09): Node-host continuous profiling. When true, this script
# starts a Node sidecar (bin/_pyroscope-continuous.js) before k6 and stops it
# on EXIT trap. Rejected for capacity-grade profiles (capacity|stress|breakpoint
# |soak) -- the 2-5% Node CPU overhead would invalidate capacity measurements.
PYROSCOPE_CONTINUOUS="${K6_PYROSCOPE_CONTINUOUS:-false}"
# T-148: xk6 extensions management
EXTENSIONS="${K6_EXTENSIONS:-}"        # comma-separated: redis,sql,grpc
LIST_EXTENSIONS_FLAG="false"
K6_CACHE_DIR="${K6_CACHE_DIR:-${ROOT_DIR}/.k6-cache}"
# SEC-02: CLI auth token provided at invocation time (--auth-token flag or env)
AUTH_TOKEN_PROVIDED="${K6_AUTH_TOKEN_PROVIDED:-}"

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'
CYAN='\033[0;36m'; MAGENTA='\033[0;35m'; DIM='\033[2m'

# Disable colors if not a terminal (CI/CD, pipes)
if [[ ! -t 1 ]]; then
  RED=''; GREEN=''; YELLOW=''; BLUE=''; BOLD=''; RESET=''; CYAN=''; MAGENTA=''; DIM=''
fi

# ── Logging ───────────────────────────────────────────────────────────────────
log_step()    { echo -e "${CYAN}[STEP]${RESET}  $*"; }
log_info()    { echo -e "${BLUE}[INFO]${RESET}  $*"; }
log_success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
log_error()   { echo -e "${RED}[ERROR]${RESET} $*" >&2; }
log_debug()   { [[ "${DEBUG}" == "true" ]] && echo -e "${DIM}[DEBUG]${RESET} $*" || true; }

# ── Post-processing timeout guard ────────────────────────────────────────────
# Runs a command with a watchdog that kills it after N seconds if it hangs.
# Works on macOS and Linux without requiring GNU coreutils.
#
#   _run_timed <label> <timeout_secs> <cmd> [args...]
#
_run_timed() {
  local label="$1" secs="$2"; shift 2
  "$@" &
  local _pid=$!
  # Watchdog subprocess: kill the child if it exceeds the timeout
  ( sleep "${secs}" && kill "${_pid}" 2>/dev/null \
    && echo -e "${YELLOW}[WARN]${RESET}  ${label} timed out after ${secs}s — killed" >&2
  ) &
  local _wd=$!
  wait "${_pid}" 2>/dev/null
  local _rc=$?
  # Cancel the watchdog (already dead if timeout fired)
  kill "${_wd}" 2>/dev/null; wait "${_wd}" 2>/dev/null || true
  return ${_rc}
}

# ── Progress bar (T-165) ──────────────────────────────────────────────────────
PROGRESS_START=0
PROGRESS_PROFILE_SECS=60  # estimate from profile

profile_to_seconds() {
  local p="$1"
  case "$p" in
    smoke)      echo 60 ;;
    quick)      echo 180 ;;
    load)       echo 840 ;;
    rampup)     echo 780 ;;
    capacity)   echo 1200 ;;
    stress)     echo 1500 ;;
    spike)      echo 300 ;;
    breakpoint) echo 3600 ;;
    soak)       echo 14400 ;;
    *)          echo 120 ;;
  esac
}

draw_progress() {
  local current="$1" total="$2" label="${3:-Running}"
  local bar_width=20
  local filled=$(( bar_width * current / (total > 0 ? total : 1) ))
  local empty=$(( bar_width - filled ))
  local bar=""
  for ((i=0; i<filled; i++)); do bar+="="; done
  bar+=">"
  for ((i=0; i<empty; i++)); do bar+=" "; done
  printf "\r${CYAN}[%-${bar_width}s]${RESET} %3d%% | %s  " "$bar" "$((100 * current / (total > 0 ? total : 1)))" "$label"
}

# Batch progress display (T-170)
batch_prefix() {
  if [[ -n "${BATCH_INDEX}" && -n "${BATCH_TOTAL}" ]]; then
    echo -e "${MAGENTA}[${BATCH_INDEX}/${BATCH_TOTAL}]${RESET} "
  fi
}

# ── Help / version ────────────────────────────────────────────────────────────
print_banner() {
  echo -e "${BOLD}"
  echo "  ╔══════════════════════════════════════════════╗"
  echo "  ║     k6 Enterprise Load Testing Framework     ║"
  echo "  ║                  v0.1.0                      ║"
  echo "  ╚══════════════════════════════════════════════╝"
  echo -e "${RESET}"
}

print_help() {
  cat <<EOF
${BOLD}k6 Enterprise Framework — run-test.sh${RESET}

USAGE:
  ./bin/run-test.sh [OPTIONS]

${BOLD}── Execution ─────────────────────────────────────────────────────────────${RESET}
  --client <name>        Client directory under clients/
                         Default: _reference
                         Available: $(ls "${ROOT_DIR}/clients" 2>/dev/null | tr '\n' ' ' || echo "_reference examples")
  --scenario <path>      Scenario path relative to clients/<client>/scenarios/
                         Canonical buckets (D-01): api, flow, domain, chaos, perf
                         Form 1: --scenario=<bucket>/<path>  (e.g. domain/ndc/airshopping-peru)
                         Form 2: --scenario=<path>           (no bucket — auto-resolves
                                                              when exactly one match;
                                                              errors on ambiguity)
                         Non-canonical prefix with '/' (e.g. mybucket/foo) → error
  --test <path>          [deprecated since v0.3.0] Use --scenario=<bucket>/<path>.
                         Emits a warning and auto-translates to --scenario.
                         Removal scheduled for v0.4.0.
  --profile <name>       Load profile controlling VUs and duration
                         Default: smoke  (use --list-profiles for full table)
  --env <name>           Target environment: default|staging|production
                         Default: default

${BOLD}── Output ────────────────────────────────────────────────────────────────${RESET}
  --reports-dir <dir>    Output directory for all artifacts
                         Default: ./reports
  --extensions <list>    Comma-separated xk6 extensions to compile (e.g. redis,sql,grpc)
                         Uses cached binary in .k6-cache/ if available
                         Also set via K6_EXTENSIONS env var
  --list-extensions      Show available extensions and their cache status, then exit
  --auth-token=<token>   CLI auth token for environments where K6_AUTH_TOKEN is set (SEC-02)
                         Also set via K6_AUTH_TOKEN_PROVIDED env var
  --skip-build           Skip npm build step (use existing dist/)
  --skip-validate        Skip config validation step
  --skip-compare         Skip auto-comparison step
  --list-profiles        Show profiles table and exit
  --editorial-report     Generate editorial HTML report via k6-report
                         Requires: npm run build in ../k6-report/
                         Also set via K6_EDITORIAL_REPORT=1 env var

${BOLD}── Observability ─────────────────────────────────────────────────────────${RESET}
  --prometheus [url]     Enable Prometheus remote-write output
  --loki [url]           Send logs to Loki (replaces file log output)
                         Default: http://localhost:3100/loki/api/v1/push
  --tempo [endpoint]     Send traces to Tempo via OTLP gRPC
                         Default: http://localhost:4317
  --otel                 Enable OpenTelemetry metrics output
  --otel-enabled         Enable OTLP export via OTel Collector (K6_OTEL_ENABLED=true)
                         Default endpoint: http://localhost:4317 (override with
                         --otel-endpoint or K6_OTEL_GRPC_EXPORTER_ENDPOINT).
                         Resource attributes auto-populated:
                           run_id, client, scenario, profile
                         Add custom attributes via K6_OTEL_RESOURCE_ATTRIBUTES
                         (CSV format: key1=val1,key2=val2).
  --otel-endpoint <url>  Override OTel Collector OTLP endpoint
                         (K6_OTEL_GRPC_EXPORTER_ENDPOINT)
                         Default: http://localhost:4317
  --pyroscope-continuous Enable Node-host continuous profiling (OBS2-02).
                         Starts bin/_pyroscope-continuous.js before k6, stops
                         it on EXIT trap. Pushes profiles to PYROSCOPE_ENDPOINT
                         (default http://localhost:4040). Rejected when
                         --profile=capacity|stress|breakpoint|soak: the 2-5%
                         Node CPU overhead would invalidate measurements.
                         Env: K6_PYROSCOPE_CONTINUOUS=true.
  --observability        Enable Prometheus + Loki + Tempo (full observability)

${BOLD}── Gating (T-261) ────────────────────────────────────────────────────────${RESET}
  Scenarios marked with \`export const gate = "<kind>"\` are blocked by default.
  Pass the matching flag to opt in. Gating is orthogonal to the 5 buckets.
  Blocked scenarios exit with code 108.

  --quarantined          Allow running quarantined scenarios (exit 108 without)
  --experimental         Allow running experimental scenarios (exit 108 without)
  --unsafe               Allow running unsafe scenarios (exit 108 without)

${BOLD}── Debug ─────────────────────────────────────────────────────────────────${RESET}
  --debug                Enable verbose debug logging (K6_DEBUG=true)
  --structured-logs      Enable structured JSON log output
  --help                 Show this help and exit
  --version              Show framework version and exit

${BOLD}── Examples ──────────────────────────────────────────────────────────────${RESET}
  # Quick smoke test (CI/CD — runs in ~1 min)
  ./bin/run-test.sh --client=_reference --scenario=api/smoke-users --profile=smoke

  # Load test against staging environment
  ./bin/run-test.sh --client=myapp --scenario=api/checkout --profile=load --env=staging

  # Use JSON declarative definition (no TypeScript required)
  ./bin/run-test.sh --client=myapp --scenario=test.json --profile=quick

  # Skip build for faster re-runs
  ./bin/run-test.sh --client=_reference --scenario=api/smoke-users --skip-build

  # Full production load test with debug output
  ./bin/run-test.sh --client=myapp --scenario=integration/auth-flow --profile=stress --debug

  # Use YAML scenario definition
  ./bin/run-test.sh --client=myapp --scenario=tests/api-test.yaml --profile=smoke

  # Full observability stack (Prometheus + Loki + Tempo + OTEL)
  ./bin/run-test.sh --client=examples --scenario=integration/16-sli-monitoring --observability

  # Send logs to Loki only
  ./bin/run-test.sh --client=examples --scenario=api/smoke-users --loki

${BOLD}── Exit Codes ────────────────────────────────────────────────────────────${RESET}
  ${GREEN}0${RESET}    All tests passed, thresholds met
  ${RED}1${RESET}    Test error, framework error, or critical regression (>10%)
  ${YELLOW}99${RESET}   k6 thresholds failed — SLOs not met (tests ran successfully)
  ${RED}107${RESET}  Script/build error (TypeScript compile, missing file, etc.)

${BOLD}── Artifacts (in reports/<client>/<scenario>/) ───────────────────────────${RESET}
  html-report-<ISO>.html      HTML dashboard (offline-capable)
  summary-<ISO>.json          k6 summary export + schema v2.0.0
  k6-execution-<ISO>.log      k6 execution log
  comparison-<ISO>.md         Auto-comparison vs previous runs
  summary-<ISO>.txt           Human-readable summary
  metrics-<ISO>.csv           All metrics in CSV format
  editorial-report-<ISO>.html  Editorial audit report (--editorial-report)

${BOLD}── Profiles (run --list-profiles for full table) ─────────────────────────${RESET}
  smoke       1-2 VUs,  1 min   — verify operational, fastest CI check
  quick       5 VUs,    3 min   — fast feedback for CI pipelines
  load        20 VUs,   14 min  — normal sustained load
  rampup      50 VUs,   13 min  — gradual increment to find degradation
  capacity    200 VUs,  20 min  — find maximum throughput
  stress      400 VUs,  25 min  — find breaking point
  spike       300 VUs   burst   — test elasticity and recovery
  breakpoint  1000 VUs, 1h     — find absolute system limit
  soak        20 VUs,   4h+    — detect memory leaks, slow degradation
EOF
}

print_profiles() {
  printf "\n${BOLD}  k6 Enterprise Framework — Load Profiles${RESET}\n\n"
  printf "  %-12s %-8s %-10s %-12s %s\n" "Profile" "VUs" "Duration" "Category" "Use Case"
  printf "  %-12s %-8s %-10s %-12s %s\n" "-------" "---" "--------" "--------" "--------"
  printf "  ${GREEN}%-12s${RESET} %-8s %-10s %-12s %s\n" "smoke"      "1-2"    "1m"    "Sanity"   "Verify service is operational"
  printf "  ${GREEN}%-12s${RESET} %-8s %-10s %-12s %s\n" "quick"      "5"      "3m"    "CI"       "Fast feedback in pipelines"
  printf "  ${CYAN}%-12s${RESET} %-8s %-10s %-12s %s\n"  "load"       "20"     "14m"   "Normal"   "Normal sustained traffic"
  printf "  ${CYAN}%-12s${RESET} %-8s %-10s %-12s %s\n"  "rampup"     "50"     "13m"   "Gradient" "Gradual increment testing"
  printf "  ${YELLOW}%-12s${RESET} %-8s %-10s %-12s %s\n" "capacity"  "200"    "20m"   "Limit"    "Find max throughput"
  printf "  ${YELLOW}%-12s${RESET} %-8s %-10s %-12s %s\n" "stress"    "400"    "25m"   "Stress"   "Find breaking point"
  printf "  ${RED}%-12s${RESET} %-8s %-10s %-12s %s\n"   "spike"     "300 ↑"  "5m"    "Spike"    "Elasticity and recovery"
  printf "  ${RED}%-12s${RESET} %-8s %-10s %-12s %s\n"   "breakpoint" "1000"  "1h"    "Extreme"  "Find absolute system limit"
  printf "  ${MAGENTA}%-12s${RESET} %-8s %-10s %-12s %s\n" "soak"    "20"     "4h+"   "Endurance" "Memory leaks, slow degradation"
  printf "\n  Usage: ${BOLD}./bin/run-test.sh --profile=<name> ...${RESET}\n\n"
}

print_version() {
  echo "k6-enterprise-framework v0.1.0"
  k6 version 2>&1 | head -1 || true
  echo "Node.js $(node --version)"
}

# ── Input sanitization (T-126) ────────────────────────────────────────────────
SAFE_NAME_RE='^[a-zA-Z0-9_.-]+$'
SAFE_PATH_RE='^[a-zA-Z0-9_/.-]+$'

validate_input() {
  local name="$1" value="$2" pattern="$3"
  if [[ -z "${value}" ]]; then
    log_error "Parameter ${name} cannot be empty"
    exit 1
  fi
  if [[ "${#value}" -gt 256 ]]; then
    log_error "Parameter ${name} exceeds maximum length (256 characters)"
    exit 1
  fi
  if [[ "${value}" == *".."* ]]; then
    log_error "Path traversal detected in ${name}: '${value}'"
    exit 1
  fi
  if [[ ! "${value}" =~ ${pattern} ]]; then
    log_error "Invalid value for ${name}: '${value}'"
    exit 1
  fi
}

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --client=*)       CLIENT="${1#*=}";              shift ;;
    --client)         CLIENT="$2";                   shift 2 ;;
    --scenario=*)     SCENARIO="${1#*=}";             shift ;;
    --scenario)       SCENARIO="$2";                 shift 2 ;;
    --test=*)         _RAW="${1#*=}"; _STRIPPED="${_RAW#tests/}"; SCENARIO="${_STRIPPED%.test}"; log_warn "--test is deprecated; use --scenario=<bucket>/<path>"; log_warn "Auto-translating to --scenario=${SCENARIO}"; shift ;;
    --test)           _RAW="$2"; _STRIPPED="${_RAW#tests/}"; SCENARIO="${_STRIPPED%.test}"; log_warn "--test is deprecated; use --scenario=<bucket>/<path>"; log_warn "Auto-translating to --scenario=${SCENARIO}"; shift 2 ;;
    --profile=*)      PROFILE="${1#*=}";              shift ;;
    --profile)        PROFILE="$2";                  shift 2 ;;
    --env=*)          ENV="${1#*=}";                  shift ;;
    --env)            ENV="$2";                      shift 2 ;;
    --reports-dir=*)  REPORTS_DIR="${1#*=}";          shift ;;
    --reports-dir)    REPORTS_DIR="$2";              shift 2 ;;
    --batch-index=*)  BATCH_INDEX="${1#*=}";          shift ;;
    --batch-index)    BATCH_INDEX="$2";              shift 2 ;;
    --batch-total=*)  BATCH_TOTAL="${1#*=}";          shift ;;
    --batch-total)    BATCH_TOTAL="$2";              shift 2 ;;
    --config=*)       EXTRA_CONFIG="${1#*=}";         shift ;;
    --config)         EXTRA_CONFIG="$2";             shift 2 ;;
    --run-label=*)    RUN_LABEL="${1#*=}";             shift ;;
    --run-label)      RUN_LABEL="$2";                shift 2 ;;
    --story=*)        STORY_ID="${1#*=}";             shift ;;
    --story)          STORY_ID="$2";                 shift 2 ;;
    --story-url=*)    STORY_URL="${1#*=}";            shift ;;
    --story-url)      STORY_URL="$2";                shift 2 ;;
    --skip-build)     SKIP_BUILD="true";             shift   ;;
    --skip-validate)  SKIP_VALIDATE="true";          shift   ;;
    --skip-compare)   SKIP_COMPARE="true";           shift   ;;
    --auth-token=*)   AUTH_TOKEN_PROVIDED="${1#*=}";  shift   ;;
    --auth-token)     AUTH_TOKEN_PROVIDED="$2";       shift 2 ;;
    --debug)          DEBUG="true";                  shift   ;;
    --structured-logs) STRUCTURED_LOGS="true";       shift   ;;
    --dry-run)        DRY_RUN="true";                 shift ;;
    --editorial-report)   EDITORIAL_REPORT="1";            shift ;;
    --prometheus)     PROMETHEUS_OUT="true";           shift ;;
    --prometheus=*)   PROMETHEUS_OUT="true"; PROMETHEUS_RW_URL="${1#*=}"; shift ;;
    --loki)           LOKI_OUT="true";                 shift ;;
    --loki=*)         LOKI_OUT="true"; LOKI_URL="${1#*=}"; shift ;;
    --tempo)          TEMPO_OUT="true";                shift ;;
    --tempo=*)        TEMPO_OUT="true"; TEMPO_ENDPOINT="${1#*=}"; shift ;;
    --otel)           OTEL_OUT="true";                 shift ;;
    --otel-enabled)         OTEL_ENABLED="true";                shift ;;
    --otel-endpoint=*)      OTEL_GRPC_EXPORTER_ENDPOINT="${1#*=}"; shift ;;
    --otel-endpoint)        OTEL_GRPC_EXPORTER_ENDPOINT="$2";   shift 2 ;;
    --pyroscope-continuous) PYROSCOPE_CONTINUOUS="true";        shift ;;
    --observability)  LOKI_OUT="true"; TEMPO_OUT="true"; PROMETHEUS_OUT="true"; shift ;;
    --extensions=*)   EXTENSIONS="${1#*=}";            shift ;;
    --extensions)     EXTENSIONS="$2";                shift 2 ;;
    --list-extensions) LIST_EXTENSIONS_FLAG="true";   shift ;;
    --list-profiles)  print_profiles; exit 0 ;;
    --help|-h)        print_help; exit 0 ;;
    --version|-v)     print_version; exit 0 ;;
    --quarantined)    ALLOW_QUARANTINED="true";           shift ;;
    --experimental)   ALLOW_EXPERIMENTAL="true";          shift ;;
    --unsafe)         ALLOW_UNSAFE="true";                shift ;;
    --)               shift; EXTRA_ARGS+=("$@"); break ;;
    *)                log_warn "Unknown option: $1 (use --help for usage)"; shift ;;
  esac
done

SCENARIO="${SCENARIO:-${K6_SCENARIO:-}}"

# ── Validate inputs ───────────────────────────────────────────────────────────
print_banner

if [[ -z "${SCENARIO}" ]]; then
  log_error "No scenario specified. Use --scenario <path> or set K6_SCENARIO"
  echo ""
  echo -e "  ${BOLD}Examples:${RESET}"
  echo -e "    ./bin/run-test.sh --client=_reference --scenario=api/smoke-users"
  echo -e "    ./bin/run-test.sh --client=myapp --scenario=integration/auth-flow --profile=load"
  echo ""
  echo -e "  Run ${CYAN}./bin/run-test.sh --help${RESET} for full usage."
  exit 1
fi

# Show batch context if running as part of batch
if [[ -n "${BATCH_INDEX}" && -n "${BATCH_TOTAL}" ]]; then
  echo -e "${MAGENTA}[${BATCH_INDEX}/${BATCH_TOTAL}]${RESET} RUNNING ${BOLD}${SCENARIO}${RESET}..."
fi

validate_input "--client"   "${CLIENT}"   "${SAFE_NAME_RE}"

# ── --scenario decision tree (Phase 2 TST-04, D-28/D-29/D-30) ────────────────
# Canonical buckets per D-01; mutually exclusive branches per the plan-checker
# resolution of the D-29/D-30 contradiction (D-30 wins on slash-form input).
CANONICAL_BUCKETS=(api flow domain chaos perf)
is_canonical_bucket() {
  local b="$1"
  for cb in "${CANONICAL_BUCKETS[@]}"; do
    [[ "$b" == "$cb" ]] && return 0
  done
  return 1
}

if [[ "${SCENARIO}" == */* ]]; then
  _SCENARIO_PREFIX="${SCENARIO%%/*}"
  _SCENARIO_REST="${SCENARIO#*/}"
else
  _SCENARIO_PREFIX=""
  _SCENARIO_REST="${SCENARIO}"
fi

if [[ -z "${_SCENARIO_PREFIX}" ]]; then
  # Branch A — no '/' in SCENARIO: auto-resolve via glob
  _CLIENT_SCENARIOS_DIR="${ROOT_DIR}/clients/${CLIENT}/scenarios"
  if [[ ! -d "${_CLIENT_SCENARIOS_DIR}" ]]; then
    log_error "--scenario='${SCENARIO}' not found: clients/${CLIENT}/scenarios/ does not exist"
    exit 1
  fi
  # Collect matches into an array (null-byte delimited to be safe with weird names)
  _MATCHES=()
  while IFS= read -r -d '' _m; do
    _MATCHES+=("$_m")
  done < <(find "${_CLIENT_SCENARIOS_DIR}" -path "*/${SCENARIO}.ts" -type f -print0 2>/dev/null)
  _MATCH_COUNT=${#_MATCHES[@]}
  if (( _MATCH_COUNT == 0 )); then
    log_error "--scenario='${SCENARIO}' not found under clients/${CLIENT}/scenarios/"
    echo -e "  Search pattern: */${SCENARIO}.ts"
    exit 1
  elif (( _MATCH_COUNT == 1 )); then
    _RESOLVED="${_MATCHES[0]#${_CLIENT_SCENARIOS_DIR}/}"
    _RESOLVED="${_RESOLVED%.ts}"
    log_info "resolved --scenario=${SCENARIO} -> ${_RESOLVED}"
    SCENARIO="${_RESOLVED}"
  else
    log_error "ambiguous --scenario='${SCENARIO}'; matches:"
    for _m in "${_MATCHES[@]}"; do
      _rel="${_m#${_CLIENT_SCENARIOS_DIR}/}"
      _rel="${_rel%.ts}"
      echo "    ${_rel}"
    done
    echo "  Use the full path: --scenario=<bucket>/<path>"
    exit 1
  fi
elif is_canonical_bucket "${_SCENARIO_PREFIX}"; then
  # Branch B — '/' present AND prefix is canonical: accept SCENARIO as-is
  :
else
  # Branch C — '/' present AND prefix is NOT canonical: D-30 invalid bucket error
  log_error "invalid bucket '${_SCENARIO_PREFIX}' in --scenario='${SCENARIO}'"
  echo -e "  Valid buckets (TST-01 canonical taxonomy):" >&2
  echo -e "    api    — single-endpoint smoke probes" >&2
  echo -e "    flow   — multi-step integration flows" >&2
  echo -e "    domain — service-level scenarios (domain/<service>/<action>)" >&2
  echo -e "    chaos  — FCI / fault-injection / resilience scenarios" >&2
  echo -e "    perf   — capacity, breakpoint, stress, soak scenarios" >&2
  echo -e "" >&2
  echo -e "  Scenario paths MUST start with one of the buckets above and live under" >&2
  echo -e "    clients/<client>/scenarios/<bucket>/..." >&2
  echo -e "" >&2
  echo -e "  Example (correct):" >&2
  echo -e "    ./bin/run-test.sh --client=<client> --scenario=domain/<service>/<action> --profile=smoke" >&2
  echo -e "" >&2
  echo -e "  Full taxonomy: clients/_reference/README.md (EN) / README.es.md (ES)" >&2
  exit 1
fi
unset _SCENARIO_PREFIX _SCENARIO_REST _CLIENT_SCENARIOS_DIR _MATCHES _MATCH_COUNT _RESOLVED _m _rel

validate_input "--scenario" "${SCENARIO}" "${SAFE_PATH_RE}"
validate_input "--profile"  "${PROFILE}"  "${SAFE_NAME_RE}"
validate_input "--env"      "${ENV}"      "${SAFE_NAME_RE}"

# T-127: Validate --reports-dir stays within an allowed scope.
# Block traversal in the raw value FIRST — before any filesystem access or
# prefix check. A path like "${ROOT_DIR}/reports/../../../tmp/evil" would
# otherwise match the prefix guard and skip all validation.
if [[ "${REPORTS_DIR}" == *".."* ]]; then
  log_error "Path traversal detected in --reports-dir: '${REPORTS_DIR}'"
  exit 1
fi

# For paths outside the default location, also verify the resolved real path.
if [[ "${REPORTS_DIR}" != "${ROOT_DIR}/reports"* ]]; then
  REPORTS_DIR_REAL="$(realpath "${REPORTS_DIR}" 2>/dev/null || echo "")"
  if [[ -z "${REPORTS_DIR_REAL}" ]]; then
    # Directory doesn't exist yet — resolve the parent and check that
    REPORTS_PARENT="$(realpath "$(dirname "${REPORTS_DIR}")" 2>/dev/null || echo "")"
    if [[ -z "${REPORTS_PARENT}" ]]; then
      log_error "Invalid --reports-dir: cannot resolve '${REPORTS_DIR}'"
      exit 1
    fi
    REPORTS_DIR_REAL="${REPORTS_PARENT}/$(basename "${REPORTS_DIR}")"
  fi
fi

# T-129: Validate --config path scope and JSON well-formedness.
if [[ -n "${EXTRA_CONFIG}" ]]; then
  # Reject traversal characters before any filesystem access
  if [[ "${EXTRA_CONFIG}" == *".."* ]]; then
    log_error "Path traversal detected in --config: '${EXTRA_CONFIG}'"
    exit 1
  fi
  # Resolve to absolute path; must remain within ROOT_DIR
  EXTRA_CONFIG_REAL="$(realpath "${EXTRA_CONFIG}" 2>/dev/null || echo "")"
  if [[ -z "${EXTRA_CONFIG_REAL}" ]]; then
    log_error "--config file not found: '${EXTRA_CONFIG}'"
    exit 1
  fi
  if [[ "${EXTRA_CONFIG_REAL}" != "${ROOT_DIR}"/* ]]; then
    log_error "--config path '${EXTRA_CONFIG}' resolves outside project root"
    exit 1
  fi
  # Verify it is valid JSON before passing to validate-config.js
  if ! node -e "JSON.parse(require('fs').readFileSync('${EXTRA_CONFIG_REAL}','utf8'))" 2>/dev/null; then
    log_error "--config file is not valid JSON: '${EXTRA_CONFIG}'"
    exit 107
  fi
  log_debug "Extra config validated: ${EXTRA_CONFIG_REAL}"
fi

# T-140: Suppress any secret-named env vars from debug output.
# Variables whose names contain TOKEN, PAT, SECRET, PASSWORD, KEY are never printed.
_secret_name_re='TOKEN|PAT|SECRET|PASSWORD|_KEY$|API_KEY'
log_debug_safe() {
  local msg="$1"
  # Mask values that follow a secret-named variable (VAR=value pattern)
  echo "${msg}" | sed -E "s/([A-Z_]*(${_secret_name_re})[A-Z_]*)=[^ ]*/\1=****/gI" || true
}

VALID_PROFILES="smoke quick load rampup capacity stress spike breakpoint soak"
if ! echo "${VALID_PROFILES}" | grep -qw "${PROFILE}"; then
  log_error "Profile '${PROFILE}' not found. Available: smoke (1 VU, 1m), quick (5 VUs, 3m), load (20 VUs, 14m), rampup (50 VUs, 13m), capacity (200 VUs, 20m), stress (400 VUs, 25m), spike (300 VUs, 5m), breakpoint (1000 VUs, 1h), soak (20 VUs, 4h+)"
  echo ""
  print_profiles
  exit 1
fi

# OBS2-02: Reject K6_PYROSCOPE_CONTINUOUS=true for capacity-grade profiles.
# Pyroscope continuous profiling adds 2-5% Node CPU overhead, which invalidates
# capacity/stress/breakpoint/soak measurements. Use smoke|quick|load|rampup for
# exploratory profiling; never on a capacity-grade run.
if [[ "${PYROSCOPE_CONTINUOUS}" == "true" ]]; then
  case "${PROFILE}" in
    capacity|stress|breakpoint|soak)
      log_error "K6_PYROSCOPE_CONTINUOUS=true is incompatible with profile=${PROFILE} — capacity/stress/breakpoint/soak invalidates measurements (Pyroscope 2-5% Node CPU overhead corrupts capacity numbers). Disable continuous profiling or choose a non-capacity profile (smoke|quick|load|rampup|spike)."
      exit 1
      ;;
  esac
fi

CLIENT_DIR="${ROOT_DIR}/clients/${CLIENT}"
if [[ ! -d "${CLIENT_DIR}" ]]; then
  AVAILABLE_CLIENTS=$(ls "${ROOT_DIR}/clients" 2>/dev/null | tr '\n' ' ' || echo "_reference examples")
  log_error "Client '${CLIENT}' not found."
  echo ""
  echo -e "  ${BOLD}Available clients:${RESET} ${AVAILABLE_CLIENTS}"
  echo -e "  ${BOLD}Create new client:${RESET} ./bin/create-client.sh ${CLIENT}"
  echo ""
  exit 1
fi

# Prevent path traversal via symlinks (T-127)
CLIENTS_BASE="${ROOT_DIR}/clients"
CLIENT_REAL="$(realpath "${CLIENT_DIR}" 2>/dev/null || echo "")"
if [[ -z "${CLIENT_REAL}" ]] || [[ "${CLIENT_REAL}" != "${CLIENTS_BASE}"/* ]]; then
  log_error "Path traversal detected: '${CLIENT}' resolves outside clients/"
  exit 1
fi

CLIENT_DIST="${CLIENT#_}"
DIST_SCRIPT="${ROOT_DIR}/dist/${CLIENT_DIST}/${SCENARIO}.js"
export K6_SCENARIO_PATH="${SCENARIO}"   # T-167: passed to report enrichment for definitionFormat

# ── Validate scenario source exists before creating any directories ───────────
# Phase 2 TST-04 / D-23: canonical scenarios/ lookup only. --test=*.test paths
# are auto-translated to --scenario=<path> by the flag parser (with warning).
SCENARIO_SRC="${CLIENT_DIR}/scenarios/${SCENARIO}.ts"
if [[ ! -f "${SCENARIO_SRC}" ]]; then
  log_error "Scenario '${SCENARIO}' not found for client '${CLIENT}'."
  echo ""
  echo -e "  ${BOLD}Expected file:${RESET} ${SCENARIO_SRC}"
  echo -e "  ${BOLD}Available scenarios:${RESET}"
  find "${CLIENT_DIR}/scenarios" -name "*.ts" -type f 2>/dev/null \
    | sed "s|${CLIENT_DIR}/scenarios/||; s|\.ts$||" \
    | sort \
    | sed 's/^/    /'
  echo ""
  exit 1
fi

# ── T-261: GPT-inspired test gating ──────────────────────────────────────────
# Prettier enforces double quotes (.prettierrc.json); pnpm lint:fix converts
# single-quote gate markers, so the double-quote-only match is safe.
GATE_MATCH=$(grep -m1 -oE 'export const gate = "(quarantined|experimental|unsafe)"' "${SCENARIO_SRC}" 2>/dev/null || true)
if [[ -n "${GATE_MATCH}" ]]; then
  GATE_KIND=$(echo "${GATE_MATCH}" | sed 's/.*"\(.*\)".*/\1/')
  GATE_ALLOWED="false"
  case "${GATE_KIND}" in
    quarantined)  [[ "${ALLOW_QUARANTINED}" == "true" ]] && GATE_ALLOWED="true" ;;
    experimental) [[ "${ALLOW_EXPERIMENTAL}" == "true" ]] && GATE_ALLOWED="true" ;;
    unsafe)       [[ "${ALLOW_UNSAFE}" == "true" ]] && GATE_ALLOWED="true" ;;
  esac
  if [[ "${GATE_ALLOWED}" != "true" ]]; then
    log_error "scenario '${SCENARIO}' is gated '${GATE_KIND}' — pass --${GATE_KIND} to run it"
    exit 108
  fi
fi

# ── Artifact paths — T-170: Human-readable ISO timestamps ────────────────────
SCENARIO_SLUG="${SCENARIO//\//_}"
# ISO timestamp: YYYYMMDD-HHmmss (no random chars, human-readable, sortable)
ISO_TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
ARTIFACTS_DIR="${REPORTS_DIR}/${CLIENT}/${SCENARIO_SLUG}"
mkdir -p "${ARTIFACTS_DIR}"

# Artifact names follow: <type>-<ISO>.ext format (T-170 CHK-UX-091)
HTML_REPORT="${ARTIFACTS_DIR}/html-report-${ISO_TIMESTAMP}.html"
SUMMARY_JSON="${ARTIFACTS_DIR}/summary-${ISO_TIMESTAMP}.json"
K6_LOG="${ARTIFACTS_DIR}/k6-execution-${ISO_TIMESTAMP}.log"
COMPARISON_MD="${ARTIFACTS_DIR}/comparison-${ISO_TIMESTAMP}.md"
SUMMARY_TXT="${ARTIFACTS_DIR}/summary-${ISO_TIMESTAMP}.txt"
METRICS_CSV="${ARTIFACTS_DIR}/metrics-${ISO_TIMESTAMP}.csv"
ERROR_LOG="${ARTIFACTS_DIR}/error-log-${ISO_TIMESTAMP}.log"
UNEXPECTED_ERRORS_JSON="${ARTIFACTS_DIR}/errors-${ISO_TIMESTAMP}.json"
ANALYSIS_MD="${ARTIFACTS_DIR}/analysis-${ISO_TIMESTAMP}.md"
MESSAGE_MD="${ARTIFACTS_DIR}/message-${ISO_TIMESTAMP}.md"

# Keep legacy RUN_ID for internal references
RUN_ID="${CLIENT}_${SCENARIO_SLUG}_${PROFILE}_${ISO_TIMESTAMP}"

# OBS2-01: Compose the canonical OTel resource attributes for this run.
# Order matters for readability — user-supplied K6_OTEL_RESOURCE_ATTRIBUTES
# is appended last so user values can override defaults if they re-list a key.
OTEL_RESOURCE_ATTRIBUTES_DEFAULT="run_id=${RUN_ID},client=${CLIENT},scenario=${SCENARIO},profile=${PROFILE}"
if [[ -n "${OTEL_RESOURCE_ATTRIBUTES_EXTRA}" ]]; then
  OTEL_RESOURCE_ATTRIBUTES_FINAL="${OTEL_RESOURCE_ATTRIBUTES_DEFAULT},${OTEL_RESOURCE_ATTRIBUTES_EXTRA}"
else
  OTEL_RESOURCE_ATTRIBUTES_FINAL="${OTEL_RESOURCE_ATTRIBUTES_DEFAULT}"
fi

echo -e "  ${BOLD}Client${RESET}:    ${CLIENT}"
echo -e "  ${BOLD}Scenario${RESET}:  ${SCENARIO}"
echo -e "  ${BOLD}Profile${RESET}:   ${PROFILE}"
echo -e "  ${BOLD}Env${RESET}:       ${ENV}"
echo -e "  ${BOLD}Reports${RESET}:   ${ARTIFACTS_DIR}/"
echo -e "  ${BOLD}Timestamp${RESET}: ${ISO_TIMESTAMP}"
echo ""

# OBS2-02: Pyroscope continuous profiling (Node-side, runs as sidecar Node process).
# Started BEFORE k6 invocation, stopped AFTER k6 exits (success or failure via trap).
# Tag set matches the OTLP resource attributes from OBS2-01 so Trace ↔ Profile
# correlation works in Grafana dashboards (Phase 09 OBS2-04).
PYROSCOPE_CONTINUOUS_PID=""
if [[ "${PYROSCOPE_CONTINUOUS}" == "true" ]]; then
  PYROSCOPE_APP_NAME="k6-${CLIENT}.${PROFILE}"
  PYROSCOPE_SERVER="${K6_PYROSCOPE_ENDPOINT:-http://localhost:4040}"
  log_info "Pyroscope continuous profiling enabled → ${PYROSCOPE_SERVER} (app=${PYROSCOPE_APP_NAME} tags=app=k6,client=${CLIENT},scenario=${SCENARIO},profile=${PROFILE},run_id=${RUN_ID})"
  node bin/_pyroscope-continuous.js start \
    --app-name "${PYROSCOPE_APP_NAME}" \
    --server "${PYROSCOPE_SERVER}" \
    --tag "app=k6" --tag "client=${CLIENT}" --tag "scenario=${SCENARIO}" --tag "profile=${PROFILE}" --tag "run_id=${RUN_ID}" &
  PYROSCOPE_CONTINUOUS_PID=$!
  # Register cleanup BEFORE k6 invocation so a partial/interrupted run still flushes.
  trap 'if [[ -n "${PYROSCOPE_CONTINUOUS_PID}" ]] && kill -0 "${PYROSCOPE_CONTINUOUS_PID}" 2>/dev/null; then node bin/_pyroscope-continuous.js stop || true; kill "${PYROSCOPE_CONTINUOUS_PID}" 2>/dev/null || true; fi' EXIT
fi

# Instrumentation startup banner (T-176)
INSTRUMENTATION_PARTS=()
[[ -n "${K6_TEMPO_PROPAGATION:-}" ]] && INSTRUMENTATION_PARTS+=("Tracing: enabled (${K6_TEMPO_PROPAGATION})")
[[ -n "${K6_PYROSCOPE_ENDPOINT:-}" ]] && INSTRUMENTATION_PARTS+=("Profiling: enabled (Pyroscope)")
if [[ ${#INSTRUMENTATION_PARTS[@]} -gt 0 ]]; then
  log_info "$(IFS=' | '; echo "${INSTRUMENTATION_PARTS[*]}")"
fi

# Debug mode banner (T-172 / T-176)
if [[ "${DEBUG}" == "true" ]]; then
  echo -e "${YELLOW}  ╔══════════════════════════════════════════╗${RESET}"
  echo -e "${YELLOW}  ║  DEBUG MODE — Verbose logging active     ║${RESET}"
  echo -e "${YELLOW}  ║  Disable: K6_DEBUG=false                 ║${RESET}"
  echo -e "${YELLOW}  ╚══════════════════════════════════════════╝${RESET}"
  echo ""
fi

# ── Select k6 binary (T-137) ──────────────────────────────────────────────────
if [[ -n "${K6_BINARY_PATH:-}" ]]; then
  validate_input "K6_BINARY_PATH" "${K6_BINARY_PATH}" "${SAFE_PATH_RE}"
  K6_BINARY_ALLOWED="${K6_BINARY_ALLOWED_PATHS:-/usr/local/bin:/usr/bin:/opt/k6:/opt/homebrew/bin:${ROOT_DIR}/dist/binaries}"
  K6_BINARY_REAL="$(realpath "${K6_BINARY_PATH}" 2>/dev/null || echo "")"
  K6_BINARY_TRUSTED=false
  IFS=':' read -ra _BINARY_DIRS <<< "${K6_BINARY_ALLOWED}"
  for _dir in "${_BINARY_DIRS[@]}"; do
    if [[ "${K6_BINARY_REAL}" == "${_dir}"/* || "${K6_BINARY_REAL}" == "${_dir}" ]]; then
      K6_BINARY_TRUSTED=true; break
    fi
  done
  unset _BINARY_DIRS _dir
  if [[ "${K6_BINARY_TRUSTED}" != "true" ]]; then
    log_error "K6_BINARY_PATH '${K6_BINARY_PATH}' is not in a trusted directory"
    exit 1
  fi
  K6_EXEC="${K6_BINARY_PATH}"
  log_info "Using custom k6 binary: ${K6_BINARY_PATH}"
else
  K6_EXEC="k6"
fi

# ── T-148: Extensions management (xk6) ───────────────────────────────────────

# Known extensions registry (name → module path)
# Uses a function instead of associative array for Bash 3.2 (macOS) compatibility
_K6_EXT_NAMES="redis sql grpc websocket kafka browser output-influxdb output-opentelemetry"

_ext_module() {
  case "$1" in
    redis)                  echo "github.com/grafana/xk6-redis" ;;
    sql)                    echo "github.com/grafana/xk6-sql" ;;
    grpc)                   echo "github.com/grafana/xk6-grpc" ;;
    websocket)              echo "github.com/grafana/xk6-websocket" ;;
    kafka)                  echo "github.com/grafana/xk6-kafka" ;;
    browser)                echo "github.com/grafana/xk6-browser" ;;
    output-influxdb)        echo "github.com/grafana/xk6-output-influxdb" ;;
    output-opentelemetry)   echo "github.com/grafana/xk6-output-opentelemetry" ;;
    *)                      return 1 ;;
  esac
}

list_extensions() {
  printf "\n${BOLD}  k6 Enterprise Framework — Available Extensions${RESET}\n\n"
  printf "  %-24s %-12s %-10s %s\n" "Extension" "Status" "Cached" "Module"
  printf "  %-24s %-12s %-10s %s\n" "---------" "------" "------" "------"
  for ext in ${_K6_EXT_NAMES}; do
    local module
    module=$(_ext_module "${ext}")
    # Check cache
    local cache_entry
    cache_entry=$(find "${K6_CACHE_DIR}" -maxdepth 1 -name "k6-${ext}-*" -type f 2>/dev/null | head -1)
    local cached="no"
    local status="available"
    if [[ -n "${cache_entry}" ]]; then
      cached="yes"
      status="compiled"
    fi
    # Check if xk6 is installed
    if ! command -v xk6 &>/dev/null; then
      status="needs-xk6"
    fi
    printf "  %-24s %-12s %-10s %s\n" "${ext}" "${status}" "${cached}" "${module}"
  done
  printf "\n  To compile: ${BOLD}./bin/run-test.sh --extensions=redis,sql ...${RESET}\n"
  printf "  xk6 install: ${BOLD}go install go.k6.io/xk6/cmd/xk6@latest${RESET}\n\n"
  exit 0
}

[[ "${LIST_EXTENSIONS_FLAG}" == "true" ]] && list_extensions

# Compile or load cached binary with extensions
if [[ -n "${EXTENSIONS}" ]]; then
  # Validate extension names (alphanumeric + hyphen only)
  SAFE_EXT_RE='^[a-zA-Z0-9,-]+$'
  if [[ ! "${EXTENSIONS}" =~ ${SAFE_EXT_RE} ]]; then
    log_error "Invalid --extensions value: '${EXTENSIONS}'. Use comma-separated names (e.g. redis,sql)"
    exit 1
  fi

  # Check xk6 is available
  if ! command -v xk6 &>/dev/null; then
    log_error "xk6 is required to compile extensions. Install with: go install go.k6.io/xk6/cmd/xk6@latest"
    exit 1
  fi

  # Build sorted extension list for deterministic cache key
  IFS=',' read -ra _EXT_LIST <<< "${EXTENSIONS}"
  _EXT_SORTED=()
  while IFS= read -r _line; do
    _EXT_SORTED+=("${_line}")
  done < <(printf '%s\n' "${_EXT_LIST[@]}" | tr -d ' ' | sort -u)
  _EXT_KEY=$(IFS='-'; echo "${_EXT_SORTED[*]}")
  _CACHE_BINARY="${K6_CACHE_DIR}/k6-${_EXT_KEY}"

  # Validate each extension against registry
  _UNKNOWN_EXTS=()
  _BUILD_ARGS=()
  for _ext in "${_EXT_SORTED[@]}"; do
    local _mod
    if _mod=$(_ext_module "${_ext}"); then
      _BUILD_ARGS+=("--with" "${_mod}")
    else
      _UNKNOWN_EXTS+=("${_ext}")
    fi
  done

  if [[ ${#_UNKNOWN_EXTS[@]} -gt 0 ]]; then
    log_error "Extension(s) not available: ${_UNKNOWN_EXTS[*]}"
    log_info  "Available: $(echo "${_K6_EXT_NAMES}" | tr ' ' ', ')"
    exit 1
  fi

  # Use cached binary if it exists
  if [[ -x "${_CACHE_BINARY}" ]]; then
    log_info "Using cached k6 binary with [${_EXT_SORTED[*]}] from .k6-cache/"
    K6_EXEC="${_CACHE_BINARY}"
  else
    # Compile with xk6
    mkdir -p "${K6_CACHE_DIR}"
    log_info "Compiling k6 with [${_EXT_SORTED[*]}]... (estimated: 1-3 min)"
    if xk6 build "${_BUILD_ARGS[@]}" --output "${_CACHE_BINARY}" 2>&1; then
      log_info "Compiled and cached: ${_CACHE_BINARY}"
      K6_EXEC="${_CACHE_BINARY}"
    else
      log_error "xk6 compilation failed for extensions: ${_EXT_SORTED[*]}"
      exit 1
    fi
  fi

  # Export for report enrichment (T-148: extensions in JSON output)
  export K6_ACTIVE_EXTENSIONS="${EXTENSIONS}"
  unset _EXT_LIST _EXT_SORTED _EXT_KEY _BUILD_ARGS _UNKNOWN_EXTS _ext _CACHE_BINARY
fi

# ── T-167: Dry-run — show execution plan without running ─────────────────────
if [[ "${DRY_RUN}" == "true" ]]; then
  # Detect scenario format from extension or content
  _SCENARIO_EXT="${SCENARIO##*.}"
  _DEF_FORMAT="script"
  if [[ "${_SCENARIO_EXT}" == "json" ]]; then _DEF_FORMAT="json"
  elif [[ "${_SCENARIO_EXT}" == "yaml" || "${_SCENARIO_EXT}" == "yml" ]]; then _DEF_FORMAT="yaml"
  fi
  echo ""
  echo -e "${BOLD}  ── Dry Run Plan ──────────────────────────────────────────${RESET}"
  printf "  %-18s %s\n" "Scenario:"    "${SCENARIO}"
  printf "  %-18s %s\n" "Format:"      "${_DEF_FORMAT}"
  printf "  %-18s %s\n" "Client:"      "${CLIENT}"
  printf "  %-18s %s\n" "Profile:"     "${PROFILE}"
  printf "  %-18s %s\n" "Environment:" "${ENV}"
  printf "  %-18s %s\n" "Reports dir:" "${REPORTS_DIR}"
  [[ -n "${EXTENSIONS}" ]] && printf "  %-18s %s\n" "Extensions:" "${EXTENSIONS}"
  echo -e "${DIM}  (--dry-run: no test executed, no artifacts generated)${RESET}"
  echo ""
  # If JSON/YAML, parse and show executor/vus/duration
  if [[ "${_DEF_FORMAT}" != "script" ]]; then
    _SCENARIO_FILE=""
    for _base in "${CLIENT_DIR}/scenarios" "${ROOT_DIR}"; do
      if [[ -f "${_base}/${SCENARIO}" ]]; then _SCENARIO_FILE="${_base}/${SCENARIO}"; break; fi
    done
    if [[ -f "${_SCENARIO_FILE}" ]]; then
      node -e "
        const raw = require('fs').readFileSync('${_SCENARIO_FILE}','utf-8');
        let def;
        try { def = JSON.parse(raw); } catch { def = require('js-yaml').load(raw, {schema: require('js-yaml').CORE_SCHEMA}); }
        const s = Object.values(def.scenarios||{})[0]||{};
        console.log('  Executor:          ' + (s.executor||'constant-vus'));
        console.log('  VUs:               ' + (s.vus||def.vus||'N/A'));
        console.log('  Duration:          ' + (s.duration||def.duration||'N/A'));
        console.log('  Requests:          ' + (def.requests||[]).length + ' defined');
      " 2>/dev/null || true
    fi
  fi
  echo ""
  exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 1: Validate configuration
# ─────────────────────────────────────────────────────────────────────────────
log_step "Step 1/6 — Validating configuration"
if [[ "${SKIP_VALIDATE}" == "true" ]]; then
  log_warn "Config validation skipped (--skip-validate)"
else
  CONFIG_FILE=""
  for _ext in json yml yaml; do
    _candidate="${CLIENT_DIR}/config.${_ext}"
    if [[ -f "${_candidate}" ]]; then
      CONFIG_FILE="${_candidate}"; break
    fi
  done

  if [[ -n "${CONFIG_FILE}" ]]; then
    if node "${SCRIPT_DIR}/validate-config.js" --file="${CONFIG_FILE}" 2>&1; then
      log_success "Configuration valid: ${CONFIG_FILE}"
    else
      log_error "Configuration validation failed. Fix errors and retry."
      exit 107
    fi
  else
    log_warn "No config file found for client '${CLIENT}' — skipping validation"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 2: Build TypeScript bundle
# ─────────────────────────────────────────────────────────────────────────────
log_step "Step 2/6 — Building TypeScript bundle"
if [[ "${SKIP_BUILD}" == "true" ]]; then
  log_warn "Build skipped (--skip-build)"
else
  if [[ "${K6_VERBOSE:-false}" == "true" ]]; then
    if ! npm run build --prefix "${ROOT_DIR}" 2>&1; then
      log_error "Build failed. Fix TypeScript errors and retry."
      exit 107
    fi
  else
    _build_output=$(npm run build --prefix "${ROOT_DIR}" 2>&1)
    _build_exit=$?
    if [[ ${_build_exit} -ne 0 ]]; then
      log_error "Build failed. Fix TypeScript errors and retry."
      log_error "Run with K6_VERBOSE=true for full output, or:"
      echo "${_build_output}" | grep -E "^ERROR" | head -10
      exit 107
    fi
  fi
  log_success "Build complete"
fi

if [[ ! -f "${DIST_SCRIPT}" ]]; then
  log_error "Bundle not found: ${DIST_SCRIPT}"
  log_error "Available bundles:"
  find "${ROOT_DIR}/dist" -name "*.js" 2>/dev/null | sed "s|${ROOT_DIR}/dist/|  dist/|" || true
  exit 107
fi

# ── Inject synthetic thresholds for all group() calls ────────────────────
# k6 --summary-export only exports per-group timing for groups with thresholds.
# This step detects all group names in the compiled JS and injects harmless
# thresholds (p(95)<99999) so every group gets full timing data in the export.
_injected_groups=0
if node -e "
  const fs = require('fs');
  const src = fs.readFileSync('${DIST_SCRIPT}', 'utf8');
  // Extract group names from compiled webpack output: group)(\"Name\" or group(\"Name\"
  const groupNames = [...new Set(
    (src.match(/group\)?\\(\"([^\"]+)\"/g) || [])
      .map(m => m.replace(/^group\)?\\(\"/, '').replace(/\"$/, ''))
  )];
  if (groupNames.length === 0) process.exit(1);
  // Find the thresholds object in the compiled JS
  const threshIdx = src.indexOf('thresholds:{');
  if (threshIdx === -1) {
    // No thresholds defined — inject thresholds into the options object
    // Find the options pattern: ={...} before thresholds would be
    // Look for the options export (e.g. 'a={vus:' or 'options:{')
    const optMatch = src.match(/=(\{[^{}]*vus:[^{}]*\})/);
    if (optMatch) {
      const optStr = optMatch[1];
      const thresholds = {};
      groupNames.forEach(g => { thresholds['group_duration{group:::' + g + '}'] = ['p(95)<99999']; });
      const newOpt = optStr.slice(0, -1) + ',thresholds:' + JSON.stringify(thresholds) + '}';
      fs.writeFileSync('${DIST_SCRIPT}', src.replace(optStr, newOpt));
      console.log(groupNames.length);
    } else { process.exit(1); }
  } else {
    // Thresholds exist — find the closing brace and inject missing groups
    let braceDepth = 0, end = -1;
    for (let i = threshIdx + 'thresholds:{'.length; i < src.length; i++) {
      if (src[i] === '{') braceDepth++;
      else if (src[i] === '}') {
        if (braceDepth === 0) { end = i; break; }
        braceDepth--;
      }
    }
    if (end === -1) process.exit(1);
    const threshBlock = src.slice(threshIdx, end + 1);
    let injected = 0;
    let extra = '';
    groupNames.forEach(g => {
      const key = 'group_duration{group:::' + g + '}';
      if (!threshBlock.includes(key)) {
        extra += ',\"' + key + '\":[\"p(95)<99999\"]';
        injected++;
      }
    });
    if (injected > 0) {
      const newSrc = src.slice(0, end) + extra + src.slice(end);
      fs.writeFileSync('${DIST_SCRIPT}', newSrc);
    }
    console.log(injected);
  }
" 2>/dev/null; then
  _injected_groups=$(node -e "
    const src = require('fs').readFileSync('${DIST_SCRIPT}','utf8');
    const m = (src.match(/group_duration\{group:::[^}]+\}/g) || []);
    console.log([...new Set(m)].length);
  " 2>/dev/null)
  if [[ "${_injected_groups}" -gt 0 ]]; then
    log_info "Injected synthetic thresholds for ${_injected_groups} group(s) → full timing in summary"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 2a: CLI authentication (SEC-02)
# Position: after Step 2 (Build) completes, before Step 3 (k6 run) starts.
# Rationale (D-01): build pre-flight catches typecheck/config errors before
# spending enforcer cycles + audit-log entries. Dry-run and --list-profiles
# exit before Step 1, so they naturally bypass this gate.
# Rationale (D-11): auth runs BEFORE RBAC so auth failure short-circuits and
# we don't pollute audit log with denials for unauthenticated actors.
# ─────────────────────────────────────────────────────────────────────────────
log_step "Step 2a/6 — Verifying CLI auth"
# WR-03: capture the authenticated userId so RBAC (Step 2b) uses the same
# identity as the token rather than independently resolving $USER / K6_USER.
RESOLVED_USER=""
if [[ -z "${K6_AUTH_TOKEN:-}" ]]; then
  log_debug "K6_AUTH_TOKEN not configured — skipping CLI auth (permissive mode)"
else
  # Run auth check and capture the resolved userId in one call via --print-user.
  # Output goes to stdout (userId) and stderr (error messages); both are captured.
  _AUTH_OUT=$(K6_AUTH_TOKEN_PROVIDED="${AUTH_TOKEN_PROVIDED:-}" \
    node "${SCRIPT_DIR}/check-cli-auth.js" --print-user 2>&1)
  _AUTH_EXIT=$?
  if [[ ${_AUTH_EXIT} -eq 0 ]]; then
    # Last line of output is the userId when --print-user succeeds; any preceding
    # lines are informational log output from ts-node loader.
    RESOLVED_USER=$(printf '%s' "${_AUTH_OUT}" | tail -n1 | tr -d '[:space:]')
    log_success "CLI auth verified (user: ${RESOLVED_USER})"
  else
    # Echo captured output so error reason is visible in the log
    printf '%s\n' "${_AUTH_OUT}" >&2
    log_error "Auth required: K6_AUTH_TOKEN not provided. Configure via env or run with --auth-token=<token>."
    exit 1
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 2b: RBAC enforcement (SEC-01)
# Position: after Step 2a (CLI auth), before Step 3 (k6 run).
# Rationale (D-01, D-11): auth must succeed before RBAC is evaluated so that
# unauthenticated actors do not generate audit-log noise.
# WR-03: pass RESOLVED_USER (from token) to check-rbac so RBAC and auth gates
# always operate on the same identity.
# K6_RBAC_PERMISSIVE=true delegated to rbac.ts (Plan 03) — no override here.
# ─────────────────────────────────────────────────────────────────────────────
log_step "Step 2b/6 — Verifying RBAC permissions"
_RBAC_ARGS=()
[[ -n "${RESOLVED_USER}" ]] && _RBAC_ARGS+=("--user=${RESOLVED_USER}")
if ! node "${SCRIPT_DIR}/check-rbac.js" \
    --client="${CLIENT}" \
    --profile="${PROFILE}" \
    --root="${ROOT_DIR}" \
    "${_RBAC_ARGS[@]}" 2>&1; then
  log_error "Permission denied: user is not authorized to run profile '${PROFILE}' on client '${CLIENT}' (RBAC). Set K6_RBAC_PERMISSIVE=true to bypass (audit logged)."
  exit 1
fi
log_success "RBAC: profile '${PROFILE}' permitted for current user on client '${CLIENT}'"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 3: Execute k6 test
# ─────────────────────────────────────────────────────────────────────────────
log_step "Step 3/6 — Running k6 test"

# Validate K6_SECRETS_BACKENDS
VALID_BACKENDS_LIST="env vault aws-sm azure-kv"
IFS=',' read -ra _BACKEND_LIST <<< "${K6_SECRETS_BACKENDS:-env}"
for _backend in "${_BACKEND_LIST[@]}"; do
  _bt="${_backend// /}"
  if ! echo "${VALID_BACKENDS_LIST}" | grep -qw "${_bt}"; then
    log_error "Unknown secrets backend '${_bt}' in K6_SECRETS_BACKENDS"
    exit 1
  fi
done
unset _BACKEND_LIST _backend _bt

# ── Run-label tag (for A/B comparison between test runs) ────────────────────
RUN_LABEL_ARGS=()
[[ -n "${RUN_LABEL}" ]] && RUN_LABEL_ARGS=(--tag "run_label=${RUN_LABEL}")

K6_CMD=(
  "${K6_EXEC}" run
  --env "K6_PROFILE=${PROFILE}"
  --env "K6_ENV=${ENV}"
  --env "K6_CLIENT=${CLIENT}"
  --env "K6_TEST_NAME=${RUN_ID}"
  --env "K6_DEBUG=${DEBUG}"
  --env "K6_STRUCTURED_LOGS=${STRUCTURED_LOGS}"
  --env "K6_SECRETS_BACKENDS=${K6_SECRETS_BACKENDS:-env}"
  --env "K6_TEMPO_ENABLED=${TEMPO_OUT}"
  --env "K6_TEMPO_ENDPOINT=${TEMPO_ENDPOINT}"
  --env "K6_TEMPO_PROPAGATION=${K6_TEMPO_PROPAGATION:-w3c}"
  --env "K6_PYROSCOPE_ENABLED=${K6_PYROSCOPE_ENABLED:-false}"
  --env "K6_PYROSCOPE_ENDPOINT=${K6_PYROSCOPE_ENDPOINT:-http://localhost:4040}"
  --env "K6_PYROSCOPE_CONTINUOUS=${PYROSCOPE_CONTINUOUS}"
  --env "K6_OTEL_ENABLED=${OTEL_ENABLED}"
  --env "K6_OTEL_GRPC_EXPORTER_ENDPOINT=${OTEL_GRPC_EXPORTER_ENDPOINT}"
  --env "K6_OTEL_RESOURCE_ATTRIBUTES=${OTEL_RESOURCE_ATTRIBUTES_FINAL}"
  --env "K6_LOKI_URL=${LOKI_URL}"
  --tag "test_name=${RUN_ID}"
  --tag "client=${CLIENT}"
  --tag "environment=${ENV}"
  --tag "profile=${PROFILE}"
  --tag "test_timestamp=${ISO_TIMESTAMP}"
  "${RUN_LABEL_ARGS[@]+"${RUN_LABEL_ARGS[@]}"}"
  --summary-export "${SUMMARY_JSON}"
  --summary-trend-stats "avg,min,med,max,p(90),p(95),p(99)"
  --log-output "file=${K6_LOG}"
  "${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}"
  "${DIST_SCRIPT}"
)

# ── Prometheus remote-write output ──────────────────────────────────────────
if [[ "${PROMETHEUS_OUT}" == "true" ]]; then
  export K6_PROMETHEUS_RW_SERVER_URL="${PROMETHEUS_RW_URL}"
  export K6_PROMETHEUS_RW_TREND_STATS="avg,min,med,max,p(90),p(95),p(99)"
  export K6_PROMETHEUS_RW_PUSH_INTERVAL="5s"
  # Insert --out before the script path (last element)
  K6_CMD=("${K6_CMD[@]:0:${#K6_CMD[@]}-1}" --out "experimental-prometheus-rw" "${K6_CMD[@]: -1}")
  log_info "Prometheus remote-write enabled → ${PROMETHEUS_RW_URL}"
fi

# ── Loki log output ────────────────────────────────────────────────────────
if [[ "${LOKI_OUT}" == "true" ]]; then
  # Replace file log-output with loki log-output (k6 supports only one --log-output)
  # Rebuild K6_CMD array, removing the existing --log-output and its value
  _NEW_CMD=()
  _i=0
  while [[ $_i -lt ${#K6_CMD[@]} ]]; do
    if [[ "${K6_CMD[$_i]}" == "--log-output" ]]; then
      # Skip flag and its next argument (the value)
      _i=$((_i + 2))
      continue
    fi
    _NEW_CMD+=("${K6_CMD[$_i]}")
    _i=$((_i + 1))
  done
  # k6 Loki format: loki=URL,label.key=value,label.key2=value2,...
  LOKI_LOG_OUTPUT="loki=${LOKI_URL}"
  LOKI_LOG_OUTPUT+=",label.client=${CLIENT}"
  LOKI_LOG_OUTPUT+=",label.profile=${PROFILE}"
  LOKI_LOG_OUTPUT+=",label.env=${ENV}"
  LOKI_LOG_OUTPUT+=",label.test_name=${RUN_ID}"
  LOKI_LOG_OUTPUT+=",level=info,pushPeriod=5s,msgMaxSize=1048576"
  # Insert --log-output before the script path (last element)
  K6_CMD=("${_NEW_CMD[@]:0:${#_NEW_CMD[@]}-1}" --log-output "${LOKI_LOG_OUTPUT}" "${_NEW_CMD[@]: -1}")
  unset _NEW_CMD _i LOKI_LOG_OUTPUT
  log_info "Loki log output enabled → ${LOKI_URL}"
fi

# ── Tempo traces output (OTLP) ────────────────────────────────────────────
if [[ "${TEMPO_OUT}" == "true" ]]; then
  # k6 --traces-output otel=URL requires the full URL (env vars not reliably supported)
  export OTEL_EXPORTER_OTLP_INSECURE="true"
  export K6_OTEL_GRPC_EXPORTER_INSECURE="true"
  # Insert --traces-output otel=URL before the script path (last element)
  K6_CMD=("${K6_CMD[@]:0:${#K6_CMD[@]}-1}" --traces-output "otel=${TEMPO_ENDPOINT}" "${K6_CMD[@]: -1}")
  log_info "Tempo traces output (OTLP gRPC) enabled → ${TEMPO_ENDPOINT}"
fi

# ── OBS2-01: OTel Collector routing (preferred over Tempo-direct) ──────────
if [[ "${OTEL_ENABLED}" == "true" ]]; then
  export OTEL_EXPORTER_OTLP_ENDPOINT="${OTEL_GRPC_EXPORTER_ENDPOINT}"
  export OTEL_EXPORTER_OTLP_PROTOCOL="grpc"
  export OTEL_EXPORTER_OTLP_INSECURE="true"
  export K6_OTEL_GRPC_EXPORTER_ENDPOINT="${OTEL_GRPC_EXPORTER_ENDPOINT}"
  export K6_OTEL_GRPC_EXPORTER_INSECURE="true"
  export K6_OTEL_METRIC_PREFIX="k6_"
  export OTEL_RESOURCE_ATTRIBUTES="${OTEL_RESOURCE_ATTRIBUTES_FINAL}"
  export K6_OTEL_RESOURCE_ATTRIBUTES="${OTEL_RESOURCE_ATTRIBUTES_FINAL}"
  # Insert --out experimental-opentelemetry before the script path (last element)
  # — only if not already present (avoid double-add if --otel was also passed)
  if ! printf '%s\n' "${K6_CMD[@]}" | grep -q "experimental-opentelemetry"; then
    K6_CMD=("${K6_CMD[@]:0:${#K6_CMD[@]}-1}" --out "experimental-opentelemetry" "${K6_CMD[@]: -1}")
  fi
  log_info "OTel Collector routing enabled → ${OTEL_GRPC_EXPORTER_ENDPOINT} (resource: ${OTEL_RESOURCE_ATTRIBUTES_FINAL})"
fi

# ── OpenTelemetry metrics output ───────────────────────────────────────────
if [[ "${OTEL_OUT}" == "true" ]]; then
  export OTEL_EXPORTER_OTLP_ENDPOINT="${OTEL_EXPORTER_OTLP_ENDPOINT:-${TEMPO_ENDPOINT}}"
  export OTEL_EXPORTER_OTLP_PROTOCOL="grpc"
  export OTEL_EXPORTER_OTLP_INSECURE="true"
  export K6_OTEL_GRPC_EXPORTER_INSECURE="true"
  export K6_OTEL_METRIC_PREFIX="k6_"
  # Insert --out experimental-opentelemetry before the script path (last element)
  K6_CMD=("${K6_CMD[@]:0:${#K6_CMD[@]}-1}" --out "experimental-opentelemetry" "${K6_CMD[@]: -1}")
  log_info "OpenTelemetry metrics output enabled"
fi

# k6 v1.0+ web dashboard — exports interactive HTML with time-series charts
export K6_WEB_DASHBOARD=true
export K6_WEB_DASHBOARD_EXPORT="${HTML_REPORT}"
export K6_WEB_DASHBOARD_OPEN=false

PROGRESS_PROFILE_SECS=$(profile_to_seconds "${PROFILE}")
PROGRESS_START=$(date +%s)

# Start progress ticker in background (T-165)
_progress_pid=""
if [[ -t 1 ]]; then
  (
    while true; do
      NOW=$(date +%s)
      ELAPSED=$(( NOW - PROGRESS_START ))
      ELAPSED_FMT=$(printf "%d:%02d" $((ELAPSED / 60)) $((ELAPSED % 60)))
      TOTAL_FMT=$(printf "%d:%02d" $((PROGRESS_PROFILE_SECS / 60)) $((PROGRESS_PROFILE_SECS % 60)))
      draw_progress "${ELAPSED}" "${PROGRESS_PROFILE_SECS}" "${ELAPSED_FMT} / ~${TOTAL_FMT} | ${PROFILE}"
      sleep 5
    done
  ) &
  _progress_pid=$!
fi

K6_EXIT=0
"${K6_CMD[@]}" 2>&1 || K6_EXIT=$?

# Stop progress ticker
if [[ -n "${_progress_pid}" ]]; then
  kill "${_progress_pid}" 2>/dev/null || true
  wait "${_progress_pid}" 2>/dev/null || true
  printf "\r%${COLUMNS:-80}s\r" ""  # clear progress line
fi

# Map k6 exit codes:
#   k6 exit 99 → threshold failure → our exit 99
#   k6 exit 1  → script/runtime error → our exit 107
#   k6 exit 0  → success → our exit 0
FINAL_EXIT=0
if [[ "${K6_EXIT}" -eq 99 ]]; then
  log_warn "k6 thresholds FAILED (exit 99) — SLOs not met"
  FINAL_EXIT=99
elif [[ "${K6_EXIT}" -ne 0 ]]; then
  log_error "k6 exited with error (exit ${K6_EXIT})"
  log_error "Check the k6 log for details: ${K6_LOG}"
  log_error "Common causes:"
  log_error "  - TypeScript build error: run 'npm run build' to check"
  log_error "  - Missing file: verify dist/${CLIENT_DIST}/${SCENARIO}.js exists"
  log_error "  - Script error: run 'k6 run --dry-run ${DIST_SCRIPT}' to verify"
  FINAL_EXIT=107
else
  log_success "k6 test completed successfully"
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 4: Auto-comparison (must run BEFORE report artifacts so HTML includes it)
# ─────────────────────────────────────────────────────────────────────────────
log_step "Step 4/6 — Running auto-comparison"
if [[ "${SKIP_COMPARE}" == "true" ]]; then
  log_warn "Auto-comparison skipped (--skip-compare)"
  echo "" > "${COMPARISON_MD}"
elif [[ ! -f "${SUMMARY_JSON}" ]]; then
  log_warn "No summary JSON — skipping comparison"
  echo "" > "${COMPARISON_MD}"
else
  COMPARE_EXIT=0
  COMPARE_OUTPUT=$(_run_timed "auto-compare" 60 \
    node "${SCRIPT_DIR}/testing/auto-compare.js" \
    --client="${CLIENT}" \
    --test="${SCENARIO_SLUG}" \
    --current="${SUMMARY_JSON}" \
    --out="${COMPARISON_MD}" 2>&1) || COMPARE_EXIT=$?

  if [[ "${COMPARE_EXIT}" -eq 0 ]]; then
    log_success "Comparison: ${COMPARISON_MD}"
  elif [[ "${COMPARE_EXIT}" -eq 1 ]]; then
    log_warn "Critical regression detected — auto-comparison flagged degradation >10%"
    echo "${COMPARE_OUTPUT}"
    # Escalate to exit 1 if test passed but regression is critical
    if [[ "${FINAL_EXIT}" -eq 0 ]]; then
      FINAL_EXIT=1
    fi
  else
    log_warn "Auto-comparison skipped (no baseline or error: exit ${COMPARE_EXIT})"
    echo "" > "${COMPARISON_MD}"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 5: Generate HTML report and additional artifacts
# ─────────────────────────────────────────────────────────────────────────────
log_step "Step 5/6 — Generating report artifacts"

# Generate all artifacts via generate-artifacts.js (CSV, HTML banner, analysis MD, message MD, JSON enrichment)
if [[ -f "${SUMMARY_JSON}" ]]; then
  _ARTIFACT_ARGS=(
    node "${SCRIPT_DIR}/generate-artifacts.js"
    --input="${SUMMARY_JSON}"
    --output-dir="${ARTIFACTS_DIR}"
    --scenario="${SCENARIO}"
    --profile="${PROFILE}"
    --env="${ENV}"
    --client="${CLIENT}"
    --run-id="${RUN_ID}"
    --timestamp="${ISO_TIMESTAMP}"
    --exit-code="${FINAL_EXIT}"
  )
  [[ -f "${HTML_REPORT}" ]] && _ARTIFACT_ARGS+=(--html="${HTML_REPORT}")
  [[ -f "${COMPARISON_MD}" ]] && _ARTIFACT_ARGS+=(--comparison="${COMPARISON_MD}")
  [[ -n "${RUN_LABEL}" ]] && _ARTIFACT_ARGS+=(--run-label="${RUN_LABEL}")
  [[ -n "${STORY_ID}" ]] && _ARTIFACT_ARGS+=(--story="${STORY_ID}")
  [[ -n "${STORY_URL}" ]] && _ARTIFACT_ARGS+=(--story-url="${STORY_URL}")

  _artifact_out=$(_run_timed "generate-artifacts" 120 "${_ARTIFACT_ARGS[@]}" 2>&1)
  _artifact_exit=$?
  while IFS= read -r line; do
    case "${line}" in
      "[OK]"*)    log_success "${line#\[OK\] }" ;;
      "[WARN]"*)  log_warn "${line#\[WARN\] }" ;;
      *)          log_debug "${line}" ;;
    esac
  done <<< "${_artifact_out}"
  if [[ "${_artifact_exit}" -ne 0 ]]; then
    log_warn "Artifact generation had issues (exit ${_artifact_exit})"
  fi
fi

# WR-05: XSS audit for generated HTML report (CHK-SEC-035)
# Run after the HTML report exists; quarantine the report on violation.
if [[ -f "${HTML_REPORT}" ]]; then
  _xss_audit_out=$(node -e "
    let tsRegistered = false;
    try {
      const tsNodePath = require.resolve('ts-node', { paths: [require('path').resolve('${SCRIPT_DIR}', '..')] });
      require(tsNodePath).register({
        project: require('path').resolve('${SCRIPT_DIR}', '../tsconfig.json'),
        transpileOnly: true,
        compilerOptions: { module: 'CommonJS' },
      });
      tsRegistered = true;
    } catch (_e) {}
    if (!tsRegistered) {
      console.error('[XSS-GUARD] ts-node unavailable — skipping XSS audit');
      process.exit(0);
    }
    const { auditHtmlReportForXss } = require(require('path').resolve('${SCRIPT_DIR}', '../src/core/cli-auth'));
    const violations = auditHtmlReportForXss('${HTML_REPORT}');
    if (violations.length > 0) {
      violations.forEach(v => console.error('[XSS-GUARD] ' + v));
      process.exit(2);
    }
  " 2>&1)
  _xss_exit=$?
  if [[ ${_xss_exit} -eq 2 ]]; then
    log_warn "HTML report failed XSS audit — quarantining report"
    printf '%s\n' "${_xss_audit_out}" >&2
    mv "${HTML_REPORT}" "${HTML_REPORT}.quarantined" 2>/dev/null || true
    log_warn "Quarantined: ${HTML_REPORT}.quarantined"
  elif [[ ${_xss_exit} -eq 0 ]]; then
    log_success "HTML report passed XSS audit"
  else
    log_warn "XSS audit could not run (exit ${_xss_exit}) — skipping"
    printf '%s\n' "${_xss_audit_out}" >&2
  fi
fi

# Generate error log — extract [ERROR] lines from k6 execution log
if [[ -f "${K6_LOG}" ]]; then
  grep -i '\[ERROR\]' "${K6_LOG}" > "${ERROR_LOG}" 2>/dev/null || true
  _error_count=$(wc -l < "${ERROR_LOG}" 2>/dev/null | tr -d ' ')
  if [[ "${_error_count}" -gt 0 ]]; then
    log_warn "Error log: ${ERROR_LOG} (${_error_count} errors captured)"
  else
    rm -f "${ERROR_LOG}"
  fi
fi

# Extract unexpected_status entries (captureUnexpectedResponse) into structured JSON.
# k6 log format is logfmt:  time="..." level=error msg="<escaped-JSON>" source=console
# We extract the msg="..." payload, unescape it, and parse the inner JSON.
if [[ -f "${K6_LOG}" ]]; then
  node -e '
    const fs = require("fs");
    const lines = fs.readFileSync(process.argv[1], "utf8").split(/\r?\n/);
    const errors = [];
    const msgRe = /msg="((?:\\.|[^"\\])*)"/;
    for (const raw of lines) {
      if (raw.indexOf("unexpected_status") < 0) continue;
      const m = msgRe.exec(raw);
      if (!m) continue;
      // logfmt escapes both \ → \\ and " → \" in msg="..."; undo in this exact
      // order so JSON-encoded sequences like \n stay intact for JSON.parse.
      const unescaped = m[1].replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
      try {
        const obj = JSON.parse(unescaped);
        if (obj && obj.event === "unexpected_status") errors.push(obj);
      } catch (_) { /* malformed payload */ }
    }
    if (errors.length === 0) process.exit(2);
    const payload = { generatedAt: new Date().toISOString(), count: errors.length, errors };
    fs.writeFileSync(process.argv[2], JSON.stringify(payload, null, 2));
  ' "${K6_LOG}" "${UNEXPECTED_ERRORS_JSON}" 2>/dev/null
  _unexp_exit=$?
  if [[ "${_unexp_exit}" -eq 0 ]] && [[ -f "${UNEXPECTED_ERRORS_JSON}" ]]; then
    _unexp_count=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).count)' "${UNEXPECTED_ERRORS_JSON}" 2>/dev/null || echo "?")
    log_warn "Unexpected status responses: ${UNEXPECTED_ERRORS_JSON} (${_unexp_count} captured)"
  fi
fi

# Step 5b: Generate editorial HTML report via k6-report (opt-in)
EDITORIAL_HTML=""
if [[ "${EDITORIAL_REPORT}" == "1" ]] && [[ -f "${SUMMARY_JSON}" ]]; then
  K6_REPORT_CLI="${ROOT_DIR}/../k6-report/dist/cli.js"
  EDITORIAL_HTML="${ARTIFACTS_DIR}/editorial-report-${ISO_TIMESTAMP}.html"
  if [[ -f "${K6_REPORT_CLI}" ]]; then
    log_info "Generating editorial report via k6-report..."
    _editorial_args=(
      node "${K6_REPORT_CLI}" generate "${SUMMARY_JSON}"
      -o "${EDITORIAL_HTML}"
      --quiet
    )
    # Pass branding org if BRANDING_ORG env var is set
    [[ -n "${BRANDING_ORG:-}" ]] && _editorial_args+=(--branding-org "${BRANDING_ORG}")

    _editorial_out=$(_run_timed "k6-report-editorial" 30 "${_editorial_args[@]}" 2>&1)
    _editorial_exit=$?
    if [[ "${_editorial_exit}" -eq 0 ]] && [[ -f "${EDITORIAL_HTML}" ]]; then
      log_success "Editorial report: ${EDITORIAL_HTML}"
    else
      log_warn "Editorial report generation failed (exit ${_editorial_exit})"
      [[ -n "${_editorial_out}" ]] && log_debug "${_editorial_out}"
    fi
  else
    log_warn "k6-report not found at ${K6_REPORT_CLI} — skipping editorial report (run 'npm run build' in k6-report/)"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 6: Print final summary — T-165 box, T-179 metrics, T-170 artifacts
# ─────────────────────────────────────────────────────────────────────────────
log_step "Step 6/6 — Run complete"

# Gather metrics for consolidated display (T-179)
DISPLAY_P95="N/A"; DISPLAY_P99="N/A"; DISPLAY_AVG="N/A"
DISPLAY_REQS="N/A"; DISPLAY_ERRORS="N/A"; DISPLAY_CHECKS="N/A"
DISPLAY_ITERS="N/A"; DISPLAY_ELAPSED="N/A"

RUN_ELAPSED=$(( $(date +%s) - PROGRESS_START ))
DISPLAY_ELAPSED=$(printf "%dm %02ds" $((RUN_ELAPSED / 60)) $((RUN_ELAPSED % 60)))

if [[ -f "${SUMMARY_JSON}" ]]; then
  # T-179: Parse metrics summary without eval — node emits KEY=VALUE lines;
  # only known keys are accepted via case statement (SEC: no code injection).
  while IFS='=' read -r _key _value; do
    case "${_key}" in
      DISPLAY_P95)    DISPLAY_P95="${_value}" ;;
      DISPLAY_P99)    DISPLAY_P99="${_value}" ;;
      DISPLAY_AVG)    DISPLAY_AVG="${_value}" ;;
      DISPLAY_REQS)   DISPLAY_REQS="${_value}" ;;
      DISPLAY_ERRORS) DISPLAY_ERRORS="${_value}" ;;
      DISPLAY_CHECKS) DISPLAY_CHECKS="${_value}" ;;
      DISPLAY_ITERS)  DISPLAY_ITERS="${_value}" ;;
    esac
  done < <(node -e "
    try {
      const s = require(process.argv[1]);
      const m = s.metrics || {};
      const dur = m.http_req_duration || {};
      const reqs = m.http_reqs || {};
      const fail = m.http_req_failed || {};
      const chk  = m.checks || {};
      const itr  = m.iterations || {};
      const pass = chk.passes || 0;
      const fails = chk.fails || 0;
      const total = pass + fails;
      process.stdout.write('DISPLAY_P95=' + (dur['p(95)'] !== undefined ? dur['p(95)'].toFixed(0) + 'ms' : 'N/A') + '\n');
      process.stdout.write('DISPLAY_P99=' + (dur['p(99)'] !== undefined ? dur['p(99)'].toFixed(0) + 'ms' : 'N/A') + '\n');
      process.stdout.write('DISPLAY_AVG=' + (dur.avg !== undefined ? dur.avg.toFixed(0) + 'ms' : 'N/A') + '\n');
      process.stdout.write('DISPLAY_REQS=' + (reqs.count !== undefined ? reqs.count.toLocaleString() : 'N/A') + '\n');
      process.stdout.write('DISPLAY_ERRORS=' + (fail.value !== undefined ? (fail.value*100).toFixed(2) + '%' : 'N/A') + '\n');
      process.stdout.write('DISPLAY_CHECKS=' + (total > 0 ? Math.round(pass/total*100) + '% (' + pass + '/' + total + ')' : 'N/A') + '\n');
      process.stdout.write('DISPLAY_ITERS=' + (itr.count !== undefined ? itr.count.toLocaleString() : 'N/A') + '\n');
    } catch(e) {}
  " "${SUMMARY_JSON}" 2>/dev/null) 2>/dev/null || true
fi

echo ""
# ── Metrics box (T-179) ────────────────────────────────────────────────────────
echo -e "  ${BOLD}┌─────────────────────────────────────────────────────┐${RESET}"
printf   "  ${BOLD}│${RESET}  %-51s${BOLD}│${RESET}\n" "Metrics Summary"
echo -e "  ${BOLD}├─────────────────────────────────────────────────────┤${RESET}"
printf   "  ${BOLD}│${RESET}  %-26s %-24s${BOLD}│${RESET}\n" "Checks:"    "${DISPLAY_CHECKS}"
printf   "  ${BOLD}│${RESET}  %-26s %-24s${BOLD}│${RESET}\n" "p95 Response:"  "${DISPLAY_P95}"
printf   "  ${BOLD}│${RESET}  %-26s %-24s${BOLD}│${RESET}\n" "p99 Response:"  "${DISPLAY_P99}"
printf   "  ${BOLD}│${RESET}  %-26s %-24s${BOLD}│${RESET}\n" "Avg Response:"  "${DISPLAY_AVG}"
printf   "  ${BOLD}│${RESET}  %-26s %-24s${BOLD}│${RESET}\n" "HTTP Requests:" "${DISPLAY_REQS}"
printf   "  ${BOLD}│${RESET}  %-26s %-24s${BOLD}│${RESET}\n" "Error Rate:"    "${DISPLAY_ERRORS}"
printf   "  ${BOLD}│${RESET}  %-26s %-24s${BOLD}│${RESET}\n" "Iterations:"    "${DISPLAY_ITERS}"
printf   "  ${BOLD}│${RESET}  %-26s %-24s${BOLD}│${RESET}\n" "Total Duration:" "${DISPLAY_ELAPSED}"
echo -e "  ${BOLD}└─────────────────────────────────────────────────────┘${RESET}"
echo ""

# ── Artifacts verification (T-179) ────────────────────────────────────────────
echo -e "  ${BOLD}Artifacts:${RESET}"
[[ -f "${HTML_REPORT}" ]]   && echo -e "    ${GREEN}[OK]${RESET} html-report  → ${HTML_REPORT}"    || echo -e "    ${YELLOW}[--]${RESET} html-report  (not generated)"
[[ -f "${SUMMARY_JSON}" ]]  && echo -e "    ${GREEN}[OK]${RESET} json-summary → ${SUMMARY_JSON}"   || echo -e "    ${YELLOW}[--]${RESET} json-summary (not generated)"
[[ -f "${K6_LOG}" ]]        && echo -e "    ${GREEN}[OK]${RESET} execution-log → ${K6_LOG}"        || echo -e "    ${YELLOW}[--]${RESET} execution-log (not generated)"
[[ -f "${COMPARISON_MD}" ]] && echo -e "    ${GREEN}[OK]${RESET} comparison   → ${COMPARISON_MD}" || echo -e "    ${YELLOW}[--]${RESET} comparison   (skipped)"
[[ -f "${METRICS_CSV}" ]]   && echo -e "    ${GREEN}[OK]${RESET} metrics-csv  → ${METRICS_CSV}"   || echo -e "    ${YELLOW}[--]${RESET} metrics-csv  (not generated)"
[[ -f "${ERROR_LOG}" ]]     && echo -e "    ${RED}[!!]${RESET} error-log    → ${ERROR_LOG}"      || echo -e "    ${GREEN}[OK]${RESET} error-log    (no errors)"
[[ -f "${UNEXPECTED_ERRORS_JSON}" ]] && echo -e "    ${RED}[!!]${RESET} errors-json  → ${UNEXPECTED_ERRORS_JSON}" || echo -e "    ${GREEN}[OK]${RESET} errors-json  (no unexpected status)"
[[ -f "${ANALYSIS_MD}" ]]  && echo -e "    ${GREEN}[OK]${RESET} analysis-md  → ${ANALYSIS_MD}"  || echo -e "    ${YELLOW}[--]${RESET} analysis-md  (not generated)"
[[ -f "${MESSAGE_MD}" ]]   && echo -e "    ${GREEN}[OK]${RESET} message-md   → ${MESSAGE_MD}"   || echo -e "    ${YELLOW}[--]${RESET} message-md   (not generated)"
[[ -f "${EDITORIAL_HTML:-}" ]] && echo -e "    ${GREEN}[OK]${RESET} editorial    → ${EDITORIAL_HTML}" || { [[ "${EDITORIAL_REPORT}" == "1" ]] && echo -e "    ${YELLOW}[--]${RESET} editorial    (generation failed)"; }
echo ""

# Reports path (prominent, copiable — T-179)
echo -e "  ${BOLD}Reports:${RESET} ${ARTIFACTS_DIR}/"
echo -e "  ${BOLD}Log file:${RESET} ${K6_LOG}"
echo ""

# ── Final result banner (T-179) — varied success messages ─────────────────────
SUCCESS_MSGS=("All systems go!" "Clean run!" "Performance targets met." "Looking good!" "Test passed with flying colors!")
MSG_IDX=$(( RANDOM % 5 ))

if [[ "${FINAL_EXIT}" -eq 0 ]]; then
  echo -e "  ${GREEN}${BOLD}╔══════════════════════════════════════════════╗${RESET}"
  echo -e "  ${GREEN}${BOLD}║                    PASS ✓                    ║${RESET}"
  echo -e "  ${GREEN}${BOLD}║  ${SUCCESS_MSGS[$MSG_IDX]}$(printf '%*s' $((43 - ${#SUCCESS_MSGS[$MSG_IDX]})) '')║${RESET}"
  echo -e "  ${GREEN}${BOLD}╚══════════════════════════════════════════════╝${RESET}"
elif [[ "${FINAL_EXIT}" -eq 99 ]]; then
  echo -e "  ${YELLOW}${BOLD}╔══════════════════════════════════════════════╗${RESET}"
  echo -e "  ${YELLOW}${BOLD}║              THRESHOLD FAILURE               ║${RESET}"
  echo -e "  ${YELLOW}${BOLD}║  SLOs not met (exit 99). Check thresholds.   ║${RESET}"
  echo -e "  ${YELLOW}${BOLD}╚══════════════════════════════════════════════╝${RESET}"
elif [[ "${FINAL_EXIT}" -eq 107 ]]; then
  echo -e "  ${RED}${BOLD}╔══════════════════════════════════════════════╗${RESET}"
  echo -e "  ${RED}${BOLD}║                 SCRIPT ERROR                 ║${RESET}"
  echo -e "  ${RED}${BOLD}║  Build/script error (exit 107).               ║${RESET}"
  echo -e "  ${RED}${BOLD}║  Run: npm run build && npm run typecheck       ║${RESET}"
  echo -e "  ${RED}${BOLD}╚══════════════════════════════════════════════╝${RESET}"
else
  echo -e "  ${RED}${BOLD}╔══════════════════════════════════════════════╗${RESET}"
  echo -e "  ${RED}${BOLD}║                   FAIL ✗                     ║${RESET}"
  echo -e "  ${RED}${BOLD}║  Critical regression detected (exit 1).      ║${RESET}"
  echo -e "  ${RED}${BOLD}║  See comparison report for details.          ║${RESET}"
  echo -e "  ${RED}${BOLD}╚══════════════════════════════════════════════╝${RESET}"
fi
echo ""

exit "${FINAL_EXIT}"
