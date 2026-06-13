#!/usr/bin/env bash
# observability.sh — Manage k6 observability stack (Grafana + Prometheus)
#
# Starts, stops, and inspects the Docker Compose-based observability stack
# used for local k6 load test visualization. Standalone client repos run k6
# locally and push metrics via --out experimental-prometheus-rw to the
# containerized Prometheus, which Grafana queries for dashboards.
#
# Subcommands:
#   up [--full]   Start core stack (Grafana + Prometheus), or full stack with
#                 Loki + Tempo + Pyroscope when --full is specified
#   down          Stop and remove all services
#   status        Show running services, ports, and URLs
#   open          Open Grafana in the default browser
#   logs          Tail Docker Compose logs
#   --help        Show usage information
#
# Exit codes:
#   0  success
#   1  error (Docker not found, compose failure, etc.)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/infrastructure/docker-compose.standalone.yml"
ENV_FILE="${ROOT_DIR}/infrastructure/.env.standalone"
FRAMEWORK_VERSION="$(node -e "console.log(require('${ROOT_DIR}/package.json').version)" 2>/dev/null || echo "0.1.0")"

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
  echo "  ║   k6 Framework — Observability Stack         ║"
  echo "  ║                  v${FRAMEWORK_VERSION}                      ║"
  echo "  ╚══════════════════════════════════════════════╝"
  echo -e "${RESET}"
}

# ── Help ──────────────────────────────────────────────────────────────────────
print_help() {
  cat <<EOF
${BOLD}k6 Framework — observability.sh${RESET}

Manage the local observability stack (Grafana + Prometheus) for k6 load testing.

USAGE:
  ./bin/observability.sh <command> [options]

${BOLD}── Commands ──────────────────────────────────────────────────────────────${RESET}
  up              Start core stack (Grafana + Prometheus)
  up --full       Start full stack including Loki, Tempo, and Pyroscope
  down            Stop and remove all services and networks
  status          Show running services with ports and URLs
  open            Open Grafana dashboard in default browser
  logs            Tail logs from all running services
  --help, -h      Show this help message

${BOLD}── Environment ────────────────────────────────────────────────────────────${RESET}
  GRAFANA_HOST_PORT     Grafana port (default: 3000)
  GF_SECURITY_ADMIN_USER      Grafana admin user (default: admin)
  GF_SECURITY_ADMIN_PASSWORD  Grafana admin password (default: admin)

  Configuration is loaded from: infrastructure/.env.standalone
  Copy infrastructure/.env.standalone to customize.

${BOLD}── k6 Integration ─────────────────────────────────────────────────────────${RESET}
  Run k6 with Prometheus remote-write output to push metrics:

    k6 run --out experimental-prometheus-rw \\
      -e K6_PROMETHEUS_RW_SERVER_URL=http://localhost:9090/api/v1/write \\
      dist/my-test.js

  Or use the run-test.sh wrapper with --prometheus flag.

${BOLD}── Examples ────────────────────────────────────────────────────────────────${RESET}
  ./bin/observability.sh up               # Start Grafana + Prometheus
  ./bin/observability.sh up --full        # Start full observability stack
  ./bin/observability.sh status           # Check running services
  ./bin/observability.sh open             # Open Grafana in browser
  ./bin/observability.sh logs             # Tail all service logs
  ./bin/observability.sh down             # Stop everything
EOF
}

# ── Preflight checks ─────────────────────────────────────────────────────────

# Verify Docker is installed and running
check_docker() {
  if ! command -v docker &>/dev/null; then
    log_error "Docker is not installed. Please install Docker Desktop or Docker Engine."
    log_info  "  macOS:  brew install --cask docker"
    log_info  "  Linux:  https://docs.docker.com/engine/install/"
    exit 1
  fi

  if ! docker info &>/dev/null; then
    log_error "Docker daemon is not running. Please start Docker and try again."
    exit 1
  fi
}

# Verify compose file exists
check_compose_file() {
  if [[ ! -f "${COMPOSE_FILE}" ]]; then
    log_error "Compose file not found: ${COMPOSE_FILE}"
    log_info  "Make sure you are running from the project root directory."
    exit 1
  fi
}

# Build docker compose command with optional env file
compose_cmd() {
  local cmd="docker compose -f ${COMPOSE_FILE}"
  if [[ -f "${ENV_FILE}" ]]; then
    cmd="${cmd} --env-file ${ENV_FILE}"
  fi
  echo "${cmd}"
}

# ── Subcommands ───────────────────────────────────────────────────────────────

cmd_up() {
  local full="false"
  if [[ "${1:-}" == "--full" ]]; then
    full="true"
  fi

  check_docker
  check_compose_file

  if [[ "${full}" == "true" ]]; then
    log_step "Starting full observability stack (Grafana + Prometheus + Loki + Tempo + Pyroscope)..."
    $(compose_cmd) --profile observability up -d
  else
    log_step "Starting core observability stack (Grafana + Prometheus)..."
    $(compose_cmd) up -d
  fi

  local exit_code=$?
  if [[ ${exit_code} -eq 0 ]]; then
    echo ""
    log_success "Observability stack is running."
    echo ""
    local grafana_port="${GRAFANA_HOST_PORT:-3000}"
    log_info "Grafana:    ${BOLD}http://localhost:${grafana_port}${RESET}"
    log_info "Prometheus: ${BOLD}http://localhost:9090${RESET} (internal, use for k6 remote-write)"
    echo ""
    log_info "Push k6 metrics with:"
    echo -e "  ${DIM}k6 run --out experimental-prometheus-rw dist/my-test.js${RESET}"
    echo ""
    if [[ "${full}" == "true" ]]; then
      log_info "Full stack services also available:"
      log_info "  Loki:      http://loki:3100      (internal)"
      log_info "  Tempo:     http://tempo:3200      (internal)"
      log_info "  Pyroscope: http://pyroscope:4040   (internal)"
    fi
  else
    log_error "Failed to start observability stack (exit code: ${exit_code})"
    exit ${exit_code}
  fi
}

cmd_down() {
  check_docker
  check_compose_file

  log_step "Stopping observability stack..."
  $(compose_cmd) --profile observability down

  local exit_code=$?
  if [[ ${exit_code} -eq 0 ]]; then
    log_success "All services stopped."
  else
    log_error "Failed to stop services (exit code: ${exit_code})"
    exit ${exit_code}
  fi
}

cmd_status() {
  check_docker
  check_compose_file

  local grafana_port="${GRAFANA_HOST_PORT:-3000}"

  echo ""
  echo -e "${BOLD}  Observability Stack Status${RESET}"
  echo -e "  ─────────────────────────────────────────────────"
  printf "  ${BOLD}%-14s %-12s %-8s %s${RESET}\n" "SERVICE" "STATUS" "PORT" "URL"
  echo -e "  ─────────────────────────────────────────────────"

  # Check each service
  local services=("grafana:${grafana_port}:http://localhost:${grafana_port}" "prometheus:9090:http://localhost:9090" "loki:3100:-" "tempo:3200:-" "pyroscope:4040:-")

  for entry in "${services[@]}"; do
    IFS=':' read -r svc port url <<< "${entry}"
    local container="k6-${svc}"
    local status

    if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${container}$"; then
      status="${GREEN}running${RESET}"
    elif docker ps -a --format '{{.Names}}' 2>/dev/null | grep -q "^${container}$"; then
      status="${YELLOW}stopped${RESET}"
    else
      status="${DIM}not created${RESET}"
    fi

    printf "  %-14s %-22b %-8s %s\n" "${svc}" "${status}" "${port}" "${url}"
  done

  echo -e "  ─────────────────────────────────────────────────"
  echo ""

  # Show docker compose ps for extra detail
  log_info "Docker Compose services:"
  $(compose_cmd) --profile observability ps 2>/dev/null || true
  echo ""
}

cmd_open() {
  local grafana_port="${GRAFANA_HOST_PORT:-3000}"
  local url="http://localhost:${grafana_port}"

  log_info "Opening Grafana at ${BOLD}${url}${RESET}..."

  if [[ "$(uname -s)" == "Darwin" ]]; then
    open "${url}"
  elif command -v xdg-open &>/dev/null; then
    xdg-open "${url}"
  elif command -v wslview &>/dev/null; then
    wslview "${url}"
  else
    log_warn "Could not detect a browser opener. Please open manually:"
    log_info "  ${url}"
  fi
}

cmd_logs() {
  check_docker
  check_compose_file

  log_info "Tailing logs (Ctrl+C to stop)..."
  $(compose_cmd) --profile observability logs -f
}

# ── Main ──────────────────────────────────────────────────────────────────────

main() {
  # Load env file if it exists
  if [[ -f "${ENV_FILE}" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "${ENV_FILE}"
    set +a
  fi

  local command="${1:-}"

  case "${command}" in
    up)
      print_banner
      cmd_up "${2:-}"
      ;;
    down)
      print_banner
      cmd_down
      ;;
    status)
      print_banner
      cmd_status
      ;;
    open)
      cmd_open
      ;;
    logs)
      cmd_logs
      ;;
    --help|-h|help)
      print_banner
      print_help
      ;;
    "")
      print_banner
      log_error "No command specified. Use --help for usage."
      exit 1
      ;;
    *)
      print_banner
      log_error "Unknown command '${command}'. Use --help for usage."
      exit 1
      ;;
  esac
}

main "$@"
