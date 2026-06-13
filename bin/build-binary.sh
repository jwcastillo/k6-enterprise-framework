#!/usr/bin/env bash
# build-binary.sh — Compile client solution into a self-contained binary (T-034)
#
# The binary embeds all compiled JS bundles for the target client using
# Go's //go:embed. No external files are needed at runtime.
#
# Usage:
#   ./bin/build-binary.sh --client examples [--platform linux/amd64] [--verify]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
EMBED_DIR="${ROOT_DIR}/cmd/k6-embedded"

# ── Defaults ──────────────────────────────────────────────────────────────────
CLIENT=""
PLATFORM=""
VERIFY="false"
OUTPUT_DIR=""
K6_VERSION="v1.6.1"

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'

log_info()    { echo -e "${BLUE}[BUILD]${RESET}  $*"; }
log_success() { echo -e "${GREEN}[OK]${RESET}     $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${RESET}   $*"; }
log_error()   { echo -e "${RED}[ERROR]${RESET}  $*" >&2; }

print_help() {
  cat <<EOF
${BOLD}k6 Enterprise Framework — build-binary.sh${RESET}

Compile a client's load testing solution into a self-contained binary.
All JS bundles are embedded in the binary — no external files needed at runtime.

USAGE:
  ./bin/build-binary.sh --client <name> [OPTIONS]

OPTIONS:
  --client <name>      Client to compile (required)
  --platform <os/arch> Target platform (default: current host)
                       Supported: linux/amd64, linux/arm64, darwin/amd64, darwin/arm64
  --output <dir>       Output directory (default: dist/binaries/{client}/{os}_{arch}/)
  --verify             Run source protection verification after build
  --k6-version <ver>   k6 version to embed (default: ${K6_VERSION})
  --help               Show this help

PREREQUISITES:
  - Go >= 1.21  (detected via PATH or asdf)
  - Node.js + npm

EXAMPLES:
  ./bin/build-binary.sh --client examples
  ./bin/build-binary.sh --client examples --platform linux/amd64 --verify
  ./bin/build-binary.sh --client examples --platform darwin/arm64

OUTPUT:
  dist/binaries/{client}/{os}_{arch}/k6-{client}           Binary
  dist/binaries/{client}/{os}_{arch}/k6-{client}.sha256    Checksum
  dist/binaries/{client}/{os}_{arch}/build-metadata.json   Build metadata

RUNTIME USAGE:
  ./k6-{client} list-scripts
  ./k6-{client} run embedded://api/01-auth-bearer
  ./k6-{client} run embedded://integration/12-websocket
EOF
}

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --client)      CLIENT="$2";      shift 2 ;;
    --platform)    PLATFORM="$2";    shift 2 ;;
    --output)      OUTPUT_DIR="$2";  shift 2 ;;
    --verify)      VERIFY="true";    shift   ;;
    --k6-version)  K6_VERSION="$2";  shift 2 ;;
    --help|-h)     print_help; exit 0 ;;
    --client=*)    CLIENT="${1#--client=}";     shift ;;
    --platform=*)  PLATFORM="${1#--platform=}"; shift ;;
    --output=*)    OUTPUT_DIR="${1#--output=}"; shift ;;
    *)             log_warn "Unknown option: $1"; shift ;;
  esac
done

# ── Resolve Go binary ──────────────────────────────────────────────────────────
# Support asdf-managed Go without requiring shell integration
resolve_go() {
  if command -v go &>/dev/null && GO111MODULE=on go version &>/dev/null 2>&1; then
    echo "go"; return
  fi
  # asdf fallback
  local asdf_go
  asdf_go="$(asdf where golang 2>/dev/null)/go/bin/go"
  if [[ -x "${asdf_go}" ]]; then
    echo "${asdf_go}"; return
  fi
  log_error "Go not found. Install Go >= 1.21 or configure asdf."
  exit 1
}

GO_BIN="$(resolve_go)"
export PATH="$(dirname "${GO_BIN}"):${HOME}/go/bin:${PATH}"
export GO111MODULE=on
# Use local module cache as primary proxy to avoid network calls for cached modules
export GOPROXY="file://${HOME}/go/pkg/mod/cache/download,https://proxy.golang.org,direct"
# Skip sum check for the local embed module (no VCS)
export GONOSUMDB="k6-embedded"
export GONOSUMCHECK="k6-embedded"
export GOFLAGS=""

# ── Validate inputs ───────────────────────────────────────────────────────────
if [[ -z "${CLIENT}" ]]; then
  log_error "Client name is required. Use --client <name>"
  exit 1
fi

# Validate client name: alphanumerics, hyphens, underscores only
if [[ ! "${CLIENT}" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  log_error "Invalid client name '${CLIENT}'. Only alphanumerics, hyphens and underscores are allowed."
  exit 1
fi

CLIENT_DIR="${ROOT_DIR}/clients/${CLIENT}"
if [[ ! -d "${CLIENT_DIR}" ]]; then
  log_error "Client directory not found: clients/${CLIENT}"
  exit 1
fi

if [[ ! -f "${CLIENT_DIR}/config/default.json" ]]; then
  log_error "Client '${CLIENT}' missing required config/default.json"
  exit 1
fi

# Resolve platform
if [[ -z "${PLATFORM}" ]]; then
  HOST_OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
  HOST_ARCH="$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')"
  PLATFORM="${HOST_OS}/${HOST_ARCH}"
fi

VALID_PLATFORMS="linux/amd64 linux/arm64 darwin/amd64 darwin/arm64"
if [[ ! " ${VALID_PLATFORMS} " == *" ${PLATFORM} "* ]]; then
  log_error "Unsupported platform '${PLATFORM}'. Supported: ${VALID_PLATFORMS}"
  exit 1
fi

IFS='/' read -r TARGET_OS TARGET_ARCH <<< "${PLATFORM}"

# Validate platform value after parsing (defense against injection)
if [[ ! "${TARGET_OS}" =~ ^[a-z]+$ ]] || [[ ! "${TARGET_ARCH}" =~ ^[a-z0-9]+$ ]]; then
  log_error "Invalid platform components: os='${TARGET_OS}' arch='${TARGET_ARCH}'"
  exit 1
fi

# Output directory
if [[ -z "${OUTPUT_DIR}" ]]; then
  OUTPUT_DIR="${ROOT_DIR}/dist/binaries/${CLIENT}/${TARGET_OS}_${TARGET_ARCH}"
fi

# Validate output dir is under ROOT_DIR (prevent path traversal)
REAL_ROOT="$(realpath "${ROOT_DIR}")"
# realpath -m (--no-newline, allow missing) not available on macOS — use manual check
NORMALIZED_OUTPUT="$(cd "${ROOT_DIR}" && python3 -c "import os,sys; print(os.path.realpath(sys.argv[1]))" "${OUTPUT_DIR}" 2>/dev/null || echo "${OUTPUT_DIR}")"
if [[ "${NORMALIZED_OUTPUT}" != "${REAL_ROOT}"* ]]; then
  log_error "Output directory '${OUTPUT_DIR}' is outside the project root."
  exit 1
fi

BINARY_NAME="k6-${CLIENT}"

# ── Prerequisites ─────────────────────────────────────────────────────────────
for cmd in node npm; do
  if ! command -v "${cmd}" &>/dev/null; then
    log_error "Required command '${cmd}' not found in PATH"
    exit 1
  fi
done

# ── Header ────────────────────────────────────────────────────────────────────
echo -e "${BOLD}"
echo "  ╔══════════════════════════════════════════════╗"
echo "  ║     k6 Enterprise — Binary Compilation       ║"
echo "  ╚══════════════════════════════════════════════╝"
echo -e "${RESET}"
echo -e "  Client:    ${BOLD}${CLIENT}${RESET}"
echo -e "  Platform:  ${BOLD}${TARGET_OS}/${TARGET_ARCH}${RESET}"
echo -e "  k6:        ${BOLD}${K6_VERSION}${RESET}"
echo -e "  Output:    ${BOLD}${OUTPUT_DIR}/${BINARY_NAME}${RESET}"
echo ""

# ── Step 1: TypeScript build ──────────────────────────────────────────────────
log_info "Step 1/5: Building TypeScript bundle..."
if ! npm run build --prefix "${ROOT_DIR}" 2>&1; then
  log_error "TypeScript build failed."
  exit 1
fi

# Determine the dist subdirectory for this client
# _reference → reference, _benchmark → benchmark, others → as-is
DIST_CLIENT="${CLIENT#_}"
DIST_DIR="${ROOT_DIR}/dist/${DIST_CLIENT}"

if [[ ! -d "${DIST_DIR}" ]]; then
  log_error "Expected dist directory not found: dist/${DIST_CLIENT}"
  log_error "Check that clients/${CLIENT}/scenarios/ has at least one .ts file."
  exit 1
fi

SCRIPT_COUNT=$(find "${DIST_DIR}" -name "*.js" | wc -l | tr -d ' ')
if [[ "${SCRIPT_COUNT}" -eq 0 ]]; then
  log_error "No compiled JS found in dist/${DIST_CLIENT}/"
  exit 1
fi
log_success "TypeScript bundle compiled (${SCRIPT_COUNT} scripts in dist/${DIST_CLIENT}/)"

# ── Step 2: Stage scripts + data into embed dir ──────────────────────────────
log_info "Step 2/5: Staging scripts and data for embedding..."

SCRIPTS_DIR="${EMBED_DIR}/scripts"
DATA_DIR="${EMBED_DIR}/data"

# Clean previous client's scripts (not the .keep sentinel)
find "${SCRIPTS_DIR}" -name "*.js" -delete 2>/dev/null || true
# Clean previous data files (not .keep)
find "${DATA_DIR}" -type f ! -name ".keep" -delete 2>/dev/null || true

# Copy compiled bundles preserving subdirectory structure
cp -r "${DIST_DIR}/." "${SCRIPTS_DIR}/"

EMBEDDED_COUNT=$(find "${SCRIPTS_DIR}" -name "*.js" | wc -l | tr -d ' ')
log_success "Staged ${EMBEDDED_COUNT} scripts into cmd/k6-embedded/scripts/"

# Copy data files for open() support at runtime
CLIENT_DATA_DIR="${CLIENT_DIR}/data"
DATA_FILE_COUNT=0
if [[ -d "${CLIENT_DATA_DIR}" ]]; then
  cp -r "${CLIENT_DATA_DIR}/." "${DATA_DIR}/"
  DATA_FILE_COUNT=$(find "${DATA_DIR}" -type f ! -name ".keep" | wc -l | tr -d ' ')
  log_success "Staged ${DATA_FILE_COUNT} data files into cmd/k6-embedded/data/"
else
  log_info "No data/ directory found for client '${CLIENT}' — skipping"
fi

# ── Step 3: Generate entrypoint ───────────────────────────────────────────────
log_info "Step 3/5: Generating entrypoint..."

ENTRYPOINT_DIR="${EMBED_DIR}/entrypoint"
mkdir -p "${ENTRYPOINT_DIR}"

# Generate main.go from template (substitute CLIENT_ID)
sed "s/{{CLIENT_ID}}/${CLIENT}/g" \
  "${ENTRYPOINT_DIR}/main.go.tpl" \
  > "${ENTRYPOINT_DIR}/main.go"

# Generate go.mod for the entrypoint
cat > "${ENTRYPOINT_DIR}/go.mod" <<GOMOD
module k6-entrypoint

go ${GO_MINOR_VERSION:-1.23}

require (
    go.k6.io/k6 ${K6_VERSION}
    k6-embedded v0.0.0
)

replace k6-embedded => ../
GOMOD

# Resolve actual go minor version
GO_MINOR_VERSION="$(${GO_BIN} version | grep -oE 'go[0-9]+\.[0-9]+' | head -1 | sed 's/go//')"
sed -i.bak "s/go \${GO_MINOR_VERSION:-1.23}/go ${GO_MINOR_VERSION}/" "${ENTRYPOINT_DIR}/go.mod"
rm -f "${ENTRYPOINT_DIR}/go.mod.bak"

log_success "Entrypoint generated"

# ── Step 4: Resolve dependencies ──────────────────────────────────────────────
log_info "Step 4/5: Resolving Go dependencies..."

# First ensure the embed module's own go.sum is up to date
cd "${EMBED_DIR}"
"${GO_BIN}" mod tidy 2>&1 || {
  log_error "go mod tidy failed for k6-embedded"
  exit 1
}

# Then tidy the entrypoint
cd "${ENTRYPOINT_DIR}"
"${GO_BIN}" mod tidy 2>&1 || {
  log_error "go mod tidy failed for k6-entrypoint"
  exit 1
}

log_success "Dependencies resolved"

# ── Step 5: Compile binary ────────────────────────────────────────────────────
log_info "Step 5/5: Compiling binary (${TARGET_OS}/${TARGET_ARCH})..."

mkdir -p "${OUTPUT_DIR}"

GOOS="${TARGET_OS}" \
GOARCH="${TARGET_ARCH}" \
CGO_ENABLED=0 \
"${GO_BIN}" build \
  -trimpath \
  -ldflags="-s -w" \
  -o "${OUTPUT_DIR}/${BINARY_NAME}" \
  . 2>&1 || {
  log_error "go build failed"
  exit 1
}

# Return to root
cd "${ROOT_DIR}"

log_success "Binary compiled: ${OUTPUT_DIR}/${BINARY_NAME}"

# ── Metadata and checksum ─────────────────────────────────────────────────────
COMMIT_HASH=$(git -C "${ROOT_DIR}" rev-parse --short HEAD 2>/dev/null || echo "unknown")
CLIENT_VERSION=$(node -e \
  "try{console.log(JSON.parse(require('fs').readFileSync('${CLIENT_DIR}/config/default.json','utf8')).version||'0.0.0')}catch(e){console.log('0.0.0')}" \
  2>/dev/null || echo "0.0.0")
BINARY_SIZE=$(du -sh "${OUTPUT_DIR}/${BINARY_NAME}" 2>/dev/null | cut -f1 || echo "unknown")

cat > "${OUTPUT_DIR}/build-metadata.json" <<EOF
{
  "coreVersion": "0.1.0",
  "clientVersion": "${CLIENT_VERSION}",
  "clientId": "${CLIENT}",
  "k6Version": "${K6_VERSION}",
  "buildDate": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "commitHash": "${COMMIT_HASH}",
  "platform": "${TARGET_OS}/${TARGET_ARCH}",
  "embeddedScripts": ${EMBEDDED_COUNT},
  "embeddedDataFiles": ${DATA_FILE_COUNT},
  "binarySize": "${BINARY_SIZE}"
}
EOF

(cd "${OUTPUT_DIR}" && shasum -a 256 "${BINARY_NAME}" > "${BINARY_NAME}.sha256")

# ── Smoke test ────────────────────────────────────────────────────────────────
HOST_OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
HOST_ARCH="$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')"
if [[ "${TARGET_OS}" == "${HOST_OS}" && "${TARGET_ARCH}" == "${HOST_ARCH}" ]]; then
  if "${OUTPUT_DIR}/${BINARY_NAME}" version &>/dev/null 2>&1; then
    log_success "Smoke test passed — binary responds to 'version'"
  else
    log_warn "Binary built but 'version' command returned non-zero"
  fi

  # Verify list-scripts works
  SCRIPT_LIST=$("${OUTPUT_DIR}/${BINARY_NAME}" list-scripts 2>&1 || true)
  if echo "${SCRIPT_LIST}" | grep -q "embedded://"; then
    LISTED=$(echo "${SCRIPT_LIST}" | grep -c "embedded://" || true)
    log_success "list-scripts: ${LISTED} scripts available"
  else
    log_warn "list-scripts returned unexpected output"
  fi
else
  log_info "Cross-compilation — skipping smoke test (target: ${PLATFORM})"
fi

# ── Optional verification ─────────────────────────────────────────────────────
if [[ "${VERIFY}" == "true" ]]; then
  log_info "Running source protection verification..."
  if [[ -x "${SCRIPT_DIR}/verify-binary.sh" ]]; then
    "${SCRIPT_DIR}/verify-binary.sh" --binary "${OUTPUT_DIR}/${BINARY_NAME}" || true
  else
    log_warn "verify-binary.sh not found — skipping"
  fi
fi

# ── T-137: Clean Go build cache to avoid embedding credentials in cached artifacts ──
log_info "Cleaning Go build cache (T-137)..."
"${GO_BIN}" clean -cache 2>/dev/null || true
# Clean intermediate embed staging so next build starts fresh
find "${SCRIPTS_DIR}" -name "*.js" -delete 2>/dev/null || true
find "${DATA_DIR}" -type f ! -name ".keep" -delete 2>/dev/null || true
log_success "Build cache and staged scripts/data cleaned"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}Build complete!${RESET}"
echo -e "  Binary:    ${BOLD}${OUTPUT_DIR}/${BINARY_NAME}${RESET}  (${BINARY_SIZE})"
echo -e "  Scripts:   ${BOLD}${EMBEDDED_COUNT} embedded${RESET}"
echo -e "  Checksum:  ${OUTPUT_DIR}/${BINARY_NAME}.sha256"
echo -e "  Metadata:  ${OUTPUT_DIR}/build-metadata.json"
echo ""
echo -e "  List scripts:  ${BOLD}./${BINARY_NAME} list-scripts${RESET}"
echo -e "  Run script:    ${BOLD}./${BINARY_NAME} run embedded://api/01-auth-bearer${RESET}"
echo -e "  Verify:        ${BOLD}shasum -a 256 -c ${BINARY_NAME}.sha256${RESET}"
