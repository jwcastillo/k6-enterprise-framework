#!/usr/bin/env bash
# export-client.sh — Export a client from the monorepo into a standalone repo
#
# T-301..T-309 (Phase 1): Creates a fully independent repository containing
# a single client + vendorized framework core. The standalone repo compiles,
# typechecks, and runs tests without the monorepo.
#
# Pipeline:
#   Step 1: Validate inputs (client exists, output path OK)
#   Step 2: Copy client files + framework core
#   Step 3: Rewrite imports (../../../src/ → ../framework/src/)
#   Step 4: Generate config files (package.json, tsconfig, webpack, etc.)
#   Step 5: Post-export validation (npm install + typecheck)
#
# Usage: ./bin/export-client.sh --client <name> --output <path>
# See --help for all options.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CLIENTS_DIR="${ROOT_DIR}/clients"
FRAMEWORK_VERSION="$(node -e "console.log(require('${ROOT_DIR}/package.json').version)" 2>/dev/null || echo "0.1.0")"

# ── Defaults ──────────────────────────────────────────────────────────────────
CLIENT=""
OUTPUT_DIR=""
FORCE="false"
SKIP_VALIDATE="false"
DEBUG="false"
NEW_CLIENT="false"
SERVICE_NAME="api"
GIT_INIT="false"
CI_PROVIDER="none"
DRY_RUN="false"

# ── Capability flags ──
WITH_REPORTS="false"
WITH_OBSERVABILITY="false"
WITH_BINARY="false"
WITH_CLAUDE="false"
WITH_MCP="false"

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'
CYAN='\033[0;36m'; MAGENTA='\033[0;35m'; DIM='\033[2m'

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

# ── Banner ────────────────────────────────────────────────────────────────────
print_banner() {
  echo -e "${BOLD}"
  echo "  ╔══════════════════════════════════════════════╗"
  echo "  ║   k6 Enterprise Framework — Client Export    ║"
  echo "  ║                  v${FRAMEWORK_VERSION}                      ║"
  echo "  ╚══════════════════════════════════════════════╝"
  echo -e "${RESET}"
}

# ── Help ──────────────────────────────────────────────────────────────────────
print_help() {
  cat <<EOF
${BOLD}k6 Enterprise Framework — export-client.sh${RESET}

Export a client from the monorepo into a standalone, self-contained repository
that compiles and runs tests independently.

USAGE:
  ./bin/export-client.sh --client <name> --output <path> [OPTIONS]

${BOLD}── Required ──────────────────────────────────────────────────────────────${RESET}
  --client <name>      Client directory name under clients/
                       Available: $(ls "${CLIENTS_DIR}" 2>/dev/null | tr '\n' ' ')
  --output <path>      Output directory for the standalone repo

${BOLD}── Options ───────────────────────────────────────────────────────────────${RESET}
  --new                Create a new client (scaffolding) and export as standalone
  --service <name>     Service name for --new scaffolding (default: api)
  --force              Overwrite output directory if it exists
  --skip-validate      Skip post-export validation (npm install + typecheck)
  --git-init           Initialize git repo with initial commit
  --ci <provider>      Generate CI workflow: github, gitlab, or none (default: none)
  --dry-run            Show what would be exported without creating files
  --debug              Enable verbose debug logging
  --help               Show this help and exit

${BOLD}── Capabilities ──────────────────────────────────────────────────────────${RESET}
  --with-reports       Include bin/report.sh and HTML report generator
  --with-observability Include infrastructure/ (Grafana + Prometheus + dashboards)
  --with-binary        Include bin/build-binary.sh and Go embed modules
  --with-claude        Include .claude/ configuration (CLAUDE.md + settings)
  --with-mcp           Include standalone MCP server
  --full               Enable all capabilities above

${BOLD}── Examples ──────────────────────────────────────────────────────────────${RESET}
  # Export existing client
  ./bin/export-client.sh --client=my-client --output=/tmp/my-client-standalone

  # Create new client from scratch as standalone
  ./bin/export-client.sh --client=payments-team --new --service=payments --output=/tmp/payments

  # Export with git init and GitHub Actions CI
  ./bin/export-client.sh --client=_reference --output=/tmp/ref --git-init --ci=github

  # Preview without creating files
  ./bin/export-client.sh --client=_reference --output=/tmp/test --dry-run

${BOLD}── Standalone Layout ─────────────────────────────────────────────────────${RESET}
  <output>/
  ├── framework/           Framework core (vendorized)
  │   ├── src/             Helpers, patterns, core modules
  │   ├── shared/          Profiles and schemas
  │   └── bin/             Validation scripts
  ├── config/              Client configuration
  ├── data/                Test data files
  ├── lib/                 Client services and factories
  ├── scenarios/           k6 test scenarios
  ├── bin/run-test.sh      Standalone test runner
  ├── package.json         Generated
  ├── tsconfig.json        Generated
  └── webpack.config.js    Generated

EOF
}

# ── Input sanitization ────────────────────────────────────────────────────────
SAFE_NAME_RE='^[a-zA-Z0-9_.-]+$'

validate_name() {
  local name="$1" value="$2"
  if [[ -z "${value}" ]]; then
    log_error "Parameter ${name} is required"
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
  if [[ ! "${value}" =~ ${SAFE_NAME_RE} ]]; then
    log_error "Invalid value for ${name}: '${value}'"
    log_error "Only letters, numbers, hyphens, underscores, and dots are allowed."
    exit 1
  fi
}

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --client=*)        CLIENT="${1#*=}";         shift ;;
    --client)          CLIENT="$2";              shift 2 ;;
    --output=*)        OUTPUT_DIR="${1#*=}";      shift ;;
    --output)          OUTPUT_DIR="$2";          shift 2 ;;
    --new)             NEW_CLIENT="true";        shift ;;
    --service=*)       SERVICE_NAME="${1#*=}";   shift ;;
    --service)         SERVICE_NAME="$2";        shift 2 ;;
    --force)           FORCE="true";             shift ;;
    --skip-validate)   SKIP_VALIDATE="true";     shift ;;
    --git-init)        GIT_INIT="true";          shift ;;
    --ci=*)            CI_PROVIDER="${1#*=}";     shift ;;
    --ci)              CI_PROVIDER="$2";         shift 2 ;;
    --dry-run)         DRY_RUN="true";           shift ;;
    --debug)           DEBUG="true";             shift ;;
    --with-reports)      WITH_REPORTS="true";      shift ;;
    --with-observability) WITH_OBSERVABILITY="true"; shift ;;
    --with-binary)       WITH_BINARY="true";        shift ;;
    --with-claude)       WITH_CLAUDE="true";        shift ;;
    --with-mcp)          WITH_MCP="true";           shift ;;
    --full)              WITH_REPORTS="true"; WITH_OBSERVABILITY="true"; WITH_BINARY="true"; WITH_CLAUDE="true"; WITH_MCP="true"; shift ;;
    --help|-h)         print_help; exit 0 ;;
    *)                 log_error "Unknown option: $1 (use --help for usage)"; exit 1 ;;
  esac
done

# ── Validate inputs ──────────────────────────────────────────────────────────
print_banner

if [[ -z "${CLIENT}" ]]; then
  log_error "No client specified. Use --client <name>"
  echo ""
  echo -e "  ${BOLD}Available clients:${RESET}"
  ls "${CLIENTS_DIR}" 2>/dev/null | sed 's/^/    /'
  echo ""
  exit 1
fi

if [[ -z "${OUTPUT_DIR}" ]]; then
  log_error "No output directory specified. Use --output <path>"
  echo ""
  echo -e "  ${BOLD}Example:${RESET}"
  echo -e "    ./bin/export-client.sh --client=${CLIENT} --output=/tmp/${CLIENT}-standalone"
  echo ""
  exit 1
fi

validate_name "--client" "${CLIENT}"

# Validate --ci provider
if [[ "${CI_PROVIDER}" != "none" && "${CI_PROVIDER}" != "github" && "${CI_PROVIDER}" != "gitlab" ]]; then
  log_error "Invalid CI provider: '${CI_PROVIDER}'. Use: github, gitlab, or none"
  exit 1
fi

# ── T-310: --new scaffolding ─────────────────────────────────────────────────
TEMP_CLIENT_DIR=""
CLIENT_DIR="${CLIENTS_DIR}/${CLIENT}"

if [[ "${NEW_CLIENT}" == "true" ]]; then
  # New client: scaffold temporarily
  if [[ -d "${CLIENT_DIR}" ]]; then
    log_error "Client '${CLIENT}' already exists in the monorepo."
    log_error "To export an existing client, remove --new."
    exit 1
  fi

  validate_name "--service" "${SERVICE_NAME}"

  # Create temporary scaffolding directory
  TEMP_CLIENT_DIR=$(mktemp -d)
  CLIENT_DIR="${TEMP_CLIENT_DIR}"
  trap 'rm -rf "${TEMP_CLIENT_DIR}"' EXIT

  log_info "Scaffolding new client '${CLIENT}' with service '${SERVICE_NAME}'..."

  # PascalCase helper
  pascal_case() { echo "$1" | sed -E 's/(^|[-_])([a-z])/\U\2/g'; }
  SERVICE_CLASS=$(pascal_case "${SERVICE_NAME}")

  # Create directory structure
  mkdir -p "${CLIENT_DIR}/config" "${CLIENT_DIR}/data" \
           "${CLIENT_DIR}/lib/services" "${CLIENT_DIR}/lib/factories" \
           "${CLIENT_DIR}/scenarios/api" "${CLIENT_DIR}/scenarios/integration" \
           "${CLIENT_DIR}/scenarios/mixed"

  # config/default.json
  cat > "${CLIENT_DIR}/config/default.json" << CFGEOF
{
  "version": "1.0",
  "client": "${CLIENT}",
  "description": "${CLIENT} load tests",
  "services": {
    "${SERVICE_NAME}": {
      "baseUrl": "\${__ENV.BASE_URL}",
      "timeout": 10000,
      "headers": {
        "Content-Type": "application/json",
        "Accept": "application/json"
      }
    }
  },
  "defaultProfile": "smoke",
  "reporting": {
    "branding": {
      "clientName": "${CLIENT}",
      "primaryColor": "#0066cc"
    }
  }
}
CFGEOF

  # config/staging.json
  cat > "${CLIENT_DIR}/config/staging.json" << CFGEOF
{
  "version": "1.0",
  "client": "${CLIENT}",
  "environment": "staging",
  "services": {
    "${SERVICE_NAME}": {
      "baseUrl": "\${__ENV.STAGING_BASE_URL}",
      "timeout": 15000
    }
  }
}
CFGEOF

  # config/production.json
  cat > "${CLIENT_DIR}/config/production.json" << CFGEOF
{
  "version": "1.0",
  "client": "${CLIENT}",
  "environment": "production",
  "services": {
    "${SERVICE_NAME}": {
      "baseUrl": "\${__ENV.PROD_BASE_URL}",
      "timeout": 10000
    }
  }
}
CFGEOF

  # lib/services/<service>.service.ts
  cat > "${CLIENT_DIR}/lib/services/${SERVICE_NAME}.service.ts" << SVCEOF
/**
 * ${SERVICE_CLASS}Service — HTTP wrapper for the ${SERVICE_NAME} API
 */

import { RequestHelper, SafeResponse } from "../../../src/helpers/request-helper";

export class ${SERVICE_CLASS}Service {
  private api: RequestHelper;

  constructor(baseUrl: string) {
    this.api = new RequestHelper(baseUrl);
  }

  list(): SafeResponse {
    return this.api.get("/api/${SERVICE_NAME}");
  }

  getById(id: string | number): SafeResponse {
    return this.api.get(\`/api/${SERVICE_NAME}/\${id}\`);
  }

  create(payload: Record<string, unknown>): SafeResponse {
    return this.api.post("/api/${SERVICE_NAME}", payload);
  }
}
SVCEOF

  # scenarios/api/smoke-<service>.ts
  cat > "${CLIENT_DIR}/scenarios/api/smoke-${SERVICE_NAME}.ts" << SCENEOF
/**
 * smoke-${SERVICE_NAME} — Quick health check for ${SERVICE_NAME} service
 *
 * Run:
 *   ./bin/run-test.sh --scenario=api/smoke-${SERVICE_NAME} --profile=smoke
 */

import http from "k6/http";
import { check } from "k6";

export const options = {
  vus: 1,
  duration: "30s",
  thresholds: {
    http_req_duration: ["p(95)<500"],
    http_req_failed: ["rate<0.01"],
  },
};

export default function () {
  const res = http.get(\`\${__ENV["BASE_URL"]}/api/${SERVICE_NAME}\`);
  check(res, {
    "status is 200": (r) => r.status === 200,
    "response time < 500ms": (r) => r.timings.duration < 500,
  });
}
SCENEOF

  log_success "New client scaffolded (temp)"
else
  # Existing client: verify it exists
  if [[ ! -d "${CLIENT_DIR}" ]]; then
    log_error "Client '${CLIENT}' not found at ${CLIENT_DIR}"
    echo ""
    echo -e "  ${BOLD}Available clients:${RESET}"
    ls "${CLIENTS_DIR}" 2>/dev/null | sed 's/^/    /'
    echo -e "\n  Use ${BOLD}--new${RESET} to create a new client from scratch."
    echo ""
    exit 1
  fi
fi

# Resolve output to absolute path
if [[ "${OUTPUT_DIR}" != /* ]]; then
  OUTPUT_DIR="$(pwd)/${OUTPUT_DIR}"
fi

if [[ -d "${OUTPUT_DIR}" ]]; then
  if [[ "${FORCE}" == "true" ]]; then
    log_warn "Output directory exists — will overwrite (--force)"
    rm -rf "${OUTPUT_DIR}"
  else
    log_error "Output directory already exists: ${OUTPUT_DIR}"
    log_error "Use --force to overwrite, or choose a different path."
    exit 1
  fi
fi

log_info "Client:    ${BOLD}${CLIENT}${RESET}"
log_info "Output:    ${BOLD}${OUTPUT_DIR}${RESET}"
log_info "Framework: ${BOLD}v${FRAMEWORK_VERSION}${RESET}"
[[ "${NEW_CLIENT}" == "true" ]] && log_info "Mode:      ${BOLD}New client (--new)${RESET}"
[[ "${GIT_INIT}" == "true" ]] && log_info "Git:       ${BOLD}--git-init${RESET}"
[[ "${CI_PROVIDER}" != "none" ]] && log_info "CI:        ${BOLD}${CI_PROVIDER}${RESET}"
echo ""

# ── T-315: Dry-run ───────────────────────────────────────────────────────────
if [[ "${DRY_RUN}" == "true" ]]; then
  echo -e "${BOLD}── Dry-run: Export Plan ──${RESET}"
  echo ""

  # Count client files
  if [[ -d "${CLIENT_DIR}/scenarios" ]]; then
    DRY_SCENARIOS=$(find "${CLIENT_DIR}/scenarios" -name "*.ts" -type f | wc -l | tr -d ' ')
  else
    DRY_SCENARIOS=0
  fi
  DRY_CLIENT_FILES=$(find "${CLIENT_DIR}" -type f 2>/dev/null | wc -l | tr -d ' ')
  DRY_FW_FILES=$(find "${ROOT_DIR}/src" -type f | wc -l | tr -d ' ')

  echo -e "  ${BOLD}Client files:${RESET}     ~${DRY_CLIENT_FILES} files"
  echo -e "  ${BOLD}Framework files:${RESET}   ~${DRY_FW_FILES} files"
  echo -e "  ${BOLD}Scenarios:${RESET}         ${DRY_SCENARIOS}"
  echo ""

  # Count imports to rewrite
  DRY_IMPORTS=$(grep -rlE 'from ["'"'"'](\.\./)+src/' "${CLIENT_DIR}" --include='*.ts' 2>/dev/null | wc -l | tr -d ' ')
  echo -e "  ${BOLD}Files with imports to rewrite:${RESET} ${DRY_IMPORTS}"
  echo ""

  echo -e "  ${BOLD}Directories to create:${RESET}"
  for dir in config data lib scenarios framework/src framework/shared framework/bin bin; do
    echo -e "    ${CYAN}${dir}/${RESET}"
  done
  echo ""

  echo -e "  ${BOLD}Files to generate:${RESET}"
  for f in package.json tsconfig.json webpack.config.js .eslintrc.json .gitignore bin/run-test.sh export-manifest.json; do
    echo -e "    ${f}"
  done
  [[ "${CI_PROVIDER}" == "github" ]] && echo -e "    .github/workflows/k6.yml"
  [[ "${CI_PROVIDER}" == "gitlab" ]] && echo -e "    .gitlab-ci.yml"
  [[ "${GIT_INIT}" == "true" ]] && echo -e "    ${DIM}(git init + initial commit)${RESET}"
  echo ""

  # Estimate size
  DRY_SIZE_CLIENT=$(du -sh "${CLIENT_DIR}" 2>/dev/null | cut -f1 || echo "?")
  DRY_SIZE_FW=$(du -sh "${ROOT_DIR}/src" 2>/dev/null | cut -f1 || echo "?")
  echo -e "  ${BOLD}Estimated size:${RESET} ~${DRY_SIZE_CLIENT} (client) + ~${DRY_SIZE_FW} (framework)"
  echo ""
  echo -e "  ${GREEN}No files created (--dry-run)${RESET}"
  exit 0
fi

# ══════════════════════════════════════════════════════════════════════════════
# Step 1: Create directory structure
# ══════════════════════════════════════════════════════════════════════════════
log_step "Step 1/5 — Creating directory structure"

mkdir -p "${OUTPUT_DIR}"
mkdir -p "${OUTPUT_DIR}/bin"
mkdir -p "${OUTPUT_DIR}/framework/src"
mkdir -p "${OUTPUT_DIR}/framework/shared"
mkdir -p "${OUTPUT_DIR}/framework/bin"
mkdir -p "${OUTPUT_DIR}/reports"
[[ "${WITH_OBSERVABILITY}" == "true" ]] && mkdir -p "${OUTPUT_DIR}/infrastructure/grafana/provisioning/dashboards" "${OUTPUT_DIR}/infrastructure/grafana/provisioning/datasources" "${OUTPUT_DIR}/infrastructure/grafana/dashboards" "${OUTPUT_DIR}/infrastructure/prometheus" "${OUTPUT_DIR}/infrastructure/loki" "${OUTPUT_DIR}/infrastructure/tempo"
[[ "${WITH_BINARY}" == "true" ]] && mkdir -p "${OUTPUT_DIR}/framework/cmd/k6-embedded/entrypoint" "${OUTPUT_DIR}/framework/cmd/k6-embedded/scripts"
[[ "${WITH_MCP}" == "true" ]] && mkdir -p "${OUTPUT_DIR}/mcp-server/src"
[[ "${WITH_CLAUDE}" == "true" ]] && mkdir -p "${OUTPUT_DIR}/.claude/skills"

log_success "Directory structure created"

# ══════════════════════════════════════════════════════════════════════════════
# Step 2: Copy files (T-302 + T-303)
# ══════════════════════════════════════════════════════════════════════════════
log_step "Step 2/5 — Copying client files and framework core"

# ── T-302: Copy client files ─────────────────────────────────────────────────
CLIENT_FILE_COUNT=0

# Required directories
for dir in config scenarios; do
  if [[ ! -d "${CLIENT_DIR}/${dir}" ]]; then
    log_error "Required client directory missing: ${CLIENT_DIR}/${dir}"
    exit 1
  fi
  cp -R "${CLIENT_DIR}/${dir}" "${OUTPUT_DIR}/${dir}"
  count=$(find "${OUTPUT_DIR}/${dir}" -type f | wc -l | tr -d ' ')
  CLIENT_FILE_COUNT=$((CLIENT_FILE_COUNT + count))
  log_debug "Copied ${dir}/ (${count} files)"
done

# Optional directories
# TST-06 (Phase 2): "tests" removed — clients/<name>/tests/ no longer exists after
# the scenarios/ vs tests/ unification. Phase 1 EXP-01 added "tests" here as a
# quick-fix; Phase 2 reverts to the canonical {data, lib, docs} set.
for dir in data lib docs; do
  if [[ -d "${CLIENT_DIR}/${dir}" ]]; then
    cp -R "${CLIENT_DIR}/${dir}" "${OUTPUT_DIR}/${dir}"
    count=$(find "${OUTPUT_DIR}/${dir}" -type f | wc -l | tr -d ' ')
    CLIENT_FILE_COUNT=$((CLIENT_FILE_COUNT + count))
    log_debug "Copied ${dir}/ (${count} files)"
  fi
done

# Optional files at client root
for file in README.md README.es.md; do
  if [[ -f "${CLIENT_DIR}/${file}" ]]; then
    cp "${CLIENT_DIR}/${file}" "${OUTPUT_DIR}/${file}"
    CLIENT_FILE_COUNT=$((CLIENT_FILE_COUNT + 1))
  fi
done

log_success "Client files copied (${CLIENT_FILE_COUNT} files)"

# ── T-303: Copy framework core ───────────────────────────────────────────────
FW_DIR="${OUTPUT_DIR}/framework"
FRAMEWORK_FILE_COUNT=0

# src/ — complete copy
cp -R "${ROOT_DIR}/src/"* "${FW_DIR}/src/"

# Prune the AI agent module from standalone exports. It is a build-time authoring
# tool (planner/builder/analyst agents) that depends on @anthropic-ai/sdk — never
# shipped to clients — and tsconfig.json already excludes framework/src/ai/**. But
# framework/src/index.ts re-exports it via `export * from "./ai/index"`, which drags
# it into typecheck transitively (the tsconfig exclude can't stop a transitive ref),
# breaking `tsc --noEmit` on a missing @anthropic-ai/sdk. Drop the dir and the
# re-export so the exported standalone typechecks clean. (--with-claude only adds the
# .claude/ config, not these runtime agents.)
rm -rf "${FW_DIR}/src/ai"
if [[ -f "${FW_DIR}/src/index.ts" ]]; then
  grep -v 'from "\./ai/index"' "${FW_DIR}/src/index.ts" > "${FW_DIR}/src/index.ts.tmp" \
    && mv "${FW_DIR}/src/index.ts.tmp" "${FW_DIR}/src/index.ts"
fi

count=$(find "${FW_DIR}/src" -type f | wc -l | tr -d ' ')
FRAMEWORK_FILE_COUNT=$((FRAMEWORK_FILE_COUNT + count))
log_debug "Copied src/ (${count} files; ai/ module pruned)"

# shared/profiles/
if [[ -d "${ROOT_DIR}/shared/profiles" ]]; then
  cp -R "${ROOT_DIR}/shared/profiles" "${FW_DIR}/shared/profiles"
  count=$(find "${FW_DIR}/shared/profiles" -type f | wc -l | tr -d ' ')
  FRAMEWORK_FILE_COUNT=$((FRAMEWORK_FILE_COUNT + count))
  log_debug "Copied shared/profiles/ (${count} files)"
fi

# shared/schemas/
if [[ -d "${ROOT_DIR}/shared/schemas" ]]; then
  cp -R "${ROOT_DIR}/shared/schemas" "${FW_DIR}/shared/schemas"
  count=$(find "${FW_DIR}/shared/schemas" -type f | wc -l | tr -d ' ')
  FRAMEWORK_FILE_COUNT=$((FRAMEWORK_FILE_COUNT + count))
  log_debug "Copied shared/schemas/ (${count} files)"
fi

# bin/ utilities
for f in validate-config.js validate-config-schema.json; do
  if [[ -f "${ROOT_DIR}/bin/${f}" ]]; then
    cp "${ROOT_DIR}/bin/${f}" "${FW_DIR}/bin/${f}"
    FRAMEWORK_FILE_COUNT=$((FRAMEWORK_FILE_COUNT + 1))
  fi
done

# auto-compare.js (used by run-test.sh step 4)
if [[ -d "${ROOT_DIR}/bin/testing" ]]; then
  mkdir -p "${FW_DIR}/bin/testing"
  for f in "${ROOT_DIR}/bin/testing/"*; do
    if [[ -f "$f" ]]; then
      cp "$f" "${FW_DIR}/bin/testing/"
      FRAMEWORK_FILE_COUNT=$((FRAMEWORK_FILE_COUNT + 1))
    fi
  done
fi

# VERSION file
echo "${FRAMEWORK_VERSION}" > "${FW_DIR}/VERSION"
FRAMEWORK_FILE_COUNT=$((FRAMEWORK_FILE_COUNT + 1))

log_success "Framework core copied (${FRAMEWORK_FILE_COUNT} files)"

TOTAL_COPIED=$((CLIENT_FILE_COUNT + FRAMEWORK_FILE_COUNT))
log_info "Total files copied: ${BOLD}${TOTAL_COPIED}${RESET}"

# ── Step 2.5: Copy capability files ──────────────────────────────────────
CAPABILITY_FILES=0

if [[ "${WITH_REPORTS}" == "true" ]]; then
  log_debug "Copying report generators..."
  cp "${ROOT_DIR}/bin/generate-report.js" "${OUTPUT_DIR}/framework/bin/generate-report.js" 2>/dev/null || true
  cp "${ROOT_DIR}/bin/generate-artifacts.js" "${OUTPUT_DIR}/framework/bin/generate-artifacts.js" 2>/dev/null || true
  CAPABILITY_FILES=$((CAPABILITY_FILES + 2))
fi

if [[ "${WITH_OBSERVABILITY}" == "true" ]]; then
  log_debug "Copying observability infrastructure..."
  cp "${ROOT_DIR}/infrastructure/docker-compose.standalone.yml" "${OUTPUT_DIR}/infrastructure/docker-compose.yml"
  cp "${ROOT_DIR}/infrastructure/.env.standalone" "${OUTPUT_DIR}/infrastructure/.env.example"
  # Grafana
  cp -R "${ROOT_DIR}/infrastructure/grafana/provisioning/." "${OUTPUT_DIR}/infrastructure/grafana/provisioning/"
  cp -R "${ROOT_DIR}/infrastructure/grafana/dashboards/." "${OUTPUT_DIR}/infrastructure/grafana/dashboards/"
  # Prometheus
  cp "${ROOT_DIR}/infrastructure/prometheus/prometheus-standalone.yml" "${OUTPUT_DIR}/infrastructure/prometheus/prometheus.yml"
  # Loki + Tempo (if they exist)
  [[ -f "${ROOT_DIR}/infrastructure/loki/loki-config.yml" ]] && cp "${ROOT_DIR}/infrastructure/loki/loki-config.yml" "${OUTPUT_DIR}/infrastructure/loki/loki-config.yml"
  [[ -f "${ROOT_DIR}/infrastructure/tempo/tempo-config.yml" ]] && cp "${ROOT_DIR}/infrastructure/tempo/tempo-config.yml" "${OUTPUT_DIR}/infrastructure/tempo/tempo-config.yml"
  INFRA_FILES=$(find "${OUTPUT_DIR}/infrastructure" -type f | wc -l | tr -d ' ')
  log_success "Infrastructure copied (${INFRA_FILES} files)"
  CAPABILITY_FILES=$((CAPABILITY_FILES + INFRA_FILES))
fi

if [[ "${WITH_BINARY}" == "true" ]]; then
  log_debug "Copying Go embed modules..."
  if [[ -d "${ROOT_DIR}/cmd/k6-embedded" ]]; then
    cp -R "${ROOT_DIR}/cmd/k6-embedded/." "${OUTPUT_DIR}/framework/cmd/k6-embedded/"
    EMBED_FILES=$(find "${OUTPUT_DIR}/framework/cmd/k6-embedded" -type f | wc -l | tr -d ' ')
    log_success "Go embed modules copied (${EMBED_FILES} files)"
    CAPABILITY_FILES=$((CAPABILITY_FILES + EMBED_FILES))
  else
    log_warn "cmd/k6-embedded/ not found — skipping binary builder"
    WITH_BINARY="false"
  fi
fi

if [[ "${WITH_MCP}" == "true" ]]; then
  log_debug "Copying MCP server..."
  # Phase 4 ARC-03: consolidated to single source-of-truth mcp-server/
  # (mcp-server-standalone/ deleted per D-11/D-13). The modular layout has
  # src/, package.json, tsconfig.json; we exclude dist/ and node_modules/.
  if [[ -d "${ROOT_DIR}/mcp-server" ]]; then
    cp -R "${ROOT_DIR}/mcp-server/." "${OUTPUT_DIR}/mcp-server/"
    rm -rf "${OUTPUT_DIR}/mcp-server/node_modules" "${OUTPUT_DIR}/mcp-server/dist"
    MCP_FILES=$(find "${OUTPUT_DIR}/mcp-server" -type f | wc -l | tr -d ' ')
    log_success "MCP server copied (${MCP_FILES} files)"
    CAPABILITY_FILES=$((CAPABILITY_FILES + MCP_FILES))
  else
    log_warn "mcp-server/ not found — skipping MCP"
    WITH_MCP="false"
  fi
fi

[[ ${CAPABILITY_FILES} -gt 0 ]] && log_info "Capability files: ${CAPABILITY_FILES}"

# ══════════════════════════════════════════════════════════════════════════════
# Step 3: Rewrite imports (T-304)
# ══════════════════════════════════════════════════════════════════════════════
log_step "Step 3/5 — Rewriting framework imports"

REWRITE_COUNT=0
REWRITE_FILES=0

# Process all .ts files outside framework/
while IFS= read -r -d '' ts_file; do
  # Get path relative to OUTPUT_DIR
  rel_path="${ts_file#${OUTPUT_DIR}/}"
  dir_path="$(dirname "${rel_path}")"

  # Calculate depth from standalone root
  depth=0
  if [[ "${dir_path}" != "." ]]; then
    depth=$(echo "${dir_path}" | awk -F'/' '{print NF}')
  fi

  # Build prefix: ../ repeated <depth> times
  prefix=""
  for ((i = 0; i < depth; i++)); do
    prefix="../${prefix}"
  done
  if [[ -z "${prefix}" ]]; then
    prefix="./"
  fi

  # Count matches before rewriting
  matches=$(grep -cE 'from ["'"'"'](\.\./)+src/' "${ts_file}" 2>/dev/null || true)
  matches="${matches:-0}"
  # Ensure matches is a single integer
  matches=$(echo "${matches}" | head -1 | tr -dc '0-9')
  matches="${matches:-0}"

  if [[ "${matches}" -gt 0 ]]; then
    # Rewrite: from "../../..src/..." → from "<prefix>framework/src/..."
    # Handle both double and single quotes
    sed -i.bak -E \
      "s|from \"(\.\./)+src/|from \"${prefix}framework/src/|g" \
      "${ts_file}"
    sed -i.bak -E \
      "s|from '(\.\./)+src/|from '${prefix}framework/src/|g" \
      "${ts_file}"

    # Handle require() patterns
    sed -i.bak -E \
      "s|require\(\"(\.\./)+src/|require(\"${prefix}framework/src/|g" \
      "${ts_file}"
    sed -i.bak -E \
      "s|require\('(\.\./)+src/|require('${prefix}framework/src/|g" \
      "${ts_file}"

    rm -f "${ts_file}.bak"
    REWRITE_COUNT=$((REWRITE_COUNT + matches))
    REWRITE_FILES=$((REWRITE_FILES + 1))
    log_debug "Rewrote ${matches} imports in ${rel_path} (depth=${depth}, prefix=${prefix})"
  else
    rm -f "${ts_file}.bak"
  fi
done < <(find "${OUTPUT_DIR}" -name '*.ts' -not -path '*/framework/*' -not -path '*/node_modules/*' -print0)

log_success "Rewrote ${BOLD}${REWRITE_COUNT}${RESET} imports across ${REWRITE_FILES} files"

# Verify: check for any remaining unrewritten framework imports
RESIDUAL=$(grep -rn '"\.\.\/.*\/src/' "${OUTPUT_DIR}" --include='*.ts' 2>/dev/null | grep -v 'framework/' | grep -v 'node_modules/' | head -5 || true)
if [[ -n "${RESIDUAL}" ]]; then
  log_warn "Potential unrewritten imports detected:"
  echo "${RESIDUAL}" | sed 's/^/    /'
fi

# ══════════════════════════════════════════════════════════════════════════════
# Step 4: Generate configuration files (T-305 + T-306 + T-307)
# ══════════════════════════════════════════════════════════════════════════════
log_step "Step 4/5 — Generating configuration files"

# ── T-305: package.json ──────────────────────────────────────────────────────
cat > "${OUTPUT_DIR}/package.json" << PKGJSON
{
  "name": "${CLIENT}-k6-tests",
  "version": "1.0.0",
  "description": "k6 load tests for ${CLIENT} (exported from k6-enterprise-framework v${FRAMEWORK_VERSION})",
  "private": true,
  "scripts": {
    "build": "webpack --config webpack.config.js",
    "build:watch": "webpack --config webpack.config.js --watch",
    "typecheck": "tsc --noEmit",
    "lint": "eslint 'scenarios/**/*.ts' 'lib/**/*.ts'",
    "lint:fix": "eslint 'scenarios/**/*.ts' 'lib/**/*.ts' --fix",
    "validate": "npm run typecheck && npm run lint",
    "validate:config": "node framework/bin/validate-config.js --file=config/default.json"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "@types/k6": "^1.6.0",
    "@types/node": "^22.19.19",
    "@typescript-eslint/eslint-plugin": "^8.56.0",
    "@typescript-eslint/parser": "^8.56.0",
    "ajv": "^8.18.0",
    "ajv-formats": "^3.0.1",
    "eslint": "^10.0.0",
    "glob": "^13.0.5",
    "js-yaml": "^4.1.1",
    "ts-loader": "^9.5.4",
    "typescript": "^5.9.3",
    "webpack": "^5.105.2",
    "webpack-cli": "^6.0.1"
  }
}
PKGJSON
log_success "Generated package.json"

# ── T-306: tsconfig.json ─────────────────────────────────────────────────────
cat > "${OUTPUT_DIR}/tsconfig.json" << 'TSCONFIG'
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ES2020",
    "moduleResolution": "node",
    "lib": ["ES2020", "dom"],
    "strict": true,
    "esModuleInterop": false,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": ".",
    "baseUrl": ".",
    "paths": {
      "@core/*": ["framework/src/core/*"],
      "@helpers/*": ["framework/src/helpers/*"],
      "@observability/*": ["framework/src/observability/*"],
      "@patterns/*": ["framework/src/patterns/*"],
      "@reporting/*": ["framework/src/reporting/*"],
      "@types-k6/*": ["framework/src/types/*"]
    },
    "types": ["k6", "node"]
  },
  "include": ["framework/src/**/*", "lib/**/*", "scenarios/**/*"],
  "exclude": ["node_modules", "dist", "framework/src/ai/**/*"]
}
TSCONFIG
log_success "Generated tsconfig.json"

# ── T-307: webpack.config.js ─────────────────────────────────────────────────
cat > "${OUTPUT_DIR}/webpack.config.js" << 'WEBPACK'
const path = require("path");
const { glob } = require("glob");

// Auto-discover all scenario entry points
const scenarioEntries = Object.fromEntries(
  glob
    .sync("scenarios/**/*.ts")
    .map((file) => {
      const outKey = file
        .replace(/^scenarios\//, "")
        .replace(/\.ts$/, "");
      return [outKey, path.resolve(__dirname, file)];
    })
);

module.exports = {
  mode: "production",
  entry: scenarioEntries,
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "[name].js",
    libraryTarget: "commonjs",
  },
  resolve: {
    extensions: [".ts", ".js"],
    extensionAlias: {
      ".js": [".ts", ".js"],
    },
    alias: {
      "@core": path.resolve(__dirname, "framework/src/core"),
      "@helpers": path.resolve(__dirname, "framework/src/helpers"),
      "@observability": path.resolve(__dirname, "framework/src/observability"),
      "@patterns": path.resolve(__dirname, "framework/src/patterns"),
      "@reporting": path.resolve(__dirname, "framework/src/reporting"),
      "@types-k6": path.resolve(__dirname, "framework/src/types"),
    },
    fallback: {
      fs: false,
      path: false,
    },
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: {
          loader: "ts-loader",
          options: {
            transpileOnly: true,
          },
        },
        exclude: /node_modules/,
      },
    ],
  },
  target: "web",
  externals: /^(k6|https?:\/\/)(\/.*)?$/,
  performance: {
    hints: false,
  },
  optimization: {
    minimize: true,
  },
};
WEBPACK
log_success "Generated webpack.config.js"

# ── .eslintrc.json ───────────────────────────────────────────────────────────
cat > "${OUTPUT_DIR}/.eslintrc.json" << 'ESLINT'
{
  "root": true,
  "parser": "@typescript-eslint/parser",
  "parserOptions": {
    "ecmaVersion": 2020,
    "sourceType": "module",
    "project": "./tsconfig.json"
  },
  "plugins": ["@typescript-eslint"],
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended"
  ],
  "rules": {
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/explicit-function-return-type": "warn",
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    "no-console": "off"
  },
  "env": {
    "es2020": true
  }
}
ESLINT
log_success "Generated .eslintrc.json"

# ── .gitignore ───────────────────────────────────────────────────────────────
cat > "${OUTPUT_DIR}/.gitignore" << 'GITIGNORE'
node_modules/
dist/
reports/
.env
.env.*
!.env.example
.DS_Store
*.log
*.bak
GITIGNORE
log_success "Generated .gitignore"

# ── .tool-versions (asdf) ────────────────────────────────────────────────────
cat > "${OUTPUT_DIR}/.tool-versions" << 'TOOLVERSIONS'
nodejs lts
TOOLVERSIONS
log_success "Generated .tool-versions"

# ── T-308: bin/run-test.sh standalone ────────────────────────────────────────
cat > "${OUTPUT_DIR}/bin/run-test.sh" << 'RUNTEST'
#!/usr/bin/env bash
# run-test.sh — Standalone k6 test runner
#
# Simplified pipeline for standalone client repos exported from k6-enterprise-framework.
# No --client flag needed — this repo contains a single client.
#
# Pipeline:
#   1. Validate configuration
#   2. Build TypeScript bundle (webpack)
#   3. Execute k6 test (with web dashboard)
#   4. Auto-comparison (if previous results exist)
#   5. Generate report artifacts (HTML banner, CSV, analysis MD, message MD)
#   6. Print summary
#
# Exit codes:
#   0   — All tests passed, thresholds met
#   1   — Test error / framework error
#   99  — k6 thresholds failed (tests ran but SLOs not met)
#   107 — Script/build error (TypeScript compile, missing file, etc.)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ── Defaults ──────────────────────────────────────────────────────────────────
SCENARIO=""
PROFILE="${K6_PROFILE:-smoke}"
ENV="${K6_ENV:-default}"
DEBUG="${K6_DEBUG:-false}"
REPORTS_DIR="${K6_REPORTS_DIR:-${ROOT_DIR}/reports}"
EXTRA_ARGS=()
SKIP_BUILD="${K6_SKIP_BUILD:-false}"
SKIP_VALIDATE="${K6_SKIP_VALIDATE:-false}"
DRY_RUN="false"

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'
CYAN='\033[0;36m'; MAGENTA='\033[0;35m'; DIM='\033[2m'

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

# ── Progress bar ──────────────────────────────────────────────────────────────
profile_to_seconds() {
  local p="$1"
  case "$p" in
    smoke) echo 60 ;; quick) echo 180 ;; load) echo 840 ;;
    rampup) echo 780 ;; capacity) echo 1200 ;; stress) echo 1500 ;;
    spike) echo 300 ;; breakpoint) echo 3600 ;; soak) echo 14400 ;;
    *) echo 120 ;;
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

# ── Banner ────────────────────────────────────────────────────────────────────
FW_VERSION="$(cat "${ROOT_DIR}/framework/VERSION" 2>/dev/null || echo "unknown")"

print_banner() {
  echo -e "${BOLD}"
  echo "  ╔══════════════════════════════════════════════╗"
  echo "  ║       k6 Standalone Test Runner              ║"
  echo "  ║           Framework v${FW_VERSION}                    ║"
  echo "  ╚══════════════════════════════════════════════╝"
  echo -e "${RESET}"
}

# ── Help ──────────────────────────────────────────────────────────────────────
print_help() {
  cat <<EOF
${BOLD}k6 Standalone Test Runner${RESET}

USAGE:
  ./bin/run-test.sh --scenario <path> [OPTIONS]

${BOLD}── Execution ─────────────────────────────────────────────────────────────${RESET}
  --scenario <path>    Scenario path relative to scenarios/
                       Examples: api/health-check  integration/create-and-verify
  --profile <name>     Load profile (default: smoke)
  --env <name>         Environment: default|staging|production (default: default)

${BOLD}── Options ───────────────────────────────────────────────────────────────${RESET}
  --reports-dir <dir>  Output directory for artifacts (default: ./reports)
  --skip-build         Skip webpack build step
  --skip-validate      Skip config validation step
  --dry-run            Show execution plan without running
  --debug              Enable verbose logging
  --list-profiles      Show available profiles and exit
  --help               Show this help and exit

${BOLD}── Examples ──────────────────────────────────────────────────────────────${RESET}
  ./bin/run-test.sh --scenario=api/health-check --profile=smoke
  ./bin/run-test.sh --scenario=integration/create-and-verify --profile=load --env=staging
  ./bin/run-test.sh --scenario=api/health-check --skip-build --debug

${BOLD}── Exit Codes ────────────────────────────────────────────────────────────${RESET}
  ${GREEN}0${RESET}    All tests passed, thresholds met
  ${RED}1${RESET}    Test error or framework error
  ${YELLOW}99${RESET}   k6 thresholds failed — SLOs not met
  ${RED}107${RESET}  Script/build error
EOF
}

print_profiles() {
  printf "\n${BOLD}  Load Profiles${RESET}\n\n"
  printf "  %-12s %-8s %-10s %-12s %s\n" "Profile" "VUs" "Duration" "Category" "Use Case"
  printf "  %-12s %-8s %-10s %-12s %s\n" "-------" "---" "--------" "--------" "--------"
  printf "  ${GREEN}%-12s${RESET} %-8s %-10s %-12s %s\n" "smoke"      "1-2"    "1m"    "Sanity"   "Verify operational"
  printf "  ${GREEN}%-12s${RESET} %-8s %-10s %-12s %s\n" "quick"      "5"      "3m"    "CI"       "Fast CI feedback"
  printf "  ${CYAN}%-12s${RESET} %-8s %-10s %-12s %s\n"  "load"       "20"     "14m"   "Normal"   "Sustained traffic"
  printf "  ${CYAN}%-12s${RESET} %-8s %-10s %-12s %s\n"  "rampup"     "50"     "13m"   "Gradient" "Gradual increment"
  printf "  ${YELLOW}%-12s${RESET} %-8s %-10s %-12s %s\n" "capacity"  "200"    "20m"   "Limit"    "Max throughput"
  printf "  ${YELLOW}%-12s${RESET} %-8s %-10s %-12s %s\n" "stress"    "400"    "25m"   "Stress"   "Breaking point"
  printf "  ${RED}%-12s${RESET} %-8s %-10s %-12s %s\n"   "spike"     "300"    "5m"    "Spike"    "Elasticity"
  printf "  ${RED}%-12s${RESET} %-8s %-10s %-12s %s\n"   "breakpoint" "1000"  "1h"    "Extreme"  "Absolute limit"
  printf "  ${MAGENTA}%-12s${RESET} %-8s %-10s %-12s %s\n" "soak"    "20"     "4h+"   "Endurance" "Memory leaks"
  printf "\n"
}

# ── Input sanitization ────────────────────────────────────────────────────────
SAFE_PATH_RE='^[a-zA-Z0-9_/.-]+$'

validate_input() {
  local name="$1" value="$2" pattern="$3"
  if [[ -z "${value}" ]]; then log_error "Parameter ${name} cannot be empty"; exit 1; fi
  if [[ "${#value}" -gt 256 ]]; then log_error "Parameter ${name} exceeds max length"; exit 1; fi
  if [[ "${value}" == *".."* ]]; then log_error "Path traversal detected in ${name}"; exit 1; fi
  if [[ ! "${value}" =~ ${pattern} ]]; then log_error "Invalid value for ${name}: '${value}'"; exit 1; fi
}

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --scenario=*)     SCENARIO="${1#*=}";             shift ;;
    --scenario)       SCENARIO="$2";                 shift 2 ;;
    --profile=*)      PROFILE="${1#*=}";              shift ;;
    --profile)        PROFILE="$2";                  shift 2 ;;
    --env=*)          ENV="${1#*=}";                  shift ;;
    --env)            ENV="$2";                      shift 2 ;;
    --reports-dir=*)  REPORTS_DIR="${1#*=}";          shift ;;
    --reports-dir)    REPORTS_DIR="$2";              shift 2 ;;
    --skip-build)     SKIP_BUILD="true";             shift ;;
    --skip-validate)  SKIP_VALIDATE="true";          shift ;;
    --dry-run)        DRY_RUN="true";                shift ;;
    --debug)          DEBUG="true";                  shift ;;
    --list-profiles)  print_profiles; exit 0 ;;
    --help|-h)        print_help; exit 0 ;;
    --)               shift; EXTRA_ARGS+=("$@"); break ;;
    *)                log_warn "Unknown option: $1"; shift ;;
  esac
done

SCENARIO="${SCENARIO:-${K6_SCENARIO:-}}"

# ── Validate ──────────────────────────────────────────────────────────────────
print_banner

if [[ -z "${SCENARIO}" ]]; then
  log_error "No scenario specified. Use --scenario <path>"
  echo ""
  echo -e "  ${BOLD}Available scenarios:${RESET}"
  find "${ROOT_DIR}/scenarios" -name "*.ts" -type f 2>/dev/null \
    | sed "s|${ROOT_DIR}/scenarios/||; s|\.ts$||" \
    | sort \
    | sed 's/^/    /'
  echo ""
  exit 1
fi

validate_input "--scenario" "${SCENARIO}" "${SAFE_PATH_RE}"

# Resolve paths
SCENARIO_SRC="${ROOT_DIR}/scenarios/${SCENARIO}.ts"
DIST_SCRIPT="${ROOT_DIR}/dist/${SCENARIO}.js"
PROFILES_DIR="${ROOT_DIR}/framework/shared/profiles"
CONFIG_FILE="${ROOT_DIR}/config/${ENV}.json"

if [[ ! -f "${SCENARIO_SRC}" ]]; then
  log_error "Scenario '${SCENARIO}' not found"
  echo -e "  ${BOLD}Expected:${RESET} ${SCENARIO_SRC}"
  echo ""
  echo -e "  ${BOLD}Available scenarios:${RESET}"
  find "${ROOT_DIR}/scenarios" -name "*.ts" -type f 2>/dev/null \
    | sed "s|${ROOT_DIR}/scenarios/||; s|\.ts$||" \
    | sort \
    | sed 's/^/    /'
  echo ""
  exit 107
fi

if [[ ! -f "${PROFILES_DIR}/${PROFILE}.json" ]]; then
  log_error "Profile '${PROFILE}' not found in framework/shared/profiles/"
  echo -e "  Available: $(ls "${PROFILES_DIR}" 2>/dev/null | sed 's/\.json$//' | tr '\n' ' ')"
  exit 107
fi

# Artifact paths
ISO_TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
SCENARIO_SLUG="${SCENARIO//\//_}"
ARTIFACTS_DIR="${REPORTS_DIR}/${SCENARIO_SLUG}"
mkdir -p "${ARTIFACTS_DIR}"

SUMMARY_JSON="${ARTIFACTS_DIR}/summary-${ISO_TIMESTAMP}.json"
K6_LOG="${ARTIFACTS_DIR}/k6-execution-${ISO_TIMESTAMP}.log"
HTML_REPORT="${ARTIFACTS_DIR}/html-report-${ISO_TIMESTAMP}.html"
METRICS_CSV="${ARTIFACTS_DIR}/metrics-${ISO_TIMESTAMP}.csv"
COMPARISON_MD="${ARTIFACTS_DIR}/comparison-${ISO_TIMESTAMP}.md"
ANALYSIS_MD="${ARTIFACTS_DIR}/analysis-${ISO_TIMESTAMP}.md"
MESSAGE_MD="${ARTIFACTS_DIR}/message-${ISO_TIMESTAMP}.md"
ERROR_LOG="${ARTIFACTS_DIR}/error-log-${ISO_TIMESTAMP}.log"

# Client name derived from repo directory name
CLIENT_NAME="$(basename "${ROOT_DIR}")"
RUN_ID="${CLIENT_NAME}_${SCENARIO_SLUG}_${PROFILE}_${ISO_TIMESTAMP}"

log_info "Scenario: ${BOLD}${SCENARIO}${RESET}"
log_info "Profile:  ${BOLD}${PROFILE}${RESET}"
log_info "Env:      ${BOLD}${ENV}${RESET}"
log_info "Reports:  ${ARTIFACTS_DIR}"
echo ""

# ── Dry-run ───────────────────────────────────────────────────────────────────
if [[ "${DRY_RUN}" == "true" ]]; then
  echo -e "${BOLD}── Dry-run: execution plan ──${RESET}"
  echo -e "  Source:   ${SCENARIO_SRC}"
  echo -e "  Bundle:   ${DIST_SCRIPT}"
  echo -e "  Profile:  ${PROFILES_DIR}/${PROFILE}.json"
  echo -e "  Config:   ${CONFIG_FILE}"
  echo -e "  Artifacts: ${ARTIFACTS_DIR}"
  echo ""
  echo -e "${GREEN}No changes made (--dry-run)${RESET}"
  exit 0
fi

# ══════════════════════════════════════════════════════════════════════════════
# Step 1: Validate configuration
# ══════════════════════════════════════════════════════════════════════════════
STEP=1
TOTAL_STEPS=6

if [[ "${SKIP_VALIDATE}" != "true" && -f "${CONFIG_FILE}" && -f "${ROOT_DIR}/framework/bin/validate-config.js" ]]; then
  log_step "Step ${STEP}/${TOTAL_STEPS} — Validate configuration"
  if node "${ROOT_DIR}/framework/bin/validate-config.js" --file="${CONFIG_FILE}" 2>/dev/null; then
    log_success "Configuration valid"
  else
    log_warn "Config validation failed (non-blocking)"
  fi
else
  log_info "Step ${STEP}/${TOTAL_STEPS} — Skipping validation"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Step 2: Build
# ══════════════════════════════════════════════════════════════════════════════
STEP=2

if [[ "${SKIP_BUILD}" != "true" ]]; then
  log_step "Step ${STEP}/${TOTAL_STEPS} — Building TypeScript bundle"
  if npm run build --silent 2>&1 | tail -5; then
    log_success "Build complete"
  else
    log_error "Build failed"
    exit 107
  fi
else
  log_info "Step ${STEP}/${TOTAL_STEPS} — Skipping build (--skip-build)"
fi

if [[ ! -f "${DIST_SCRIPT}" ]]; then
  log_error "Bundle not found: ${DIST_SCRIPT}"
  log_error "Run without --skip-build or check webpack output"
  exit 107
fi

# ══════════════════════════════════════════════════════════════════════════════
# Step 3: Execute k6
# ══════════════════════════════════════════════════════════════════════════════
STEP=3
log_step "Step ${STEP}/${TOTAL_STEPS} — Executing k6 test"

# Read profile
PROFILE_JSON="${PROFILES_DIR}/${PROFILE}.json"
PROFILE_SECS=$(profile_to_seconds "${PROFILE}")

# Build k6 command
K6_CMD=(k6 run)

# Add profile-based options if the scenario doesn't define its own
K6_CMD+=(--summary-export="${SUMMARY_JSON}")

# Add config-based env vars
if [[ -f "${CONFIG_FILE}" ]]; then
  K6_CMD+=(--env "CONFIG_FILE=${CONFIG_FILE}")
fi
K6_CMD+=(--env "K6_PROFILE=${PROFILE}")
K6_CMD+=(--env "PROFILE=${PROFILE}")
K6_CMD+=(--env "ENVIRONMENT=${ENV}")

# Add extra args
K6_CMD+=("${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}")
K6_CMD+=("${DIST_SCRIPT}")

log_debug "Command: ${K6_CMD[*]}"

# Enable k6 web dashboard (HTML report generation)
export K6_WEB_DASHBOARD=true
export K6_WEB_DASHBOARD_EXPORT="${HTML_REPORT}"
export K6_WEB_DASHBOARD_OPEN=false

# Execute with progress tracking
PROGRESS_START=$(date +%s)
K6_EXIT=0

"${K6_CMD[@]}" 2>&1 | tee "${K6_LOG}" &
K6_PID=$!

# Progress bar while k6 runs
while kill -0 "${K6_PID}" 2>/dev/null; do
  ELAPSED=$(( $(date +%s) - PROGRESS_START ))
  draw_progress "${ELAPSED}" "${PROFILE_SECS}" "k6 running (${ELAPSED}s)"
  sleep 2
done
wait "${K6_PID}" || K6_EXIT=$?
echo ""  # Clear progress bar line

DURATION=$(( $(date +%s) - PROGRESS_START ))

if [[ ${K6_EXIT} -eq 0 ]]; then
  log_success "k6 completed in ${DURATION}s — all thresholds passed"
elif [[ ${K6_EXIT} -eq 99 ]]; then
  log_warn "k6 completed in ${DURATION}s — thresholds FAILED (exit 99)"
else
  log_error "k6 failed with exit code ${K6_EXIT}"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Step 4: Auto-comparison (if previous results exist)
# ══════════════════════════════════════════════════════════════════════════════
STEP=4
COMPARE_SCRIPT="${ROOT_DIR}/framework/bin/testing/auto-compare.js"

if [[ -f "${COMPARE_SCRIPT}" && -f "${SUMMARY_JSON}" ]]; then
  log_step "Step ${STEP}/${TOTAL_STEPS} — Auto-comparison"
  PREV_SUMMARY=$(ls -t "${ARTIFACTS_DIR}"/summary-*.json 2>/dev/null | head -2 | tail -1)
  if [[ -n "${PREV_SUMMARY}" && "${PREV_SUMMARY}" != "${SUMMARY_JSON}" ]]; then
    node "${COMPARE_SCRIPT}" --current="${SUMMARY_JSON}" --previous="${PREV_SUMMARY}" \
      --output="${ARTIFACTS_DIR}/comparison-${ISO_TIMESTAMP}.md" 2>/dev/null \
      && log_success "Comparison report generated" \
      || log_warn "Comparison skipped (error)"
  else
    log_info "No previous run to compare against"
  fi
else
  log_info "Step ${STEP}/${TOTAL_STEPS} — Skipping comparison"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Step 5: Generate report artifacts
# ══════════════════════════════════════════════════════════════════════════════
STEP=5
GENERATE_ARTIFACTS="${ROOT_DIR}/framework/bin/generate-artifacts.js"

if [[ -f "${GENERATE_ARTIFACTS}" && -f "${SUMMARY_JSON}" ]]; then
  log_step "Step ${STEP}/${TOTAL_STEPS} — Generating report artifacts"

  _ARTIFACT_ARGS=(
    node "${GENERATE_ARTIFACTS}"
    --input="${SUMMARY_JSON}"
    --output-dir="${ARTIFACTS_DIR}"
    --scenario="${SCENARIO}"
    --profile="${PROFILE}"
    --env="${ENV}"
    --client="${CLIENT_NAME}"
    --run-id="${RUN_ID}"
    --timestamp="${ISO_TIMESTAMP}"
    --exit-code="${K6_EXIT}"
  )
  [[ -f "${HTML_REPORT}" ]] && _ARTIFACT_ARGS+=(--html="${HTML_REPORT}")
  [[ -f "${COMPARISON_MD}" ]] && _ARTIFACT_ARGS+=(--comparison="${COMPARISON_MD}")

  "${_ARTIFACT_ARGS[@]}" 2>&1 | while IFS= read -r line; do
    case "${line}" in
      "[OK]"*)    log_success "${line#\[OK\] }" ;;
      "[WARN]"*)  log_warn "${line#\[WARN\] }" ;;
      *)          log_debug "${line}" ;;
    esac
  done

  # Generate error log
  if [[ -f "${K6_LOG}" ]]; then
    grep -i '\[ERROR\]' "${K6_LOG}" > "${ERROR_LOG}" 2>/dev/null || true
    _error_count=$(wc -l < "${ERROR_LOG}" 2>/dev/null | tr -d ' ')
    if [[ "${_error_count}" -gt 0 ]]; then
      log_warn "Error log: ${ERROR_LOG} (${_error_count} errors captured)"
    else
      rm -f "${ERROR_LOG}"
    fi
  fi
else
  log_info "Step ${STEP}/${TOTAL_STEPS} — Skipping report generation (generate-artifacts.js not found)"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Step 6: Summary
# ══════════════════════════════════════════════════════════════════════════════
STEP=6
log_step "Step ${STEP}/${TOTAL_STEPS} — Summary"

echo ""
echo -e "${BOLD}  ┌──────────────────────────────────────────┐${RESET}"
echo -e "${BOLD}  │           Test Execution Summary          │${RESET}"
echo -e "${BOLD}  ├──────────────────────────────────────────┤${RESET}"
printf "  │ Scenario:  %-30s│\n" "${SCENARIO}"
printf "  │ Profile:   %-30s│\n" "${PROFILE}"
printf "  │ Duration:  %-30s│\n" "${DURATION}s"
printf "  │ Exit code: %-30s│\n" "${K6_EXIT}"
echo -e "${BOLD}  └──────────────────────────────────────────┘${RESET}"
echo ""

echo -e "${BOLD}  Artifacts:${RESET}"
[[ -f "${HTML_REPORT}" ]]   && echo -e "    ${GREEN}[OK]${RESET} html-report  → ${HTML_REPORT}"    || echo -e "    ${YELLOW}[--]${RESET} html-report  (not generated)"
[[ -f "${SUMMARY_JSON}" ]]  && echo -e "    ${GREEN}[OK]${RESET} json-summary → ${SUMMARY_JSON}"   || echo -e "    ${YELLOW}[--]${RESET} json-summary (not generated)"
[[ -f "${K6_LOG}" ]]        && echo -e "    ${GREEN}[OK]${RESET} execution-log → ${K6_LOG}"        || echo -e "    ${YELLOW}[--]${RESET} execution-log (not generated)"
[[ -f "${COMPARISON_MD}" ]] && echo -e "    ${GREEN}[OK]${RESET} comparison   → ${COMPARISON_MD}" || echo -e "    ${YELLOW}[--]${RESET} comparison   (skipped)"
[[ -f "${METRICS_CSV}" ]]   && echo -e "    ${GREEN}[OK]${RESET} metrics-csv  → ${METRICS_CSV}"   || echo -e "    ${YELLOW}[--]${RESET} metrics-csv  (not generated)"
[[ -f "${ANALYSIS_MD}" ]]   && echo -e "    ${GREEN}[OK]${RESET} analysis-md  → ${ANALYSIS_MD}"   || echo -e "    ${YELLOW}[--]${RESET} analysis-md  (not generated)"
[[ -f "${MESSAGE_MD}" ]]    && echo -e "    ${GREEN}[OK]${RESET} message-md   → ${MESSAGE_MD}"    || echo -e "    ${YELLOW}[--]${RESET} message-md   (not generated)"
[[ -f "${ERROR_LOG}" ]]     && echo -e "    ${RED}[!!]${RESET} error-log    → ${ERROR_LOG}"      || echo -e "    ${GREEN}[OK]${RESET} error-log    (no errors)"
echo ""

echo -e "  ${BOLD}Reports:${RESET} ${ARTIFACTS_DIR}/"
echo ""

if [[ ${K6_EXIT} -eq 0 ]]; then
  echo -e "  ${GREEN}${BOLD}RESULT: PASS${RESET} — All thresholds met"
elif [[ ${K6_EXIT} -eq 99 ]]; then
  echo -e "  ${YELLOW}${BOLD}RESULT: WARN${RESET} — Thresholds failed"
else
  echo -e "  ${RED}${BOLD}RESULT: FAIL${RESET} — Test error (exit ${K6_EXIT})"
fi
echo ""

exit ${K6_EXIT}
RUNTEST

chmod +x "${OUTPUT_DIR}/bin/run-test.sh"
log_success "Generated bin/run-test.sh (standalone)"

# ── T-314: Copy update-framework.sh ──────────────────────────────────────────
if [[ -f "${ROOT_DIR}/bin/update-framework.sh" ]]; then
  cp "${ROOT_DIR}/bin/update-framework.sh" "${OUTPUT_DIR}/bin/update-framework.sh"
  chmod +x "${OUTPUT_DIR}/bin/update-framework.sh"
  log_success "Copied bin/update-framework.sh"
fi

# ── Capability: bin/report.sh ────────────────────────────────────────────────
if [[ "${WITH_REPORTS}" == "true" ]]; then
  cp "${ROOT_DIR}/bin/report.sh" "${OUTPUT_DIR}/bin/report.sh"
  chmod +x "${OUTPUT_DIR}/bin/report.sh"
  log_success "Generated bin/report.sh"
fi

# ── Capability: bin/observability.sh ─────────────────────────────────────────
if [[ "${WITH_OBSERVABILITY}" == "true" ]]; then
  cp "${ROOT_DIR}/bin/observability.sh" "${OUTPUT_DIR}/bin/observability.sh"
  chmod +x "${OUTPUT_DIR}/bin/observability.sh"
  log_success "Generated bin/observability.sh"
fi

# ── Capability: bin/build-binary.sh ──────────────────────────────────────────
if [[ "${WITH_BINARY}" == "true" ]]; then
  cp "${ROOT_DIR}/bin/build-binary-standalone.sh" "${OUTPUT_DIR}/bin/build-binary.sh"
  chmod +x "${OUTPUT_DIR}/bin/build-binary.sh"
  log_success "Generated bin/build-binary.sh"
fi

# ── Capability: .claude/ ─────────────────────────────────────────────────────
if [[ "${WITH_CLAUDE}" == "true" ]]; then
  # Generate settings.local.json
  local_MCP_SECTION=""
  if [[ "${WITH_MCP}" == "true" ]]; then
    local_MCP_SECTION=',
    "mcpServers": {
      "k6-framework": {
        "command": "node",
        "args": ["mcp-server/dist/index.js"]
      }
    }'
  fi

  cat > "${OUTPUT_DIR}/.claude/settings.local.json" <<CLAUDE_SETTINGS
{
  "permissions": {
    "allow": [
      "Bash(./bin/run-test.sh:*)",
      "Bash(./bin/report.sh:*)",
      "Bash(./bin/observability.sh:*)",
      "Bash(./bin/build-binary.sh:*)",
      "Bash(npm run:*)",
      "Bash(node:*)",
      "Bash(k6 run:*)",
      "Bash(docker compose:*)"
    ]
  }${local_MCP_SECTION}
}
CLAUDE_SETTINGS
  log_success "Generated .claude/settings.local.json"

  # Generate CLAUDE.md
  _SCENARIO_LIST=$(find "${OUTPUT_DIR}/scenarios" -name "*.ts" -type f 2>/dev/null | sed "s|${OUTPUT_DIR}/scenarios/||; s|\.ts$||" | sort | sed 's/^/- /' || echo "- (none)")

  cat > "${OUTPUT_DIR}/.claude/CLAUDE.md" <<CLAUDE_MD
# ${CLIENT} — k6 Performance Testing

## Project Structure
- \`scenarios/\` — k6 test scenarios (TypeScript)
- \`config/\` — Environment configuration (default.json, staging.json, etc.)
- \`data/\` — Test data files (CSV, JSON)
- \`lib/\` — Client services, helpers, factories
- \`framework/\` — Vendorized k6 enterprise framework core
- \`reports/\` — Generated test reports and artifacts
- \`bin/\` — CLI tools (run-test, report, observability, build-binary)

## Commands

### Run a test
\`\`\`bash
./bin/run-test.sh --scenario=<path> --profile=<profile> [--env=<env>] [--report]
\`\`\`

### Generate HTML report
\`\`\`bash
./bin/report.sh --input=reports/<scenario>/summary-*.json
\`\`\`

### Observability stack
\`\`\`bash
./bin/observability.sh up          # Start Grafana + Prometheus
./bin/observability.sh up --full   # + Loki + Tempo + Pyroscope
./bin/observability.sh open        # Open Grafana in browser
./bin/observability.sh down        # Stop all
\`\`\`

### Build standalone binary
\`\`\`bash
./bin/build-binary.sh                         # Current platform
./bin/build-binary.sh --platform=linux/amd64  # Cross-compile
\`\`\`

### Update framework
\`\`\`bash
./bin/update-framework.sh --from=github:org/k6-enterprise-framework --ref=v1.0.0
\`\`\`

## Load Profiles
smoke (1-2 VUs, 1m), quick (5 VUs, 3m), load (20 VUs, 14m), rampup (50 VUs, 13m),
capacity (200 VUs, 20m), stress (400 VUs, 25m), spike (300 VUs, 5m),
breakpoint (1000 VUs, 1h), soak (20 VUs, 4h+)

## Available Scenarios
${_SCENARIO_LIST}

## Conventions
- Scenarios: \`scenarios/{type}/{name}.ts\` (types: api, integration, browser, mixed)
- Services: \`lib/services/{layer}/{ServiceName}.ts\`
- Config: \`config/{environment}.json\`
CLAUDE_MD
  log_success "Generated .claude/CLAUDE.md"

  # Generate skill files
  cat > "${OUTPUT_DIR}/.claude/skills/k6-load-test.md" <<'SKILL_K6'
# k6 Load Test Skill

Use this skill when writing, modifying, or running k6 load tests.

## Patterns
- Tests import from `../../framework/src/` for helpers and patterns
- Services live in `lib/services/{layer}/{ServiceName}.ts`
- Use `RequestHelper` for HTTP calls with automatic headers and logging
- Use `TokenHelper.getToken()` in `setup()` for authentication
- Every test should have: Rate metric, thresholds, setup(), check(), sleep()

## Running Tests
```bash
./bin/run-test.sh --scenario=api/<name> --profile=smoke --report
```

## Available Profiles
smoke, quick, load, rampup, capacity, stress, spike, breakpoint, soak
SKILL_K6

  cat > "${OUTPUT_DIR}/.claude/skills/k6-analysis.md" <<'SKILL_ANALYSIS'
# k6 Performance Analysis Skill

Use this skill when interpreting k6 test results and performance data.

## Key Metrics
- **p95/p99 latency**: Primary SLA indicators
- **APDEX**: Application Performance Index (T=500ms, F=2000ms)
- **Error rate**: Should be < 1% for production
- **Check rate**: Should be > 95%
- **Throughput**: requests/second

## Reading Reports
- Summary JSON: `reports/{scenario}/summary-*.json`
- HTML reports: `reports/{scenario}/html-report-*.html`
- Generate new: `./bin/report.sh --input=<summary.json>`

## SLA Thresholds
- p95 < 2000ms, p99 < 5000ms, error < 1%, checks >= 95%
SKILL_ANALYSIS
  log_success "Generated .claude/skills/"
fi

# ── export-manifest.json (T-309) ─────────────────────────────────────────────
EXPORT_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
count_files() { find "$1" ${2:+-name "$2"} -type f 2>/dev/null | wc -l | tr -d ' ' || true; }
SCENARIO_COUNT=$(count_files "${OUTPUT_DIR}/scenarios" "*.ts")
LIB_COUNT=$(count_files "${OUTPUT_DIR}/lib" "*.ts")
CONFIG_COUNT=$(count_files "${OUTPUT_DIR}/config")
DATA_COUNT=$(count_files "${OUTPUT_DIR}/data")
# TST-06 (Phase 2): TESTS_COUNT removed — no tests/ directory in exports
FW_SRC_COUNT=$(count_files "${OUTPUT_DIR}/framework/src")

cat > "${OUTPUT_DIR}/export-manifest.json" << MANIFEST
{
  "exportVersion": "1.0.0",
  "sourceFramework": "k6-enterprise-framework",
  "sourceVersion": "${FRAMEWORK_VERSION}",
  "client": "${CLIENT}",
  "exportedAt": "${EXPORT_DATE}",
  "exportedBy": "bin/export-client.sh",
  "filesExported": {
    "scenarios": ${SCENARIO_COUNT},
    "lib": ${LIB_COUNT},
    "config": ${CONFIG_COUNT},
    "data": ${DATA_COUNT},
    "frameworkSrc": ${FW_SRC_COUNT},
    "total": ${TOTAL_COPIED}
  },
  "importsRewritten": ${REWRITE_COUNT},
  "capabilities": {
    "reporting": ${WITH_REPORTS},
    "observability": ${WITH_OBSERVABILITY},
    "binaryBuilder": ${WITH_BINARY},
    "claude": ${WITH_CLAUDE},
    "mcp": ${WITH_MCP}
  }
}
MANIFEST
log_success "Generated export-manifest.json"

GENERATED_COUNT=7

# ── T-312: GitHub Actions workflow ───────────────────────────────────────────
if [[ "${CI_PROVIDER}" == "github" ]]; then
  mkdir -p "${OUTPUT_DIR}/.github/workflows"
  cat > "${OUTPUT_DIR}/.github/workflows/k6.yml" << 'GHACTIONS'
name: k6 Load Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:
    inputs:
      scenario:
        description: 'Scenario path (e.g., api/health-check)'
        required: true
        default: 'api/health-check'
      profile:
        description: 'Load profile'
        required: true
        default: 'smoke'
        type: choice
        options: [smoke, quick, load, rampup, capacity, stress, spike]

jobs:
  load-test:
    runs-on: ubuntu-latest
    timeout-minutes: 30

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install k6
        run: |
          sudo gpg -k
          sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
          echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
          sudo apt-get update
          sudo apt-get install -y k6

      - name: Install dependencies
        run: npm ci

      - name: Typecheck
        run: npm run typecheck || true

      - name: Build
        run: npm run build

      - name: Run k6 test
        run: |
          SCENARIO="${{ github.event.inputs.scenario || 'api/health-check' }}"
          PROFILE="${{ github.event.inputs.profile || 'smoke' }}"
          ./bin/run-test.sh --scenario="${SCENARIO}" --profile="${PROFILE}" --skip-build
        env:
          BASE_URL: ${{ vars.BASE_URL || 'https://httpbin.org' }}

      - name: Upload reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: k6-reports-${{ github.run_id }}
          path: reports/
          retention-days: 30
GHACTIONS
  log_success "Generated .github/workflows/k6.yml"
  GENERATED_COUNT=$((GENERATED_COUNT + 1))
fi

# ── T-313: GitLab CI pipeline ────────────────────────────────────────────────
if [[ "${CI_PROVIDER}" == "gitlab" ]]; then
  cat > "${OUTPUT_DIR}/.gitlab-ci.yml" << 'GITLABCI'
stages:
  - validate
  - build
  - test
  - report

variables:
  SCENARIO: "api/health-check"
  PROFILE: "smoke"
  BASE_URL: "${BASE_URL}"

.k6-image: &k6-image
  image: node:20
  before_script:
    - apt-get update && apt-get install -y gnupg2
    - curl -s https://dl.k6.io/key.gpg | gpg --dearmor | tee /usr/share/keyrings/k6-archive-keyring.gpg
    - echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | tee /etc/apt/sources.list.d/k6.list
    - apt-get update && apt-get install -y k6
    - npm ci

validate:
  <<: *k6-image
  stage: validate
  script:
    - npm run typecheck || true
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    - if: '$CI_COMMIT_BRANCH == "main"'

build:
  <<: *k6-image
  stage: build
  script:
    - npm run build
  artifacts:
    paths:
      - dist/
    expire_in: 1 hour
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    - if: '$CI_COMMIT_BRANCH == "main"'

test:
  <<: *k6-image
  stage: test
  script:
    - ./bin/run-test.sh --scenario="${SCENARIO}" --profile="${PROFILE}" --skip-build
  artifacts:
    paths:
      - reports/
    expire_in: 30 days
    when: always
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    - if: '$CI_COMMIT_BRANCH == "main"'
GITLABCI
  log_success "Generated .gitlab-ci.yml"
  GENERATED_COUNT=$((GENERATED_COUNT + 1))
fi

# ── T-316: Generate README for standalone ────────────────────────────────────
SCENARIO_LIST=""
if [[ -d "${OUTPUT_DIR}/scenarios" ]]; then
  SCENARIO_LIST=$(find "${OUTPUT_DIR}/scenarios" -name "*.ts" -type f \
    | sed "s|${OUTPUT_DIR}/scenarios/||; s|\.ts$||" \
    | sort)
fi

SCENARIO_TABLE=""
while IFS= read -r scen; do
  [[ -n "${scen}" ]] && SCENARIO_TABLE="${SCENARIO_TABLE}\n| ${scen} | ./bin/run-test.sh --scenario=${scen} --profile=smoke |"
done <<< "${SCENARIO_LIST}"

# ── Build dynamic structure tree ──────────────────────────────────────────────
STRUCT_EXTRA=""
BIN_EXTRA=""
if [[ "${WITH_REPORTS}" == "true" ]]; then
  BIN_EXTRA="${BIN_EXTRA}\n│   ├── report.sh         HTML report generator"
fi
if [[ "${WITH_OBSERVABILITY}" == "true" ]]; then
  BIN_EXTRA="${BIN_EXTRA}\n│   ├── observability.sh   Grafana + Prometheus stack"
  STRUCT_EXTRA="${STRUCT_EXTRA}\n├── infrastructure/      Docker Compose observability stack"
fi
if [[ "${WITH_BINARY}" == "true" ]]; then
  BIN_EXTRA="${BIN_EXTRA}\n│   ├── build-binary.sh    Standalone binary builder"
fi
if [[ "${WITH_MCP}" == "true" ]]; then
  STRUCT_EXTRA="${STRUCT_EXTRA}\n├── mcp-server/          MCP server for Claude Code integration"
fi
if [[ "${WITH_CLAUDE}" == "true" ]]; then
  STRUCT_EXTRA="${STRUCT_EXTRA}\n├── .claude/             Claude Code skills and settings"
fi

cat > "${OUTPUT_DIR}/README.md" << READMEEOF
# ${CLIENT} — k6 Load Tests

Standalone performance test repository exported from k6-enterprise-framework v${FRAMEWORK_VERSION}.

## Quick Start

\`\`\`bash
# 1. Install dependencies
npm install

# 2. Build test bundles
npm run build

# 3. Run a test
./bin/run-test.sh --scenario=<scenario> --profile=smoke
\`\`\`

## Structure

\`\`\`
${CLIENT}/
├── config/              Configuration per environment
├── data/                Test data files
├── lib/                 Services, factories, client-config
├── scenarios/           k6 test scenarios
│   ├── api/             Single-endpoint tests
│   ├── integration/     Multi-step flows
│   └── mixed/           Weighted traffic patterns
├── framework/           Framework core (vendorized)
│   ├── src/             Helpers, patterns, core modules
│   └── shared/          Profiles and schemas$(echo -e "${STRUCT_EXTRA}")
├── bin/
│   ├── run-test.sh       Test runner with 5-step pipeline
│   ├── update-framework.sh  Update vendorized framework$(echo -e "${BIN_EXTRA}")
├── package.json
├── tsconfig.json
└── webpack.config.js
\`\`\`

---

## Running Tests

### Basic execution

\`\`\`bash
./bin/run-test.sh --scenario=<path> --profile=<profile> [--env=<env>]
\`\`\`

### Examples

\`\`\`bash
# Smoke test (1-2 VUs, 1 min)
./bin/run-test.sh --scenario=api/health-check --profile=smoke

# Load test against staging
./bin/run-test.sh --scenario=api/search --profile=load --env=staging

# Stress test with HTML report
./bin/run-test.sh --scenario=api/checkout --profile=stress --report

# Run with Prometheus output (requires observability stack)
./bin/run-test.sh --scenario=api/search --profile=load --prometheus
\`\`\`

### Available Scenarios

| Scenario | Command |
|----------|---------|$(echo -e "${SCENARIO_TABLE}")

### Load Profiles

| Profile | VUs | Duration | Use Case |
|---------|-----|----------|----------|
| smoke | 1-2 | 1 min | Verify operational |
| quick | 5 | 3 min | Fast CI feedback |
| load | 20 | 14 min | Normal sustained traffic |
| rampup | 50 | 13 min | Gradual increment |
| capacity | 200 | 20 min | Max throughput |
| stress | 400 | 25 min | Breaking point |
| spike | 300 | 5 min | Elasticity |
| breakpoint | 1000 | 1 hr | Absolute limit |
| soak | 20 | 4+ hrs | Memory leaks |

---

## Configuration

Edit \`config/default.json\` to set your API base URL and options.
Environment-specific configs: \`config/staging.json\`, \`config/production.json\`.

\`\`\`bash
./bin/run-test.sh --scenario=api/health-check --profile=load --env=staging
\`\`\`

READMEEOF

# ── Conditional README sections based on capabilities ─────────────────────────

if [[ "${WITH_REPORTS}" == "true" ]]; then
  cat >> "${OUTPUT_DIR}/README.md" << 'REPORTSEOF'
---

## HTML Reports

Generate a self-contained HTML performance report from k6 summary JSON output.

### Generate a report

```bash
# After running a test with --report flag, a summary JSON is saved in reports/
./bin/run-test.sh --scenario=api/search --profile=load --report

# Generate report manually from summary JSON
./bin/report.sh --input=reports/<scenario>/summary-<timestamp>.json
```

### Compare with a previous run

```bash
./bin/report.sh --input=reports/latest.json --compare=reports/baseline.json
```

### Custom branding

```bash
./bin/report.sh --input=reports/summary.json \
  --org-name="My Company" \
  --color="#e63946" \
  --logo=assets/logo.png
```

### Custom output path

```bash
./bin/report.sh --input=reports/summary.json --output=/tmp/my-report.html
```

The report includes: request metrics, response time percentiles (p50/p90/p95/p99), throughput charts, APDEX score, SLA compliance, and anomaly detection. Open the generated `.html` file in any browser.

REPORTSEOF
fi

if [[ "${WITH_OBSERVABILITY}" == "true" ]]; then
  cat >> "${OUTPUT_DIR}/README.md" << 'OBSEOF'
---

## Observability Stack (Grafana + Prometheus)

A Docker Compose-based stack for real-time k6 metrics visualization.

### Start the stack

```bash
# Core: Grafana + Prometheus
./bin/observability.sh up

# Full: + Loki + Tempo + Pyroscope
./bin/observability.sh up --full
```

### Access dashboards

```bash
# Open Grafana in your browser
./bin/observability.sh open

# Default credentials: admin / admin
# Grafana URL: http://localhost:3000
# Prometheus URL: http://localhost:9090
```

### Run tests with real-time metrics

```bash
# run-test.sh with --prometheus flag pushes metrics to the local stack
./bin/run-test.sh --scenario=api/search --profile=load --prometheus

# Or manually with k6:
k6 run --out experimental-prometheus-rw \
  -e K6_PROMETHEUS_RW_SERVER_URL=http://localhost:9090/api/v1/write \
  dist/my-test.js
```

### Manage the stack

```bash
./bin/observability.sh status    # Check running services
./bin/observability.sh logs      # Tail logs from all services
./bin/observability.sh down      # Stop and remove all services
```

### Custom configuration

Edit `infrastructure/.env.standalone` to change ports, Grafana credentials, or image versions.

OBSEOF
fi

if [[ "${WITH_BINARY}" == "true" ]]; then
  cat >> "${OUTPUT_DIR}/README.md" << 'BINARYEOF'
---

## Standalone Binary

Build a single executable file that embeds all compiled test scenarios. No Node.js, npm, or k6 required to run — just the binary.

### Prerequisites

- **Go 1.21+** installed (`go version`)
- Tests built via `npm run build` (webpack output in `dist/`)

### Build the binary

```bash
# Build for current platform
./bin/build-binary.sh

# Cross-compile for Linux (CI/CD servers)
./bin/build-binary.sh --platform=linux/amd64

# Cross-compile for Windows
./bin/build-binary.sh --platform=windows/amd64
```

The binary is output to `build/k6-<client>` (or `build/k6-<client>.exe` on Windows).

### Use the binary

```bash
# List all embedded test scenarios
./build/k6-<client> list-scripts

# Run a specific scenario with a load profile
./build/k6-<client> run embedded://<scenario>.js -- --profile=load

# Run with environment selection
./build/k6-<client> run embedded://<scenario>.js -- --profile=smoke --env=staging
```

### Examples

```bash
# Build
./bin/build-binary.sh

# List available scripts
./build/k6-<client> list-scripts
#   embedded://api/health-check.js
#   embedded://api/search.js
#   ...

# Run a smoke test
./build/k6-<client> run embedded://api/health-check.js -- --profile=smoke

# Run a load test with Prometheus output
./build/k6-<client> run embedded://api/search.js \
  --out experimental-prometheus-rw \
  -- --profile=load
```

### Data files

The binary embeds all `data/` files (CSV, JSON, TXT, b64) alongside the JS scripts. At runtime, `open()` calls resolve correctly because the binary extracts scripts and data to a temporary directory structure:

```
/tmp/k6-embedded-run/
  dummy/{type}/script.js    <- extracted script
  data/plates.txt           <- extracted data files
```

This ensures relative paths like `open("../../data/file")` work transparently. The temp directory is cleaned up automatically on exit.

### Generating reports from binary runs

The binary runs k6 normally, so you can capture the summary JSON output and generate HTML reports using `bin/report.sh` (if exported with `--with-reports`):

```bash
# Option 1: Use --summary-export to save the JSON summary
./build/k6-<client> run embedded://integration/cp02-baseline.js \
  --summary-export=reports/cp02-summary.json

# Then generate the HTML report
./bin/report.sh --input=reports/cp02-summary.json

# Option 2: Use run-test.sh with the binary as K6 executor
K6_EXEC=./build/k6-<client> ./bin/run-test.sh \
  --scenario=integration/cp02-baseline --profile=load --report
```

> **Note:** The binary itself does not generate HTML reports. It only runs k6 tests. Report generation requires Node.js and the `bin/report.sh` script (included with `--with-reports`).

### CI/CD usage

The binary is ideal for CI/CD pipelines — upload it as a build artifact and run on any server without dependencies:

```bash
# In CI: download the binary and execute
chmod +x ./k6-<client>
./k6-<client> run embedded://api/health-check.js -- --profile=load --env=production

# Capture summary for post-processing
./k6-<client> run embedded://integration/cp02-baseline.js \
  --summary-export=results/summary.json
```

BINARYEOF
  # Replace <client> with actual client name in the binary section
  sed -i '' "s|k6-<client>|k6-${CLIENT}|g" "${OUTPUT_DIR}/README.md"
fi

if [[ "${WITH_MCP}" == "true" ]]; then
  cat >> "${OUTPUT_DIR}/README.md" << 'MCPEOF'
---

## MCP Server (Claude Code Integration)

A Model Context Protocol server that allows Claude Code to interact with your test suite.

### Setup

```bash
cd mcp-server && npm install && npm run build
```

### Available MCP tools

| Tool | Description |
|------|-------------|
| `run_test` | Execute a k6 scenario with a specified profile |
| `validate_config` | Validate environment configuration files |
| `generate_report` | Generate HTML report from summary JSON |
| `observability_status` | Check observability stack status |

### Available MCP resources

| Resource | Description |
|----------|-------------|
| `list_scenarios` | List all available test scenarios |
| `get_metrics` | Read latest test run metrics |

### Configure in Claude Code

The MCP server is pre-configured in `.claude/settings.local.json`. When you open this project with Claude Code, the MCP tools will be available automatically.

MCPEOF
fi

if [[ "${WITH_CLAUDE}" == "true" ]]; then
  cat >> "${OUTPUT_DIR}/README.md" << 'CLAUDEEOF'
---

## Claude Code

This project includes Claude Code configuration for AI-assisted performance testing.

### Skills

- **k6 Load Test** — Create and execute k6 scenarios following framework patterns
- **k6 Analysis** — Analyze test results and provide optimization recommendations

### Usage

Open this project in Claude Code and use natural language to:

- Create new test scenarios
- Run tests and analyze results
- Generate reports
- Troubleshoot performance issues

CLAUDEEOF
fi

# ── Append Updating Framework and footer ──────────────────────────────────────
cat >> "${OUTPUT_DIR}/README.md" << FOOTEREOF
---

## Updating Framework

To update the vendorized framework core:

\`\`\`bash
# From a local directory
./bin/update-framework.sh --from=/path/to/k6-enterprise-framework

# From a GitHub repository
./bin/update-framework.sh --from=github:org/k6-enterprise-framework --ref=v1.0.0
\`\`\`

---
*Exported on $(date -u +"%Y-%m-%d") from k6-enterprise-framework v${FRAMEWORK_VERSION}*
FOOTEREOF
log_success "Generated README.md"
GENERATED_COUNT=$((GENERATED_COUNT + 1))

log_info "Generated ${BOLD}${GENERATED_COUNT}${RESET} configuration files"

# ══════════════════════════════════════════════════════════════════════════════
# Step 5: Post-export validation (T-309)
# ══════════════════════════════════════════════════════════════════════════════
log_step "Step 5/5 — Post-export validation"

if [[ "${SKIP_VALIDATE}" == "true" ]]; then
  log_info "Validation skipped (--skip-validate)"
else
  # Structure check
  MISSING_DIRS=()
  for dir in config scenarios framework/src framework/shared/profiles; do
    if [[ ! -d "${OUTPUT_DIR}/${dir}" ]]; then
      MISSING_DIRS+=("${dir}")
    fi
  done

  if [[ ${#MISSING_DIRS[@]} -gt 0 ]]; then
    log_error "Missing directories: ${MISSING_DIRS[*]}"
    exit 1
  fi
  log_success "Directory structure OK"

  # JSON validity check
  for f in package.json tsconfig.json export-manifest.json; do
    if ! node -e "JSON.parse(require('fs').readFileSync('${OUTPUT_DIR}/${f}','utf8'))" 2>/dev/null; then
      log_error "Invalid JSON: ${f}"
      exit 1
    fi
  done
  log_success "Generated JSON files valid"

  # npm install + typecheck
  log_info "Running npm install..."
  if (cd "${OUTPUT_DIR}" && npm install --loglevel=error 2>&1 | tail -3); then
    log_success "npm install complete"

    log_info "Running typecheck..."
    if (cd "${OUTPUT_DIR}" && npx tsc --noEmit 2>&1); then
      log_success "TypeScript typecheck passed"
    else
      log_warn "Typecheck had errors (the export is complete, review errors above)"
    fi
  else
    log_warn "npm install had issues (the export is complete, review errors above)"
  fi
fi

# ── T-311: Git init ──────────────────────────────────────────────────────────
if [[ "${GIT_INIT}" == "true" ]]; then
  if command -v git &>/dev/null; then
    log_info "Initializing git repository..."
    (
      cd "${OUTPUT_DIR}"
      git init -q
      git add -A
      git commit -q -m "feat: initial export from k6-enterprise-framework v${FRAMEWORK_VERSION}

Exported client: ${CLIENT}
Framework version: ${FRAMEWORK_VERSION}
Export date: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
"
    )
    log_success "Git repository initialized with initial commit"
  else
    log_warn "git not found — skipping --git-init"
  fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# Summary
# ══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}  ╔══════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}  ║              Export Complete!                ║${RESET}"
echo -e "${BOLD}  ╚══════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  ${BOLD}Client:${RESET}    ${CLIENT}"
echo -e "  ${BOLD}Output:${RESET}    ${OUTPUT_DIR}"
echo -e "  ${BOLD}Files:${RESET}     ${TOTAL_COPIED} (${CLIENT_FILE_COUNT} client + ${FRAMEWORK_FILE_COUNT} framework)"
echo -e "  ${BOLD}Imports:${RESET}   ${REWRITE_COUNT} rewritten across ${REWRITE_FILES} files"
echo -e "  ${BOLD}Scenarios:${RESET} ${SCENARIO_COUNT}"

if [[ "${WITH_REPORTS}" == "true" || "${WITH_OBSERVABILITY}" == "true" || "${WITH_BINARY}" == "true" || "${WITH_CLAUDE}" == "true" || "${WITH_MCP}" == "true" ]]; then
  echo ""
  echo "  Capabilities:"
  [[ "${WITH_REPORTS}" == "true" ]] && echo "    bin/report.sh          HTML report generator"
  [[ "${WITH_OBSERVABILITY}" == "true" ]] && echo "    bin/observability.sh    Grafana + Prometheus stack"
  [[ "${WITH_BINARY}" == "true" ]] && echo "    bin/build-binary.sh    Standalone k6 binary builder"
  [[ "${WITH_CLAUDE}" == "true" ]] && echo "    .claude/               Claude Code configuration"
  [[ "${WITH_MCP}" == "true" ]] && echo "    mcp-server/            MCP server for AI integration"
fi
echo ""

# Show directory tree (top-level only)
echo -e "  ${BOLD}Structure:${RESET}"
for item in bin config data docs framework lib scenarios \
            infrastructure mcp-server .claude \
            .eslintrc.json .gitignore export-manifest.json \
            package.json tsconfig.json webpack.config.js; do
  if [[ -e "${OUTPUT_DIR}/${item}" ]]; then
    if [[ -d "${OUTPUT_DIR}/${item}" ]]; then
      count=$(find "${OUTPUT_DIR}/${item}" -type f | wc -l | tr -d ' ')
      echo -e "    ${CYAN}${item}/${RESET}  (${count} files)"
    else
      echo -e "    ${item}"
    fi
  fi
done
echo ""

echo -e "  ${BOLD}Next steps:${RESET}"
echo -e "    cd ${OUTPUT_DIR}"
if [[ "${SKIP_VALIDATE}" == "true" ]]; then
  echo -e "    npm install"
fi
echo -e "    npm run build"
echo -e "    ./bin/run-test.sh --scenario=api/<your-scenario> --profile=smoke"
echo ""
