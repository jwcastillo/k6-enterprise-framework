#!/usr/bin/env bash
# report.sh — Generate HTML performance report from k6 summary JSON
#
# Wraps framework/bin/generate-report.js with input validation, branding
# options, and comparison support. Produces a self-contained HTML dashboard.
#
# Usage:
#   ./bin/report.sh --input=<summary.json> [OPTIONS]
#
# Exit codes:
#   0   success — report generated
#   1   error (missing input, node not found, generator missing, etc.)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
GENERATOR="${ROOT_DIR}/framework/bin/generate-report.js"
FRAMEWORK_VERSION="$(node -e "console.log(require('${ROOT_DIR}/package.json').version)" 2>/dev/null || echo "0.1.0")"

# ── Defaults ──────────────────────────────────────────────────────────────────
INPUT=""
COMPARE=""
OUTPUT=""
ORG_NAME=""
COLOR=""
LOGO=""

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

# ── Banner ────────────────────────────────────────────────────────────────────
print_banner() {
  echo -e "${BOLD}"
  echo "  ╔══════════════════════════════════════════════╗"
  echo "  ║   k6 Framework — Report Generator            ║"
  echo "  ║                  v${FRAMEWORK_VERSION}                      ║"
  echo "  ╚══════════════════════════════════════════════╝"
  echo -e "${RESET}"
}

# ── Help ──────────────────────────────────────────────────────────────────────
print_help() {
  cat <<EOF
${BOLD}k6 Enterprise Framework — report.sh${RESET}

Generate a self-contained HTML performance report from a k6 summary JSON file.
Supports branding customization and comparison against a previous run.

USAGE:
  ./bin/report.sh --input <path> [OPTIONS]

${BOLD}── Required ──────────────────────────────────────────────────────────────${RESET}
  --input <path>       Path to k6 summary JSON file

${BOLD}── Options ───────────────────────────────────────────────────────────────${RESET}
  --compare <path>     Path to previous summary JSON for comparison
  --output <path>      Output HTML file path (default: auto-generated next to input)
  --org-name <name>    Organization name displayed in the report header
  --color <hex>        Primary branding color (default: #2563eb)
  --logo <path>        Path to logo image (PNG/JPG/SVG)
  --help               Show this help and exit

${BOLD}── Examples ──────────────────────────────────────────────────────────────${RESET}
  # Generate report from summary
  ./bin/report.sh --input=reports/summary.json

  # Compare with previous run
  ./bin/report.sh --input=reports/latest.json --compare=reports/baseline.json

  # Branded report
  ./bin/report.sh --input=reports/summary.json \\
    --org-name="Acme Corp" --color="#e63946" --logo=assets/logo.png

  # Custom output path
  ./bin/report.sh --input=reports/summary.json --output=/tmp/report.html

EOF
}

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --input=*)     INPUT="${1#*=}";      shift ;;
    --input)       INPUT="$2";           shift 2 ;;
    --compare=*)   COMPARE="${1#*=}";    shift ;;
    --compare)     COMPARE="$2";         shift 2 ;;
    --output=*)    OUTPUT="${1#*=}";      shift ;;
    --output)      OUTPUT="$2";          shift 2 ;;
    --org-name=*)  ORG_NAME="${1#*=}";   shift ;;
    --org-name)    ORG_NAME="$2";        shift 2 ;;
    --color=*)     COLOR="${1#*=}";       shift ;;
    --color)       COLOR="$2";           shift 2 ;;
    --logo=*)      LOGO="${1#*=}";        shift ;;
    --logo)        LOGO="$2";            shift 2 ;;
    --help|-h)     print_help; exit 0 ;;
    *)
      log_error "Unknown argument: $1"
      echo "  Run ${BOLD}./bin/report.sh --help${RESET} for usage." >&2
      exit 1
      ;;
  esac
done

# ── Banner ────────────────────────────────────────────────────────────────────
print_banner

# ── Step 1: Validate --input ─────────────────────────────────────────────────
log_step "Validating inputs"

if [[ -z "${INPUT}" ]]; then
  log_error "Missing required parameter: --input <path>"
  echo "" >&2
  echo "  Provide the path to a k6 summary JSON file:" >&2
  echo "    ${DIM}./bin/report.sh --input=reports/summary.json${RESET}" >&2
  exit 1
fi

if [[ ! -f "${INPUT}" ]]; then
  log_error "Input file not found: ${INPUT}"
  echo "  Check the path and try again." >&2
  exit 1
fi

if [[ -n "${COMPARE}" && ! -f "${COMPARE}" ]]; then
  log_error "Comparison file not found: ${COMPARE}"
  echo "  Check the path and try again." >&2
  exit 1
fi

if [[ -n "${LOGO}" && ! -f "${LOGO}" ]]; then
  log_warn "Logo file not found: ${LOGO} — report will be generated without logo"
  LOGO=""
fi

log_success "Input file exists: ${INPUT}"

# ── Step 2: Check node ───────────────────────────────────────────────────────
log_step "Checking prerequisites"

if ! command -v node &>/dev/null; then
  log_error "Node.js is not installed or not in PATH"
  echo "  Install Node.js (>= 18) and try again:" >&2
  echo "    ${DIM}brew install node${RESET}  or  ${DIM}nvm install 18${RESET}" >&2
  exit 1
fi

NODE_VERSION="$(node --version)"
log_success "Node.js found: ${NODE_VERSION}"

# ── Step 3: Check generator script ──────────────────────────────────────────
if [[ ! -f "${GENERATOR}" ]]; then
  log_error "Report generator not found: ${GENERATOR}"
  echo "  The framework may need to be updated. Try:" >&2
  echo "    ${DIM}./bin/update-framework.sh${RESET}" >&2
  exit 1
fi

log_success "Generator script found"

# ── Step 4: Build command ────────────────────────────────────────────────────
log_step "Generating report"

CMD_ARGS=("node" "${GENERATOR}" "--input=${INPUT}")

if [[ -n "${COMPARE}" ]]; then
  CMD_ARGS+=("--compare=${COMPARE}")
fi

if [[ -n "${OUTPUT}" ]]; then
  CMD_ARGS+=("--output=${OUTPUT}")
fi

if [[ -n "${ORG_NAME}" ]]; then
  CMD_ARGS+=("--org-name=${ORG_NAME}")
fi

if [[ -n "${COLOR}" ]]; then
  CMD_ARGS+=("--color=${COLOR}")
fi

if [[ -n "${LOGO}" ]]; then
  CMD_ARGS+=("--logo=${LOGO}")
fi

log_info "Command: ${DIM}${CMD_ARGS[*]}${RESET}"

# ── Step 5: Execute generator ────────────────────────────────────────────────
REPORT_OUTPUT=""
if REPORT_OUTPUT=$("${CMD_ARGS[@]}" 2>&1); then
  # The generator prints the output file path on the last line
  REPORT_PATH="$(echo "${REPORT_OUTPUT}" | tail -n 1)"

  echo ""
  log_success "Report generated successfully"

  if [[ -n "${REPORT_PATH}" && -f "${REPORT_PATH}" ]]; then
    REPORT_SIZE="$(du -h "${REPORT_PATH}" | cut -f1 | tr -d ' ')"
    log_info "File: ${BOLD}${REPORT_PATH}${RESET}"
    log_info "Size: ${REPORT_SIZE}"
  else
    # Generator did not return a valid file path — print raw output
    log_info "Output: ${REPORT_OUTPUT}"
  fi

  if [[ -n "${COMPARE}" ]]; then
    log_info "Comparison baseline: ${COMPARE}"
  fi

  echo ""
  echo -e "  ${DIM}Open in browser:${RESET}"
  if [[ -n "${REPORT_PATH}" && -f "${REPORT_PATH}" ]]; then
    echo -e "    ${CYAN}open ${REPORT_PATH}${RESET}"
  fi
  echo ""
else
  EXIT_CODE=$?
  log_error "Report generation failed (exit code ${EXIT_CODE})"
  if [[ -n "${REPORT_OUTPUT}" ]]; then
    echo "" >&2
    echo "${REPORT_OUTPUT}" >&2
  fi
  exit 1
fi
