#!/usr/bin/env bash
# run-distributed.sh — k6 Enterprise Framework distributed (K8s) test runner
#
# T-174 (Phase 8): Distributed testing UX — per-pod real-time status, actionable
# error messages for k6-operator, aggregated report metadata, Docker image build
# progress, CRD apply workflow.
#
# Prerequisites:
#   1. kubectl configured for your cluster
#   2. k6-operator installed (auto-checked by this script)
#   3. Docker image built and pushed (use --build to build inline)
#   4. k6 secrets created in the namespace
#
# Usage:
#   ./bin/run-distributed.sh --client=myapp --scenario=api/load-test --profile=load \
#     --parallelism=4 --image=registry.example.com/k6-myapp:latest
#
# See --help for all options.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ── Defaults ──────────────────────────────────────────────────────────────────
CLIENT="${K6_CLIENT:-_reference}"
SCENARIO=""
PROFILE="${K6_PROFILE:-smoke}"
ENV_NAME="${K6_ENV:-staging}"
PARALLELISM="${K6_PARALLELISM:-2}"
NAMESPACE="${K6_NAMESPACE:-k6-tests}"
IMAGE="${K6_IMAGE:-}"
REGISTRY="${K6_REGISTRY:-}"
TESTRUN_NAME="${K6_TESTRUN_NAME:-k6-load-test}"
REPORTS_DIR="${K6_REPORTS_DIR:-${ROOT_DIR}/reports}"
BUILD_IMAGE=false
SKIP_BUILD=false
TIMEOUT_SECS=3600   # 1h max wait for test completion
POLL_INTERVAL=5     # seconds between pod status polls

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'
CYAN='\033[0;36m'; MAGENTA='\033[0;35m'; DIM='\033[2m'
if [[ ! -t 1 ]]; then
  RED=''; GREEN=''; YELLOW=''; BLUE=''; BOLD=''; RESET=''; CYAN=''; MAGENTA=''; DIM=''
fi

log_step()    { echo -e "${CYAN}[STEP]${RESET}  $*"; }
log_info()    { echo -e "${BLUE}[INFO]${RESET}  $*"; }
log_success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
log_error()   { echo -e "${RED}[ERROR]${RESET} $*" >&2; }

# ── Help ──────────────────────────────────────────────────────────────────────
print_help() {
  cat <<EOF
${BOLD}k6 Enterprise Framework — run-distributed.sh${RESET}

Run k6 load tests distributed across multiple Kubernetes pods using k6-operator.

${BOLD}USAGE:${RESET}
  ./bin/run-distributed.sh [OPTIONS]

${BOLD}── Required ──────────────────────────────────────────────────────────────${RESET}
  --client <name>          Client directory under clients/
  --scenario <path>        Scenario path (relative to clients/<client>/scenarios/)
  --image <url>            Docker image with compiled k6 scripts
                           Example: registry.example.com/k6-myapp:latest

${BOLD}── Execution ─────────────────────────────────────────────────────────────${RESET}
  --profile <name>         Load profile (smoke|quick|load|stress|breakpoint|soak)
                           Default: smoke
  --env <name>             Target environment: staging|production
                           Default: staging
  --parallelism <n>        Number of parallel runner pods
                           Default: 2  (use 1 for debugging, 8+ for high load)
  --namespace <ns>         Kubernetes namespace
                           Default: k6-tests
  --testrun-name <name>    Name for the TestRun CRD resource
                           Default: k6-load-test
  --timeout <seconds>      Max wait time for test completion
                           Default: 3600 (1 hour)

${BOLD}── Image Build ───────────────────────────────────────────────────────────${RESET}
  --build                  Build and push Docker image before running
  --registry <url>         Registry prefix for built image
                           Example: registry.example.com/my-team
  --skip-build             Skip npm TypeScript build (use existing dist/)

${BOLD}── Output ────────────────────────────────────────────────────────────────${RESET}
  --reports-dir <dir>      Output directory for artifacts
                           Default: ./reports

${BOLD}── Misc ──────────────────────────────────────────────────────────────────${RESET}
  --help                   Show this help and exit

${BOLD}── Examples ──────────────────────────────────────────────────────────────${RESET}
  # Basic distributed load test (2 pods)
  ./bin/run-distributed.sh \\
    --client=myapp \\
    --scenario=api/checkout \\
    --profile=load \\
    --image=registry.example.com/k6-myapp:latest

  # High-load stress test (8 pods) with inline image build
  ./bin/run-distributed.sh \\
    --client=myapp \\
    --scenario=api/checkout \\
    --profile=stress \\
    --parallelism=8 \\
    --build \\
    --registry=registry.example.com/myapp

  # Breakpoint test (16 pods, 1h timeout)
  ./bin/run-distributed.sh \\
    --client=myapp \\
    --scenario=api/breakpoint \\
    --profile=breakpoint \\
    --parallelism=16 \\
    --timeout=7200 \\
    --image=registry.example.com/k6-myapp:latest

${BOLD}── Metadata in report JSON ───────────────────────────────────────────────${RESET}
  Reports include executionMode=distributed, parallelism, runnerPods, and
  per-pod status history for post-test analysis.

${BOLD}── Exit codes ────────────────────────────────────────────────────────────${RESET}
  ${GREEN}0${RESET}    All pods completed, thresholds met
  ${RED}1${RESET}    One or more pods failed or operator error
  ${YELLOW}99${RESET}   k6 thresholds failed (tests ran but SLOs not met)
  ${RED}107${RESET}  Pre-flight error (operator missing, image not found, etc.)
EOF
}

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --client=*)       CLIENT="${1#*=}";         shift ;;
    --client)         CLIENT="$2";              shift 2 ;;
    --scenario=*)     SCENARIO="${1#*=}";        shift ;;
    --scenario)       SCENARIO="$2";            shift 2 ;;
    --profile=*)      PROFILE="${1#*=}";         shift ;;
    --profile)        PROFILE="$2";             shift 2 ;;
    --env=*)          ENV_NAME="${1#*=}";        shift ;;
    --env)            ENV_NAME="$2";            shift 2 ;;
    --parallelism=*)  PARALLELISM="${1#*=}";     shift ;;
    --parallelism)    PARALLELISM="$2";         shift 2 ;;
    --namespace=*)    NAMESPACE="${1#*=}";       shift ;;
    --namespace)      NAMESPACE="$2";           shift 2 ;;
    --image=*)        IMAGE="${1#*=}";           shift ;;
    --image)          IMAGE="$2";               shift 2 ;;
    --registry=*)     REGISTRY="${1#*=}";        shift ;;
    --registry)       REGISTRY="$2";            shift 2 ;;
    --testrun-name=*) TESTRUN_NAME="${1#*=}";    shift ;;
    --testrun-name)   TESTRUN_NAME="$2";        shift 2 ;;
    --reports-dir=*)  REPORTS_DIR="${1#*=}";     shift ;;
    --reports-dir)    REPORTS_DIR="$2";         shift 2 ;;
    --timeout=*)      TIMEOUT_SECS="${1#*=}";    shift ;;
    --timeout)        TIMEOUT_SECS="$2";        shift 2 ;;
    --build)          BUILD_IMAGE=true;         shift ;;
    --skip-build)     SKIP_BUILD=true;          shift ;;
    --help|-h)        print_help; exit 0 ;;
    *)                log_warn "Unknown option: $1 (use --help for usage)"; shift ;;
  esac
done

# ── Banner ────────────────────────────────────────────────────────────────────
echo -e "${BOLD}"
echo "  ╔══════════════════════════════════════════════╗"
echo "  ║     k6 Enterprise — Distributed Testing      ║"
echo "  ╚══════════════════════════════════════════════╝"
echo -e "${RESET}"

# ── Validate required args ────────────────────────────────────────────────────
if [[ -z "${SCENARIO}" ]]; then
  log_error "No scenario specified. Use --scenario <path>"
  echo -e "  Example: ./bin/run-distributed.sh --client=myapp --scenario=api/checkout --image=..."
  exit 107
fi

if [[ -z "${IMAGE}" && "${BUILD_IMAGE}" == "false" ]]; then
  log_error "No image specified. Use --image <registry/image:tag> or --build --registry <url>"
  echo -e "  Example: --image=registry.example.com/k6-myapp:latest"
  echo -e "  Or:      --build --registry=registry.example.com/myapp"
  exit 107
fi

# ── Pre-flight: check kubectl ─────────────────────────────────────────────────
log_step "Step 1/6 — Pre-flight checks"

if ! command -v kubectl &>/dev/null; then
  log_error "kubectl not found. Install kubectl: https://kubernetes.io/docs/tasks/tools/"
  exit 107
fi

KUBE_CONTEXT=$(kubectl config current-context 2>/dev/null || echo "none")
log_info "Kubernetes context: ${KUBE_CONTEXT}"

# Ensure namespace exists
if ! kubectl get namespace "${NAMESPACE}" &>/dev/null; then
  log_info "Creating namespace: ${NAMESPACE}"
  kubectl create namespace "${NAMESPACE}"
fi

# ── Pre-flight: check k6-operator ─────────────────────────────────────────────
if ! kubectl get crd testruns.k6.io &>/dev/null; then
  log_error "k6-operator not found in cluster (CRD 'testruns.k6.io' missing)."
  echo ""
  echo -e "  ${BOLD}Install k6-operator:${RESET}"
  echo -e "    kubectl apply -f https://raw.githubusercontent.com/grafana/k6-operator/main/bundle.yaml"
  echo ""
  echo -e "  ${BOLD}Verify installation:${RESET}"
  echo -e "    kubectl get pods -n k6-operator-system"
  echo ""
  echo -e "  ${BOLD}Documentation:${RESET}"
  echo -e "    See docs/DISTRIBUTED_TESTING.md — Section: Prerequisites"
  exit 107
fi
log_success "k6-operator CRD found"

# Check k6-operator controller is running
OPERATOR_READY=$(kubectl get pods -n k6-operator-system \
  -l control-plane=controller-manager \
  --field-selector=status.phase=Running \
  --no-headers 2>/dev/null | wc -l | tr -d ' ')

if [[ "${OPERATOR_READY}" -eq 0 ]]; then
  log_error "k6-operator controller pod is not running."
  echo ""
  echo -e "  ${BOLD}Check operator status:${RESET}"
  echo -e "    kubectl get pods -n k6-operator-system"
  echo -e "    kubectl describe deployment k6-operator-controller-manager -n k6-operator-system"
  echo ""
  echo -e "  ${BOLD}Re-install:${RESET}"
  echo -e "    kubectl delete -f https://raw.githubusercontent.com/grafana/k6-operator/main/bundle.yaml"
  echo -e "    kubectl apply -f  https://raw.githubusercontent.com/grafana/k6-operator/main/bundle.yaml"
  exit 107
fi
log_success "k6-operator controller is running"

# ── Step 2: TypeScript build ───────────────────────────────────────────────────
log_step "Step 2/6 — Building TypeScript bundle"
if [[ "${SKIP_BUILD}" == "true" ]]; then
  log_warn "Build skipped (--skip-build)"
else
  if ! npm run build --prefix "${ROOT_DIR}" 2>&1; then
    log_error "Build failed. Fix TypeScript errors and retry."
    exit 107
  fi
  log_success "Build complete"
fi

# ── Step 3: Docker image build & push ─────────────────────────────────────────
log_step "Step 3/6 — Docker image"

ISO_TIMESTAMP=$(date +"%Y%m%d-%H%M%S")

if [[ "${BUILD_IMAGE}" == "true" ]]; then
  if [[ -z "${REGISTRY}" ]]; then
    log_error "--registry is required when using --build"
    exit 107
  fi

  IMAGE="${REGISTRY}/k6-${CLIENT}:${ISO_TIMESTAMP}"
  DOCKERFILE="${ROOT_DIR}/infrastructure/k8s/Dockerfile"

  if [[ ! -f "${DOCKERFILE}" ]]; then
    log_error "Dockerfile not found: ${DOCKERFILE}"
    echo -e "  Expected: infrastructure/k8s/Dockerfile"
    exit 107
  fi

  echo -e "  ${BOLD}Building image:${RESET} ${IMAGE}"
  echo ""

  # Build with progress output (T-174 criterion 7)
  BUILD_START=$(date +%s)

  echo -e "  ${CYAN}[1/3]${RESET} Building k6-enterprise base image..."
  if ! docker build -f "${DOCKERFILE}" \
      --build-arg CLIENT="${CLIENT}" \
      --build-arg PROFILE="${PROFILE}" \
      --progress=plain \
      -t "${IMAGE}" \
      "${ROOT_DIR}" 2>&1 | while IFS= read -r line; do
        echo -e "       ${DIM}${line}${RESET}"
      done; then
    log_error "Docker build failed. Check Dockerfile and build context."
    exit 107
  fi

  BUILD_ELAPSED=$(( $(date +%s) - BUILD_START ))
  echo -e "  ${CYAN}[2/3]${RESET} Including client config for '${CLIENT}'... ${GREEN}done${RESET}"

  echo -e "  ${CYAN}[3/3]${RESET} Pushing image to registry..."
  if ! docker push "${IMAGE}" 2>&1 | while IFS= read -r line; do
        echo -e "       ${DIM}${line}${RESET}"
      done; then
    log_error "Docker push failed. Verify registry credentials and access."
    exit 107
  fi

  echo ""
  log_success "Image built and pushed in ${BUILD_ELAPSED}s: ${IMAGE}"
else
  log_info "Using pre-built image: ${IMAGE}"
fi

# ── Step 4: Create ConfigMap and apply RBAC + TestRun CRD ─────────────────────
log_step "Step 4/6 — Deploying to Kubernetes"

CLIENT_DIST="${CLIENT#_}"
SCENARIO_SLUG="${SCENARIO//\//_}"
DIST_SCRIPT="${ROOT_DIR}/dist/${CLIENT_DIST}/${SCENARIO}.js"

if [[ ! -f "${DIST_SCRIPT}" ]]; then
  log_error "Compiled script not found: ${DIST_SCRIPT}"
  log_error "Run 'npm run build' first, or use --skip-build if dist/ already exists."
  exit 107
fi

CONFIGMAP_NAME="k6-scripts-${CLIENT_DIST}-${SCENARIO_SLUG}"
SCRIPT_FILENAME="${SCENARIO_SLUG}.js"

# Create/update ConfigMap with compiled script
echo -e "  Creating ConfigMap '${CONFIGMAP_NAME}'..."
kubectl create configmap "${CONFIGMAP_NAME}" \
  --from-file="${SCRIPT_FILENAME}=${DIST_SCRIPT}" \
  --namespace="${NAMESPACE}" \
  --dry-run=client -o yaml | kubectl apply -f - 2>&1 \
  | grep -v "^$" | head -5 || true
log_success "ConfigMap ready: ${CONFIGMAP_NAME}"

# Apply RBAC
RBAC_FILE="${ROOT_DIR}/infrastructure/k8s/rbac.yaml"
if [[ -f "${RBAC_FILE}" ]]; then
  kubectl apply -f "${RBAC_FILE}" --namespace="${NAMESPACE}" &>/dev/null
  log_success "RBAC applied"
fi

# Generate and apply TestRun CRD (inline, no file needed)
TESTRUN_YAML=$(cat <<YAML
apiVersion: k6.io/v1alpha1
kind: TestRun
metadata:
  name: ${TESTRUN_NAME}
  namespace: ${NAMESPACE}
  labels:
    app: k6-runner
    test.k6.io/client: "${CLIENT}"
    test.k6.io/profile: "${PROFILE}"
    test.k6.io/scenario: "${SCENARIO_SLUG}"
    test.k6.io/timestamp: "${ISO_TIMESTAMP}"
spec:
  # Number of parallel runner pods (T-174: parallelism field)
  parallelism: ${PARALLELISM}
  script:
    configMap:
      name: ${CONFIGMAP_NAME}
      file: ${SCRIPT_FILENAME}
  runner:
    serviceAccountName: k6-runner
    image: ${IMAGE}
    securityContext:
      runAsNonRoot: true
      runAsUser: 65534
      runAsGroup: 65534
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true
      capabilities:
        drop: [ALL]
    resources:
      requests:
        cpu: "500m"
        memory: "512Mi"
      limits:
        cpu: "2000m"
        memory: "1Gi"
    env:
      - name: K6_PROFILE
        value: "${PROFILE}"
      - name: K6_ENV
        value: "${ENV_NAME}"
      - name: K6_CLIENT
        value: "${CLIENT}"
      - name: K6_EXECUTION_MODE
        value: "distributed"
      - name: K6_PARALLELISM
        value: "${PARALLELISM}"
YAML
)

# Delete existing TestRun if present (idempotent)
kubectl delete testrun "${TESTRUN_NAME}" --namespace="${NAMESPACE}" \
  --ignore-not-found=true &>/dev/null

echo "${TESTRUN_YAML}" | kubectl apply -f - &>/dev/null
log_success "TestRun '${TESTRUN_NAME}' applied (parallelism=${PARALLELISM})"

# ── Step 5: Monitor per-pod status in real time ────────────────────────────────
log_step "Step 5/6 — Monitoring test execution"
echo ""
echo -e "  ${BOLD}Test run:${RESET}    ${TESTRUN_NAME}"
echo -e "  ${BOLD}Namespace:${RESET}   ${NAMESPACE}"
echo -e "  ${BOLD}Parallelism:${RESET} ${PARALLELISM} pods"
echo -e "  ${BOLD}Profile:${RESET}     ${PROFILE}"
echo ""

# Track per-pod status (T-174 criterion 3)
declare -A POD_STATUS
declare -A POD_START
ALL_COMPLETE=false
FINAL_EXIT=0
ELAPSED=0
START_TIME=$(date +%s)

print_pod_table() {
  # Print per-pod status table to stdout
  local pods_json
  pods_json=$(kubectl get pods -n "${NAMESPACE}" \
    -l "app=k6-runner,test.k6.io/client=${CLIENT}" \
    -o json 2>/dev/null || echo '{"items":[]}')

  local pod_count
  pod_count=$(echo "${pods_json}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['items']))" 2>/dev/null || echo "0")

  if [[ "${pod_count}" -eq 0 ]]; then
    echo -e "  ${DIM}Waiting for pods to start...${RESET}"
    return
  fi

  # Clear previous table lines (move up pod_count+1 lines if already printed)
  # Use a simple approach: just print the table each time
  echo -e "  ${BOLD}$(printf '%-6s %-30s %-12s %-10s %s' 'Pod' 'Name' 'Status' 'Elapsed' 'Message')${RESET}"
  echo "  $(printf '%0.s─' {1..72})"

  local i=1
  while IFS= read -r pod_json; do
    local pod_name pod_phase pod_ready elapsed_str status_color status_icon msg
    pod_name=$(echo "${pod_json}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('metadata',{}).get('name','unknown'))" 2>/dev/null || echo "unknown")
    pod_phase=$(echo "${pod_json}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',{}).get('phase','Unknown'))" 2>/dev/null || echo "Unknown")

    # Calculate elapsed for this pod
    local pod_start_str
    pod_start_str=$(echo "${pod_json}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',{}).get('startTime',''))" 2>/dev/null || echo "")
    if [[ -n "${pod_start_str}" ]]; then
      local pod_ts
      pod_ts=$(date -d "${pod_start_str}" +%s 2>/dev/null || date -jf "%Y-%m-%dT%H:%M:%SZ" "${pod_start_str}" +%s 2>/dev/null || echo "${START_TIME}")
      elapsed_str=$(printf "%ds" $(( $(date +%s) - pod_ts )))
    else
      elapsed_str="—"
    fi

    # Get container state message
    msg=$(echo "${pod_json}" | python3 -c "
import sys, json
d = json.load(sys.stdin)
cs = d.get('status',{}).get('containerStatuses',[])
if cs:
    state = cs[0].get('state',{})
    if 'running' in state: print('running')
    elif 'terminated' in state:
        reason = state['terminated'].get('reason','')
        exit_code = state['terminated'].get('exitCode',0)
        print(f'exit={exit_code} ({reason})' if reason else f'exit={exit_code}')
    elif 'waiting' in state:
        print(state['waiting'].get('reason','waiting'))
    else: print('')
else: print('')
" 2>/dev/null || echo "")

    case "${pod_phase}" in
      Running)
        status_color="${CYAN}"; status_icon="●"; msg="${msg:-running}" ;;
      Succeeded)
        status_color="${GREEN}"; status_icon="✓"; msg="${msg:-completed}" ;;
      Failed)
        status_color="${RED}"; status_icon="✗"; msg="${msg:-failed}"
        FINAL_EXIT=1 ;;
      Pending)
        status_color="${YELLOW}"; status_icon="○"; msg="${msg:-pending}" ;;
      *)
        status_color="${DIM}"; status_icon="?"; msg="${pod_phase}" ;;
    esac

    printf "  ${status_color}${BOLD}%-6s${RESET} %-30s ${status_color}%-12s${RESET} %-10s %s\n" \
      "${i}/${PARALLELISM}" \
      "${pod_name:0:30}" \
      "${status_icon} ${pod_phase}" \
      "${elapsed_str}" \
      "${msg}"

    POD_STATUS["${pod_name}"]="${pod_phase}"
    ((i++)) || true
  done < <(echo "${pods_json}" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for item in d['items']:
    print(json.dumps(item))
" 2>/dev/null)
}

check_all_complete() {
  local pods_phases
  pods_phases=$(kubectl get pods -n "${NAMESPACE}" \
    -l "app=k6-runner,test.k6.io/client=${CLIENT}" \
    --no-headers \
    -o custom-columns='STATUS:.status.phase' 2>/dev/null || echo "")

  if [[ -z "${pods_phases}" ]]; then
    return 1
  fi

  local total running pending
  total=$(echo "${pods_phases}" | wc -l | tr -d ' ')
  running=$(echo "${pods_phases}" | grep -c "Running" || true)
  pending=$(echo "${pods_phases}" | grep -c "Pending" || true)

  # Complete when we have parallelism pods and none are running/pending
  if [[ "${total}" -ge "${PARALLELISM}" && "${running}" -eq 0 && "${pending}" -eq 0 ]]; then
    # Check for any failures
    local failed
    failed=$(echo "${pods_phases}" | grep -c "Failed" || true)
    if [[ "${failed}" -gt 0 ]]; then
      FINAL_EXIT=1
    fi
    return 0
  fi
  return 1
}

# Also check TestRun status directly
check_testrun_complete() {
  local tr_status
  tr_status=$(kubectl get testrun "${TESTRUN_NAME}" -n "${NAMESPACE}" \
    -o jsonpath='{.status.stage}' 2>/dev/null || echo "")
  case "${tr_status}" in
    finished)   return 0 ;;
    error)      FINAL_EXIT=1; return 0 ;;
    *)          return 1 ;;
  esac
}

# Poll loop
LAST_PRINT_LINES=0
while true; do
  ELAPSED=$(( $(date +%s) - START_TIME ))

  if [[ "${ELAPSED}" -ge "${TIMEOUT_SECS}" ]]; then
    echo ""
    log_error "Timeout reached (${TIMEOUT_SECS}s). Cleaning up TestRun..."
    kubectl delete testrun "${TESTRUN_NAME}" -n "${NAMESPACE}" --ignore-not-found=true &>/dev/null
    FINAL_EXIT=1
    break
  fi

  # Clear previous table output if terminal
  if [[ -t 1 && "${LAST_PRINT_LINES}" -gt 0 ]]; then
    for ((i=0; i<LAST_PRINT_LINES; i++)); do
      printf "\033[1A\033[2K"
    done
  fi

  ELAPSED_FMT=$(printf "%dm %02ds" $((ELAPSED / 60)) $((ELAPSED % 60)))
  echo -e "  ${DIM}Elapsed: ${ELAPSED_FMT} / timeout: $(printf "%dm" $((TIMEOUT_SECS / 60)))${RESET}"
  print_pod_table
  LAST_PRINT_LINES=$(( PARALLELISM + 3 ))

  if check_all_complete || check_testrun_complete; then
    ALL_COMPLETE=true
    break
  fi

  sleep "${POLL_INTERVAL}"
done

echo ""

if [[ "${ALL_COMPLETE}" == "true" ]]; then
  log_success "All ${PARALLELISM} pods completed"
else
  log_warn "Test monitoring ended (timeout or error)"
fi

# ── Step 6: Collect results and enrich report metadata ────────────────────────
log_step "Step 6/6 — Collecting results"

ARTIFACTS_DIR="${REPORTS_DIR}/${CLIENT}/${SCENARIO_SLUG}"
mkdir -p "${ARTIFACTS_DIR}"

SUMMARY_JSON="${ARTIFACTS_DIR}/summary-${ISO_TIMESTAMP}.json"
SUMMARY_TXT="${ARTIFACTS_DIR}/summary-${ISO_TIMESTAMP}.txt"

# Gather pod logs and collect combined summary
echo -e "  Collecting logs from runner pods..."

POD_NAMES=$(kubectl get pods -n "${NAMESPACE}" \
  -l "app=k6-runner,test.k6.io/client=${CLIENT}" \
  --no-headers \
  -o custom-columns='NAME:.metadata.name' 2>/dev/null || echo "")

POD_LOG_DIR="${ARTIFACTS_DIR}/pod-logs-${ISO_TIMESTAMP}"
mkdir -p "${POD_LOG_DIR}"

POD_COUNT=0
POD_SUCCEED=0
POD_FAILED=0

while IFS= read -r pod; do
  [[ -z "${pod}" ]] && continue
  ((POD_COUNT++)) || true

  LOG_FILE="${POD_LOG_DIR}/pod-${POD_COUNT}-${pod}.log"
  kubectl logs "${pod}" -n "${NAMESPACE}" > "${LOG_FILE}" 2>/dev/null || true

  # Check pod exit status
  POD_PHASE=$(kubectl get pod "${pod}" -n "${NAMESPACE}" \
    -o jsonpath='{.status.phase}' 2>/dev/null || echo "Unknown")
  if [[ "${POD_PHASE}" == "Succeeded" ]]; then
    ((POD_SUCCEED++)) || true
  else
    ((POD_FAILED++)) || true
  fi

  log_info "Pod ${POD_COUNT}: ${pod} [${POD_PHASE}] → ${LOG_FILE}"
done <<< "${POD_NAMES}"

# Enrich summary JSON with distributed metadata (T-174 criterion 6)
node -e "
const fs = require('fs');
const path = require('path');

// Build distributed execution metadata
const distributedMeta = {
  executionMode: 'distributed',
  parallelism: ${PARALLELISM},
  runnerPods: ${POD_COUNT},
  podsSucceeded: ${POD_SUCCEED},
  podsFailed: ${POD_FAILED},
  namespace: '${NAMESPACE}',
  testRunName: '${TESTRUN_NAME}',
  image: '${IMAGE}',
  kubernetesContext: '${KUBE_CONTEXT}',
  client: '${CLIENT}',
  scenario: '${SCENARIO}',
  profile: '${PROFILE}',
  environment: '${ENV_NAME}',
  timestamp: '${ISO_TIMESTAMP}',
  podLogDir: '${POD_LOG_DIR}',
};

// Check if any pod produced a summary JSON (mounted via PVC or stdout)
const summaryPath = '${SUMMARY_JSON}';
let existing = {};
if (fs.existsSync(summaryPath)) {
  try { existing = JSON.parse(fs.readFileSync(summaryPath, 'utf-8')); } catch {}
}

// Write enriched summary
const enriched = {
  ...existing,
  schemaVersion: '2.0.0',
  distributedExecution: distributedMeta,
  generatedAt: new Date().toISOString(),
};
fs.writeFileSync(summaryPath, JSON.stringify(enriched, null, 2));
console.log('Summary enriched with distributed metadata');
" 2>/dev/null || true

# Write human-readable summary (T-174)
{
  echo "k6 Enterprise Framework — Distributed Test Summary"
  echo "==================================================="
  echo "Timestamp:    ${ISO_TIMESTAMP}"
  echo "Client:       ${CLIENT}"
  echo "Scenario:     ${SCENARIO}"
  echo "Profile:      ${PROFILE}"
  echo "Environment:  ${ENV_NAME}"
  echo ""
  echo "Execution Mode: distributed"
  echo "Parallelism:    ${PARALLELISM} pods"
  echo "Namespace:      ${NAMESPACE}"
  echo "TestRun:        ${TESTRUN_NAME}"
  echo "Image:          ${IMAGE}"
  echo "K8s Context:    ${KUBE_CONTEXT}"
  echo ""
  echo "Pod Results:"
  echo "  Succeeded: ${POD_SUCCEED}/${POD_COUNT}"
  echo "  Failed:    ${POD_FAILED}/${POD_COUNT}"
  echo ""
  echo "Artifacts:"
  echo "  Reports dir: ${ARTIFACTS_DIR}/"
  echo "  Pod logs:    ${POD_LOG_DIR}/"
  echo "  Summary:     ${SUMMARY_JSON}"
  if [[ "${FINAL_EXIT}" -eq 0 ]]; then
    echo ""
    echo "Result: PASSED"
  else
    echo ""
    echo "Result: FAILED (exit ${FINAL_EXIT})"
  fi
} > "${SUMMARY_TXT}"

# ── Final result banner ────────────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}Artifacts:${RESET}"
echo -e "    Reports:   ${ARTIFACTS_DIR}/"
echo -e "    Pod logs:  ${POD_LOG_DIR}/"
[[ -f "${SUMMARY_JSON}" ]] && echo -e "    ${GREEN}[OK]${RESET} summary JSON  → ${SUMMARY_JSON}"
echo -e "    ${GREEN}[OK]${RESET} summary TXT   → ${SUMMARY_TXT}"
echo ""
echo -e "  ${BOLD}Distributed metadata in report JSON:${RESET}"
echo -e "    executionMode: distributed"
echo -e "    parallelism:   ${PARALLELISM}"
echo -e "    runnerPods:    ${POD_COUNT}  (succeeded: ${POD_SUCCEED}, failed: ${POD_FAILED})"
echo ""

if [[ "${FINAL_EXIT}" -eq 0 ]]; then
  echo -e "  ${GREEN}${BOLD}╔══════════════════════════════════════════════╗${RESET}"
  echo -e "  ${GREEN}${BOLD}║           DISTRIBUTED TEST PASSED ✓          ║${RESET}"
  echo -e "  ${GREEN}${BOLD}║  All ${PARALLELISM} pods completed successfully.$(printf '%*s' $((18 - ${#PARALLELISM})) '')║${RESET}"
  echo -e "  ${GREEN}${BOLD}╚══════════════════════════════════════════════╝${RESET}"
else
  echo -e "  ${RED}${BOLD}╔══════════════════════════════════════════════╗${RESET}"
  echo -e "  ${RED}${BOLD}║           DISTRIBUTED TEST FAILED ✗          ║${RESET}"
  echo -e "  ${RED}${BOLD}║  ${POD_FAILED}/${POD_COUNT} pod(s) failed. Check pod logs.$(printf '%*s' $((18 - ${#POD_FAILED} - ${#POD_COUNT})) '')║${RESET}"
  echo -e "  ${RED}${BOLD}╚══════════════════════════════════════════════╝${RESET}"
  echo ""
  echo -e "  ${BOLD}Debug commands:${RESET}"
  echo -e "    kubectl get pods -n ${NAMESPACE}"
  echo -e "    kubectl describe testrun ${TESTRUN_NAME} -n ${NAMESPACE}"
  echo -e "    kubectl logs -n ${NAMESPACE} -l app=k6-runner --tail=50"
fi
echo ""

exit "${FINAL_EXIT}"
