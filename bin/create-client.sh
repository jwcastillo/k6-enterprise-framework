#!/usr/bin/env bash
# T-060: create-client.sh — Non-interactive client scaffolder
#
# Creates a complete client directory structure instantly.
# Identical output to `node bin/generate.js` → Client, without prompts.
#
# Usage:
#   bin/create-client.sh <client-name>
#   bin/create-client.sh my-team
#   bin/create-client.sh acme-corp --service=orders

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CLIENTS_DIR="${ROOT_DIR}/clients"
TEMPLATES_DIR="${ROOT_DIR}/shared/templates/generators"

# ── Colors ────────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
  BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BLUE=''; BOLD=''; RESET=''
fi

log_info()    { echo -e "${BLUE}[INFO]${RESET}  $*"; }
log_success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
log_error()   { echo -e "${RED}[ERROR]${RESET} $*" >&2; }

# ── Help ──────────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<EOF

k6 Enterprise Framework — Client Scaffolder

USAGE:
  bin/create-client.sh <name> [OPTIONS]

ARGUMENTS:
  <name>            Client name (letters, numbers, hyphens, underscores only)

OPTIONS:
  --service=<name>  Default service name (default: api)
  --desc=<text>     Description for README and config

EXAMPLES:
  bin/create-client.sh my-team
  bin/create-client.sh acme-corp --service=payments --desc="Acme Corp load tests"

NOTES:
  - Completes in < 5 seconds
  - Generated config passes framework validation
  - Example scenario is immediately runnable after npm run build

EOF
  exit 0
fi

# ── Argument parsing ──────────────────────────────────────────────────────────
CLIENT_NAME="${1:-}"
SERVICE_NAME="api"
DESCRIPTION=""

shift 2>/dev/null || true
for arg in "$@"; do
  case "$arg" in
    --service=*) SERVICE_NAME="${arg#*=}" ;;
    --desc=*)    DESCRIPTION="${arg#*=}" ;;
    *) log_error "Unknown argument: $arg"; exit 1 ;;
  esac
done

# ── Validation ────────────────────────────────────────────────────────────────
if [[ -z "$CLIENT_NAME" ]]; then
  log_error "Client name is required."
  echo "Usage: bin/create-client.sh <name> [--service=<name>]"
  exit 1
fi

# Validate name: only a-z A-Z 0-9 - _
if [[ ! "$CLIENT_NAME" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  log_error "Invalid client name: '${CLIENT_NAME}'"
  log_error "Only letters, numbers, hyphens (-) and underscores (_) are allowed."
  log_error "Examples: my-team, acme_corp, ClienteA"
  exit 1
fi

CLIENT_DIR="${CLIENTS_DIR}/${CLIENT_NAME}"
if [[ -d "$CLIENT_DIR" ]]; then
  log_error "Client '${CLIENT_NAME}' already exists at ${CLIENT_DIR}"
  log_error "Choose a different name or remove the existing directory first."
  exit 1
fi

[[ -z "$DESCRIPTION" ]] && DESCRIPTION="${CLIENT_NAME} load tests"

# PascalCase helper
pascal_case() {
  echo "$1" | sed -E 's/(^|[-_])([a-z])/\U\2/g'
}
SERVICE_CLASS=$(pascal_case "$SERVICE_NAME")

# ── Create directory structure ────────────────────────────────────────────────
log_info "Creating client '${CLIENT_NAME}'..."

mkdir -p \
  "${CLIENT_DIR}/config" \
  "${CLIENT_DIR}/data" \
  "${CLIENT_DIR}/lib/services" \
  "${CLIENT_DIR}/lib/factories" \
  "${CLIENT_DIR}/scenarios/api" \
  "${CLIENT_DIR}/scenarios/integration" \
  "${CLIENT_DIR}/scenarios/mixed"

# ── config/default.json ───────────────────────────────────────────────────────
cat > "${CLIENT_DIR}/config/default.json" << EOF
{
  "version": "1.0",
  "client": "${CLIENT_NAME}",
  "description": "${DESCRIPTION}",
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
      "clientName": "${CLIENT_NAME}",
      "primaryColor": "#0066cc"
    }
  }
}
EOF

# ── config/staging.json ───────────────────────────────────────────────────────
cat > "${CLIENT_DIR}/config/staging.json" << EOF
{
  "version": "1.0",
  "client": "${CLIENT_NAME}",
  "environment": "staging",
  "services": {
    "${SERVICE_NAME}": {
      "baseUrl": "\${__ENV.STAGING_BASE_URL}",
      "timeout": 15000
    }
  }
}
EOF

# ── config/production.json ────────────────────────────────────────────────────
cat > "${CLIENT_DIR}/config/production.json" << EOF
{
  "version": "1.0",
  "client": "${CLIENT_NAME}",
  "environment": "production",
  "services": {
    "${SERVICE_NAME}": {
      "baseUrl": "\${__ENV.PROD_BASE_URL}",
      "timeout": 10000
    }
  }
}
EOF

# ── Example scenario ──────────────────────────────────────────────────────────
cat > "${CLIENT_DIR}/scenarios/api/smoke-${SERVICE_NAME}.ts" << EOF
/**
 * smoke-${SERVICE_NAME} — Quick health check for ${SERVICE_NAME} service
 *
 * Run:
 *   ./bin/run-test.sh --client=${CLIENT_NAME} --scenario=api/smoke-${SERVICE_NAME} --profile=smoke
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
EOF

# ── lib/services/ ─────────────────────────────────────────────────────────────
cat > "${CLIENT_DIR}/lib/services/${SERVICE_NAME}.service.ts" << EOF
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
EOF

# ── .gitignore ────────────────────────────────────────────────────────────────
cat > "${CLIENT_DIR}/.gitignore" << 'EOF'
.env
*.env.local
EOF

# ── README.md ─────────────────────────────────────────────────────────────────
cat > "${CLIENT_DIR}/README.md" << EOF
# ${CLIENT_NAME}

${DESCRIPTION}

## Quick start

\`\`\`bash
export BASE_URL="https://api.example.com"
npm run build
./bin/run-test.sh --client=${CLIENT_NAME} --scenario=api/smoke-${SERVICE_NAME} --profile=smoke
\`\`\`

## Structure

\`\`\`
clients/${CLIENT_NAME}/
  config/          # JSON configuration files per environment
  data/            # test data pools (CSV/JSON)
  lib/services/    # service object classes
  lib/factories/   # data factory classes
  scenarios/       # k6 test scripts
\`\`\`
EOF

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
log_success "Client '${CLIENT_NAME}' created successfully!"
echo ""
echo -e "${BOLD}Structure:${RESET}"
find "${CLIENT_DIR}" -not -path "*/node_modules/*" | sort | sed "s|${ROOT_DIR}/||" | head -30
echo ""
echo -e "${BOLD}Next steps:${RESET}"
echo "  1. Edit clients/${CLIENT_NAME}/config/default.json  (set your BASE_URL)"
echo "  2. npm run build"
echo "  3. ./bin/run-test.sh --client=${CLIENT_NAME} --scenario=api/smoke-${SERVICE_NAME}"
