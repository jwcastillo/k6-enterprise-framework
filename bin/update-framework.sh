#!/usr/bin/env bash
# update-framework.sh — Update vendorized framework core in a standalone repo
#
# T-314: Copies src/, shared/, and bin/ from the monorepo into framework/
# without touching client files (config, lib, scenarios).
#
# Usage:
#   ./bin/update-framework.sh --from=/path/to/k6-enterprise-framework
#   ./bin/update-framework.sh --from=github:org/repo
#   ./bin/update-framework.sh --from=github:org/repo --ref=v1.2.0
#
# This script is meant to be run FROM the standalone repo root.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'
CYAN='\033[0;36m'; DIM='\033[2m'

if [[ ! -t 1 ]]; then
  RED=''; GREEN=''; YELLOW=''; BLUE=''; BOLD=''; RESET=''; CYAN=''; DIM=''
fi

log_info()    { echo -e "${BLUE}[INFO]${RESET}  $*"; }
log_success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
log_error()   { echo -e "${RED}[ERROR]${RESET} $*" >&2; }
log_step()    { echo -e "${CYAN}[STEP]${RESET}  $*"; }

# ── Cleanup trap ─────────────────────────────────────────────────────────────
TEMP_DIR=""
cleanup() {
  if [[ -n "${TEMP_DIR}" && -d "${TEMP_DIR}" ]]; then
    rm -rf "${TEMP_DIR}"
  fi
}
trap cleanup EXIT

# ── Help ──────────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<EOF
${BOLD}update-framework.sh — Update vendorized framework core${RESET}

USAGE:
  ./bin/update-framework.sh --from=<source> [OPTIONS]

SOURCES:
  --from <path>              Local path to the k6-enterprise-framework monorepo
  --from github:<org>/<repo> GitHub repository (cloned via git)

OPTIONS:
  --ref <branch|tag|sha>     Git ref to checkout (default: main). Only for github: source
  --yes                      Skip confirmation prompt
  --help                     Show this help

EXAMPLES:
  # From local monorepo
  ./bin/update-framework.sh --from=/path/to/k6-enterprise-framework

  # From GitHub (latest main)
  ./bin/update-framework.sh --from=github:my-org/k6-enterprise-framework

  # From GitHub (specific tag)
  ./bin/update-framework.sh --from=github:my-org/k6-enterprise-framework --ref=v1.2.0

  # From GitHub (specific branch, auto-confirm)
  ./bin/update-framework.sh --from=github:my-org/k6-enterprise-framework --ref=develop --yes

WHAT GETS UPDATED:
  framework/src/            <- monorepo/src/
  framework/shared/         <- monorepo/shared/profiles/ + shared/schemas/
  framework/bin/            <- monorepo/bin/validate-config.js + testing/
  framework/VERSION         <- monorepo package.json version

WHAT IS NOT TOUCHED:
  config/  data/  lib/  scenarios/  package.json  tsconfig.json  webpack.config.js

EOF
  exit 0
fi

# ── Parse args ────────────────────────────────────────────────────────────────
FROM_ARG=""
GIT_REF="main"
AUTO_YES="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from=*)   FROM_ARG="${1#*=}"; shift ;;
    --from)     FROM_ARG="$2"; shift 2 ;;
    --ref=*)    GIT_REF="${1#*=}"; shift ;;
    --ref)      GIT_REF="$2"; shift 2 ;;
    --yes|-y)   AUTO_YES="true"; shift ;;
    *)          log_error "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Validate ──────────────────────────────────────────────────────────────────
FW_DIR="${ROOT_DIR}/framework"

if [[ ! -d "${FW_DIR}" ]]; then
  log_error "No framework/ directory found. This script must be run from a standalone repo root."
  exit 1
fi

if [[ -z "${FROM_ARG}" ]]; then
  log_error "No source specified. Use --from=/path/to/monorepo or --from=github:org/repo"
  exit 1
fi

# ── Resolve source (local or GitHub) ─────────────────────────────────────────
MONOREPO_PATH=""
SOURCE_LABEL=""

if [[ "${FROM_ARG}" == github:* ]]; then
  # ── GitHub mode ────────────────────────────────────────────────────────────
  GITHUB_REPO="${FROM_ARG#github:}"

  # Validate format: org/repo
  if [[ ! "${GITHUB_REPO}" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]]; then
    log_error "Invalid GitHub repository format: ${GITHUB_REPO}"
    log_error "Expected format: github:org/repo-name"
    exit 1
  fi

  # Check git is available
  if ! command -v git &>/dev/null; then
    log_error "git is not installed. Required for GitHub source."
    exit 1
  fi

  TEMP_DIR="$(mktemp -d)"
  CLONE_URL="https://github.com/${GITHUB_REPO}.git"
  SOURCE_LABEL="github:${GITHUB_REPO}@${GIT_REF}"

  echo ""
  log_step "Cloning ${BOLD}${GITHUB_REPO}${RESET} (ref: ${GREEN}${GIT_REF}${RESET})..."

  if ! git clone --depth=1 --branch="${GIT_REF}" --single-branch "${CLONE_URL}" "${TEMP_DIR}/repo" 2>&1; then
    log_error "Failed to clone ${CLONE_URL} (ref: ${GIT_REF})"
    log_error "Check that the repository exists and the ref is valid."
    exit 1
  fi

  MONOREPO_PATH="${TEMP_DIR}/repo"
  log_success "Cloned ${GITHUB_REPO}@${GIT_REF}"

else
  # ── Local mode ─────────────────────────────────────────────────────────────
  MONOREPO_PATH="${FROM_ARG}"
  SOURCE_LABEL="local:${MONOREPO_PATH}"

  # Resolve to absolute
  if [[ "${MONOREPO_PATH}" != /* ]]; then
    MONOREPO_PATH="$(pwd)/${MONOREPO_PATH}"
  fi
fi

# ── Validate monorepo structure ──────────────────────────────────────────────
if [[ ! -d "${MONOREPO_PATH}/src" ]]; then
  log_error "Invalid monorepo at: ${MONOREPO_PATH}"
  log_error "Expected to find src/ directory inside it."
  exit 1
fi

CURRENT_VERSION=$(cat "${FW_DIR}/VERSION" 2>/dev/null || echo "unknown")
NEW_VERSION=$(node -e "console.log(require('${MONOREPO_PATH}/package.json').version)" 2>/dev/null || echo "unknown")

echo ""
echo -e "${BOLD}  Framework Update${RESET}"
echo -e "  Current version: ${YELLOW}${CURRENT_VERSION}${RESET}"
echo -e "  New version:     ${GREEN}${NEW_VERSION}${RESET}"
echo -e "  Source:          ${SOURCE_LABEL}"
echo ""

# Summary of changes
log_step "Checking differences..."
SRC_CHANGES=$(diff -rq "${FW_DIR}/src" "${MONOREPO_PATH}/src" 2>/dev/null | wc -l | tr -d ' ')
PROFILE_CHANGES=0
if [[ -d "${MONOREPO_PATH}/shared/profiles" ]]; then
  PROFILE_CHANGES=$(diff -rq "${FW_DIR}/shared/profiles" "${MONOREPO_PATH}/shared/profiles" 2>/dev/null | wc -l | tr -d ' ')
fi
SCHEMA_CHANGES=0
if [[ -d "${MONOREPO_PATH}/shared/schemas" ]]; then
  SCHEMA_CHANGES=$(diff -rq "${FW_DIR}/shared/schemas" "${MONOREPO_PATH}/shared/schemas" 2>/dev/null | wc -l | tr -d ' ')
fi

TOTAL_CHANGES=$((SRC_CHANGES + PROFILE_CHANGES + SCHEMA_CHANGES))

echo -e "  src/:     ${BOLD}${SRC_CHANGES}${RESET} file changes"
echo -e "  profiles/: ${BOLD}${PROFILE_CHANGES}${RESET} file changes"
echo -e "  schemas/:  ${BOLD}${SCHEMA_CHANGES}${RESET} file changes"
echo -e "  Total:    ${BOLD}${TOTAL_CHANGES}${RESET} changes"
echo ""

if [[ "${TOTAL_CHANGES}" -eq 0 ]]; then
  log_success "Framework is already up to date"
  exit 0
fi

# Confirm
if [[ "${AUTO_YES}" != "true" ]]; then
  read -rp "Apply ${TOTAL_CHANGES} changes? [y/N] " CONFIRM
  if [[ "${CONFIRM}" != "y" && "${CONFIRM}" != "Y" ]]; then
    log_info "Update cancelled"
    exit 0
  fi
fi

# ── Apply updates ─────────────────────────────────────────────────────────────
log_step "Updating framework/src/..."
rm -rf "${FW_DIR}/src"
cp -R "${MONOREPO_PATH}/src" "${FW_DIR}/src"
log_success "src/ updated"

if [[ -d "${MONOREPO_PATH}/shared/profiles" ]]; then
  log_step "Updating framework/shared/profiles/..."
  rm -rf "${FW_DIR}/shared/profiles"
  cp -R "${MONOREPO_PATH}/shared/profiles" "${FW_DIR}/shared/profiles"
  log_success "shared/profiles/ updated"
fi

if [[ -d "${MONOREPO_PATH}/shared/schemas" ]]; then
  log_step "Updating framework/shared/schemas/..."
  rm -rf "${FW_DIR}/shared/schemas"
  cp -R "${MONOREPO_PATH}/shared/schemas" "${FW_DIR}/shared/schemas"
  log_success "shared/schemas/ updated"
fi

# bin/ utilities
for f in validate-config.js validate-config-schema.json; do
  if [[ -f "${MONOREPO_PATH}/bin/${f}" ]]; then
    cp "${MONOREPO_PATH}/bin/${f}" "${FW_DIR}/bin/${f}"
  fi
done
if [[ -d "${MONOREPO_PATH}/bin/testing" ]]; then
  mkdir -p "${FW_DIR}/bin/testing"
  cp "${MONOREPO_PATH}/bin/testing/"* "${FW_DIR}/bin/testing/" 2>/dev/null || true
fi
log_success "bin/ updated"

# Update VERSION
echo "${NEW_VERSION}" > "${FW_DIR}/VERSION"

echo ""
log_success "Framework updated: ${YELLOW}${CURRENT_VERSION}${RESET} -> ${GREEN}${NEW_VERSION}${RESET}"
echo ""
echo -e "  ${BOLD}Next steps:${RESET}"
echo -e "    npm run typecheck   # verify no breaking changes"
echo -e "    npm run build       # rebuild bundles"
echo ""
