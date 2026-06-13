#!/usr/bin/env bash
# bin/run-regression.sh — Nightly regression suite runner
#
# Usage:
#   ./bin/run-regression.sh --suite=nightly --client=myClient
#   ./bin/run-regression.sh --suite=weekly-full --client=myClient --env=staging
#
# Exit codes:
#   0  — No regressions detected (all tests within thresholds)
#   1  — Significant regressions detected (>= deviation_threshold)
#   99 — Critical regressions detected (>= 2x deviation_threshold)
#
# Environment variables:
#   NOTIFY_SLACK_WEBHOOK   — Slack incoming webhook URL
#   NOTIFY_EMAIL_TO        — Email recipient(s), comma-separated
#   NOTIFY_WEBHOOK_URL     — Generic webhook URL
#   K6_BINARY              — Path to k6 binary (default: k6)
#   REPORTS_DIR            — Reports output directory (default: ./reports)
#
# Schedule examples:
#   GitHub Actions:  schedule: cron('0 2 * * *')  → see .github/workflows/perf-regression.yml
#   GitLab CI:       rules: - if: $CI_PIPELINE_SOURCE == "schedule"  → see ci-templates/.gitlab-ci-perf.yml
#   Cron (system):   0 2 * * * /path/to/run-regression.sh --suite=nightly --client=myClient

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
SUITE=""
CLIENT=""
ENV="staging"
NOTIFY=""
K6_BINARY="${K6_BINARY:-k6}"
REPORTS_DIR="${REPORTS_DIR:-./reports}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRAMEWORK_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
EXIT_CODE=0

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ── Parse arguments ───────────────────────────────────────────────────────────
for arg in "$@"; do
  case $arg in
    --suite=*)    SUITE="${arg#*=}"  ;;
    --client=*)   CLIENT="${arg#*=}" ;;
    --env=*)      ENV="${arg#*=}"    ;;
    --notify=*)   NOTIFY="${arg#*=}" ;;
    --help|-h)
      echo "Usage: $0 --suite=<name> --client=<name> [--env=<env>] [--notify=<channels>]"
      echo ""
      echo "Options:"
      echo "  --suite=<name>     Regression suite name (matches regression-suite.json in client config)"
      echo "  --client=<name>    Client name (directory under clients/)"
      echo "  --env=<env>        Environment (default: staging)"
      echo "  --notify=<channels> Override notification channels (slack,email,webhook or none)"
      echo ""
      echo "Exit codes:"
      echo "  0   No regressions"
      echo "  1   Significant regressions (>= threshold)"
      echo "  99  Critical regressions (>= 2x threshold)"
      exit 0
      ;;
    *)
      echo -e "${RED}[ERROR]${NC} Unknown argument: $arg"
      exit 2
      ;;
  esac
done

# ── Validate required args ────────────────────────────────────────────────────
if [[ -z "$SUITE" ]]; then
  echo -e "${RED}[ERROR]${NC} --suite is required"
  echo "Usage: $0 --suite=<name> --client=<name>"
  exit 2
fi

if [[ -z "$CLIENT" ]]; then
  echo -e "${RED}[ERROR]${NC} --client is required"
  echo "Usage: $0 --suite=<name> --client=<name>"
  exit 2
fi

# ── Validate client directory ─────────────────────────────────────────────────
CLIENT_DIR="${FRAMEWORK_DIR}/clients/${CLIENT}"
if [[ ! -d "$CLIENT_DIR" ]]; then
  echo -e "${RED}[ERROR]${NC} Client directory not found: ${CLIENT_DIR}"
  exit 2
fi

# ── Locate regression suite config ───────────────────────────────────────────
SUITE_CONFIG=""
for ext in json yaml yml; do
  candidate="${CLIENT_DIR}/regression/${SUITE}.${ext}"
  if [[ -f "$candidate" ]]; then
    SUITE_CONFIG="$candidate"
    break
  fi
done

if [[ -z "$SUITE_CONFIG" ]]; then
  echo -e "${RED}[ERROR]${NC} Regression suite config not found: ${CLIENT_DIR}/regression/${SUITE}.{json,yaml,yml}"
  exit 2
fi

# ── Create reports directory ──────────────────────────────────────────────────
REPORT_DIR="${REPORTS_DIR}/${CLIENT}/regression"
mkdir -p "$REPORT_DIR"
REPORT_FILE="${REPORT_DIR}/regression-${SUITE}-${TIMESTAMP}.json"
REPORT_HTML="${REPORT_DIR}/regression-${SUITE}-${TIMESTAMP}.html"

# ── Banner ────────────────────────────────────────────────────────────────────
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  k6 Framework — Regression Suite Runner${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  Client:    ${CLIENT}"
echo -e "  Suite:     ${SUITE}"
echo -e "  Env:       ${ENV}"
echo -e "  Config:    ${SUITE_CONFIG}"
echo -e "  Report:    ${REPORT_FILE}"
echo -e "  Timestamp: ${TIMESTAMP}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# ── Check k6 binary ───────────────────────────────────────────────────────────
if ! command -v "$K6_BINARY" &>/dev/null; then
  echo -e "${RED}[ERROR]${NC} k6 binary not found: ${K6_BINARY}"
  echo "Install k6 or set K6_BINARY env var to point to your k6 binary."
  exit 2
fi

# ── Build notify flag ─────────────────────────────────────────────────────────
NOTIFY_FLAG=""
if [[ -n "$NOTIFY" ]]; then
  NOTIFY_FLAG="--notify=${NOTIFY}"
fi

# ── Run regression suite ──────────────────────────────────────────────────────
echo -e "[$(date +%H:%M:%S)] ${CYAN}Starting regression suite: ${SUITE}${NC}"

set +e  # allow non-zero exit from k6 run
"$K6_BINARY" run \
  --out json="${REPORT_FILE}" \
  --config "${SUITE_CONFIG}" \
  --client "${CLIENT}" \
  --env "${ENV}" \
  --regression-suite "${SUITE}" \
  ${NOTIFY_FLAG} \
  "${FRAMEWORK_DIR}/src/core/regression-runner.ts" 2>&1
K6_EXIT=$?
set -e

# ── Interpret exit code ───────────────────────────────────────────────────────
case $K6_EXIT in
  0)
    echo -e ""
    echo -e "${GREEN}[PASS]${NC} Regression suite completed — no regressions detected"
    EXIT_CODE=0
    ;;
  1)
    echo -e ""
    echo -e "${YELLOW}[WARN]${NC} Regression suite completed — significant regressions detected"
    EXIT_CODE=1
    ;;
  99)
    echo -e ""
    echo -e "${RED}[FAIL]${NC} Regression suite completed — CRITICAL regressions detected"
    EXIT_CODE=99
    ;;
  2)
    echo -e ""
    echo -e "${RED}[ERROR]${NC} Regression suite execution error (exit code 2)"
    EXIT_CODE=2
    ;;
  *)
    echo -e ""
    echo -e "${RED}[ERROR]${NC} Unexpected exit code from k6: ${K6_EXIT}"
    EXIT_CODE=2
    ;;
esac

# ── Generate HTML report ──────────────────────────────────────────────────────
if [[ -f "$REPORT_FILE" ]]; then
  echo ""
  echo -e "[$(date +%H:%M:%S)] Generating HTML report..."
  node "${FRAMEWORK_DIR}/bin/generate-report.js" \
    --input "${REPORT_FILE}" \
    --output "${REPORT_HTML}" \
    --type regression 2>/dev/null || true
  if [[ -f "$REPORT_HTML" ]]; then
    echo -e "[$(date +%H:%M:%S)] Report saved: ${REPORT_HTML}"
  fi
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  Suite:    ${SUITE}"
echo -e "  Client:   ${CLIENT}"
echo -e "  Finished: $(date +%Y-%m-%dT%H:%M:%S)"
if [[ -f "$REPORT_HTML" ]]; then
  echo -e "  Report:   ${REPORT_HTML}"
else
  echo -e "  Report:   ${REPORT_FILE}"
fi
case $EXIT_CODE in
  0)  echo -e "  Status:   ${GREEN}PASS — no regressions${NC}" ;;
  1)  echo -e "  Status:   ${YELLOW}WARN — significant regressions${NC}" ;;
  99) echo -e "  Status:   ${RED}FAIL — critical regressions${NC}" ;;
  *)  echo -e "  Status:   ${RED}ERROR — execution failed${NC}" ;;
esac
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

exit $EXIT_CODE
