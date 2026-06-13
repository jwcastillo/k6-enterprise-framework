#!/usr/bin/env bash
# update-k6-digest.sh — Refresh K6_VERSION_DIGEST in infrastructure/k8s/Dockerfile (SEC-08)
#
# Pulls a grafana/k6 image by tag, extracts its SHA256 digest from the local Docker
# daemon, and updates the ARG K6_VERSION_DIGEST default in the Dockerfile via sed.
# This ensures the committed Dockerfile always pins a REAL, pullable digest —
# never a placeholder.
#
# Usage:
#   ./bin/update-k6-digest.sh [--tag=<version>] [--dry-run] [--help]
#
# PREREQUISITES:
#   - docker must be in PATH
#
# EXAMPLES:
#   ./bin/update-k6-digest.sh --tag=0.54.0
#   ./bin/update-k6-digest.sh --tag=0.55.0 --dry-run
#   ./bin/update-k6-digest.sh  # uses K6_VERSION env or defaults to 0.54.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DOCKERFILE_PATH="${ROOT_DIR}/infrastructure/k8s/Dockerfile"

# ── Defaults ──────────────────────────────────────────────────────────────────
TAG="${K6_VERSION:-0.54.0}"
DRY_RUN="false"

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'

log_info()    { echo -e "${BLUE}[DIGEST]${RESET}  $*"; }
log_success() { echo -e "${GREEN}[OK]${RESET}      $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${RESET}    $*"; }
log_error()   { echo -e "${RED}[ERROR]${RESET}   $*" >&2; }

print_help() {
  cat <<EOF
${BOLD}k6 Enterprise Framework — update-k6-digest.sh${RESET}

Pull grafana/k6:<tag> and update ARG K6_VERSION_DIGEST in infrastructure/k8s/Dockerfile.
Idempotent: re-running with the same tag produces no net change.
The .bak file left by sed can be deleted after verifying the update.

USAGE:
  ./bin/update-k6-digest.sh [OPTIONS]

OPTIONS:
  --tag=<version>   k6 image tag to resolve (default: \${K6_VERSION:-0.54.0})
  --tag <version>   alternate form (space-separated)
  --dry-run         Show the proposed digest without modifying the Dockerfile
  --help            Show this help

PREREQUISITES:
  - docker must be in PATH (exit 1 if missing)

EXAMPLES:
  ./bin/update-k6-digest.sh --tag=0.54.0
  ./bin/update-k6-digest.sh --tag=0.55.0 --dry-run
  K6_VERSION=0.54.0 ./bin/update-k6-digest.sh

SED PATTERN:
  Targets: ARG K6_VERSION_DIGEST=sha256:<exactly-64-hex-chars>
  Replaces any 64-char hex digest (placeholder zeros OR a previously-set real digest).
  After running: delete infrastructure/k8s/Dockerfile.bak if no longer needed.

NOTES:
  - SEC-08: Digest-pinned base image — prevents tag-mutable image substitution.
  - Call this script before committing Dockerfile changes involving a new k6 version.
  - Renovate / CI automation can invoke this script in a scheduled job.
EOF
}

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag=*)   TAG="${1#--tag=}";  shift ;;
    --tag)     TAG="$2";           shift 2 ;;
    --dry-run) DRY_RUN="true";     shift ;;
    --help|-h) print_help; exit 0 ;;
    *)
      log_error "Unknown option: $1"
      echo "Run './bin/update-k6-digest.sh --help' for usage." >&2
      exit 1
      ;;
  esac
done

# ── Validation ────────────────────────────────────────────────────────────────

# WR-04: Validate --tag before interpolating into docker commands.
# Docker tag charset: alphanumeric, dot, underscore, hyphen, colon, forward-slash.
# Reject anything outside this set to prevent shell injection or unexpected glob
# expansion if the quoting context ever changes.
if [[ ! "${TAG}" =~ ^[a-zA-Z0-9._:/-]+$ ]]; then
  log_error "Invalid --tag value: '${TAG}'. Only alphanumeric, dot, underscore, colon, hyphen, and slash are allowed."
  exit 1
fi

# Step 1: docker must be in PATH
command -v docker >/dev/null 2>&1 || {
  log_error "docker not found in PATH."
  log_error "Install Docker and ensure 'docker' is on PATH, then re-run."
  exit 1
}

# Verify Dockerfile exists
if [[ ! -f "${DOCKERFILE_PATH}" ]]; then
  log_error "Dockerfile not found at: ${DOCKERFILE_PATH}"
  exit 1
fi

log_info "Resolving digest for grafana/k6:${TAG} ..."

# Step 2: Pull the image
if ! docker pull "grafana/k6:${TAG}"; then
  log_error "Failed to pull grafana/k6:${TAG}. Check tag name and network connectivity."
  exit 1
fi

# Step 3: Extract digest from local image inspect
RAW_DIGEST=$(docker image inspect "grafana/k6:${TAG}" --format='{{index .RepoDigests 0}}' 2>/dev/null || true)

if [[ -z "${RAW_DIGEST}" ]]; then
  log_error "Could not retrieve RepoDigests for grafana/k6:${TAG}. Image may not have been pushed with digest."
  exit 1
fi

# Parse the sha256:<hex> portion from the full repo@digest string
DIGEST=$(echo "${RAW_DIGEST}" | sed -n 's/.*@\(sha256:[a-f0-9]\{64\}\).*/\1/p')

# Step 4: Validate the digest format
if ! echo "${DIGEST}" | grep -qE '^sha256:[a-f0-9]{64}$'; then
  log_error "Extracted digest does not match expected format sha256:<64 hex chars>."
  log_error "Got: '${DIGEST}'"
  exit 1
fi

log_info "Resolved digest: ${DIGEST}"

# Step 5: Dry-run exits here
if [[ "${DRY_RUN}" == "true" ]]; then
  log_info "[dry-run] Would update Dockerfile ARG K6_VERSION_DIGEST to: ${DIGEST}"
  log_info "[dry-run] No files modified."
  exit 0
fi

# Step 6: Idempotent sed replacement
# Matches ANY 64-hex-char sha256 value in the ARG line (placeholder zeros OR a real digest).
# Cross-platform: -i.bak works on both BSD (macOS) and GNU sed.
sed -i.bak -E \
  "s|^ARG K6_VERSION_DIGEST=sha256:[a-f0-9]{64}\$|ARG K6_VERSION_DIGEST=${DIGEST}|" \
  "${DOCKERFILE_PATH}"

# Step 7: Verify the replacement was applied
if ! grep -qE "^ARG K6_VERSION_DIGEST=${DIGEST}\$" "${DOCKERFILE_PATH}"; then
  log_error "sed replacement failed — ARG K6_VERSION_DIGEST not updated in Dockerfile."
  log_error "Check that the Dockerfile contains the expected ARG line and re-run."
  exit 1
fi

# Step 8: Show diff (exit 0 even if no change — idempotent case)
log_info "Diff (Dockerfile.bak → Dockerfile):"
diff "${DOCKERFILE_PATH}.bak" "${DOCKERFILE_PATH}" || true

# Step 9: Success
log_success "Updated K6_VERSION_DIGEST to ${DIGEST}"
log_info "Dockerfile.bak left for reference — delete when satisfied: rm ${DOCKERFILE_PATH}.bak"
