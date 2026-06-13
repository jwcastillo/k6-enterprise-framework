#!/usr/bin/env bash
# test-binary.sh — Valida que el binario k6 ejecuta correctamente el framework (T-137)
#
# Uso:
#   ./bin/test-binary.sh                          # usa k6 del PATH
#   ./bin/test-binary.sh --binary /opt/k6/k6      # binario especifico
#   ./bin/test-binary.sh --scenario api/smoke-users --client _reference
#
# Salidas:
#   0 — todas las validaciones pasaron
#   1 — una o mas validaciones fallaron

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ── Defaults ──────────────────────────────────────────────────────────────────
K6_BINARY="${K6_BINARY_PATH:-k6}"
CLIENT="_reference"
SCENARIO="api/smoke-users"
PROFILE="smoke"
ENV_NAME="default"
REPORTS_DIR="${ROOT_DIR}/reports/binary-test"

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'

pass() { echo -e "  ${GREEN}✓${RESET}  $*"; }
fail() { echo -e "  ${RED}✗${RESET}  $*"; FAILURES=$((FAILURES + 1)); }
warn() { echo -e "  ${YELLOW}!${RESET}  $*"; }
info() { echo -e "  ${BLUE}→${RESET}  $*"; }

FAILURES=0

# ── Argumentos ────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --binary)   K6_BINARY="$2";   shift 2 ;;
    --client)   CLIENT="$2";      shift 2 ;;
    --scenario) SCENARIO="$2";    shift 2 ;;
    --profile)  PROFILE="$2";     shift 2 ;;
    --env)      ENV_NAME="$2";    shift 2 ;;
    --help|-h)
      echo "Uso: ./bin/test-binary.sh [--binary <ruta>] [--client <nombre>] [--scenario <ruta>]"
      exit 0 ;;
    *) echo "Opcion desconocida: $1"; shift ;;
  esac
done

echo -e "${BOLD}"
echo "  ╔══════════════════════════════════════════════╗"
echo "  ║   k6 Enterprise — Validacion de Binario      ║"
echo "  ╚══════════════════════════════════════════════╝"
echo -e "${RESET}"
echo -e "  Binario:  ${BOLD}${K6_BINARY}${RESET}"
echo -e "  Cliente:  ${BOLD}${CLIENT}${RESET}"
echo -e "  Scenario: ${BOLD}${SCENARIO}${RESET}"
echo -e "  Perfil:   ${BOLD}${PROFILE}${RESET}"
echo ""

# ── CHECK 1: Binario existe y es ejecutable ───────────────────────────────────
echo -e "${BOLD}[1/6] Verificando binario${RESET}"

if command -v "${K6_BINARY}" &>/dev/null || [[ -x "${K6_BINARY}" ]]; then
  pass "Binario encontrado: $(command -v "${K6_BINARY}" 2>/dev/null || echo "${K6_BINARY}")"
else
  fail "Binario k6 no encontrado: '${K6_BINARY}'"
  echo -e "\n${RED}ERROR FATAL: el binario k6 no esta disponible.${RESET}"
  echo "  Instala k6: https://grafana.com/docs/k6/latest/set-up/install-k6/"
  exit 1
fi

# ── CHECK 2: Version del binario ──────────────────────────────────────────────
K6_VERSION_OUTPUT=$("${K6_BINARY}" version 2>&1 || true)
if echo "${K6_VERSION_OUTPUT}" | grep -qE '^k6 v[0-9]+\.[0-9]+'; then
  K6_VER=$(echo "${K6_VERSION_OUTPUT}" | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  pass "Version del binario: ${K6_VER}"
else
  fail "No se pudo obtener la version del binario (output: ${K6_VERSION_OUTPUT})"
fi

# ── CHECK 3: Bundle compilado existe ─────────────────────────────────────────
echo -e "\n${BOLD}[2/6] Verificando bundle compilado${RESET}"

# Mapear cliente a directorio de dist
case "${CLIENT}" in
  _reference) DIST_CLIENT="reference" ;;
  _benchmark) DIST_CLIENT="benchmark" ;;
  *)          DIST_CLIENT="${CLIENT}" ;;
esac

BUNDLE_PATH="${ROOT_DIR}/dist/${DIST_CLIENT}/${SCENARIO}.js"

if [[ -f "${BUNDLE_PATH}" ]]; then
  BUNDLE_SIZE=$(wc -c < "${BUNDLE_PATH}")
  pass "Bundle encontrado: dist/${DIST_CLIENT}/${SCENARIO}.js (${BUNDLE_SIZE} bytes)"
else
  fail "Bundle no encontrado: ${BUNDLE_PATH}"
  info "Ejecuta 'npm run build' para compilar los bundles"
  echo ""
  info "Intentando compilar ahora..."
  if npm run build --prefix "${ROOT_DIR}" 2>&1 | tail -5; then
    if [[ -f "${BUNDLE_PATH}" ]]; then
      pass "Bundle compilado exitosamente"
    else
      fail "La compilacion no genero el bundle esperado"
      exit 1
    fi
  else
    fail "Error al compilar bundles"
    exit 1
  fi
fi

# Verificar que el bundle no esta vacio y tiene exports k6 esperados
if grep -q "export default\|exports\[" "${BUNDLE_PATH}" 2>/dev/null || \
   grep -q '"default"\|handleSummary\|setup' "${BUNDLE_PATH}" 2>/dev/null; then
  pass "Bundle contiene exports k6 validos"
else
  warn "No se detectaron exports k6 estandar en el bundle"
fi

# ── CHECK 4: Sintaxis del script (k6 --dry-run) ───────────────────────────────
echo -e "\n${BOLD}[3/6] Validando sintaxis del script${RESET}"

SYNTAX_OUTPUT=$("${K6_BINARY}" inspect "${BUNDLE_PATH}" 2>&1 || true)
if echo "${SYNTAX_OUTPUT}" | grep -q '"type":"script"'; then
  EXPORT_COUNT=$(echo "${SYNTAX_OUTPUT}" | grep -oE '"exports":\[.*?\]' | head -1 || true)
  pass "Sintaxis valida — k6 inspect OK"
  info "Exports: $(echo "${SYNTAX_OUTPUT}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(', '.join(d.get('exports',[])) or 'n/a')" 2>/dev/null || echo "${EXPORT_COUNT}")"
elif echo "${SYNTAX_OUTPUT}" | grep -qi "error\|invalid\|unexpected"; then
  fail "Error de sintaxis en el bundle: ${SYNTAX_OUTPUT}"
else
  warn "k6 inspect no devolvio resultado esperado (puede ser version antigua)"
  info "Output: ${SYNTAX_OUTPUT:0:120}"
fi

# ── CHECK 5: Ejecucion real (smoke minimo) ────────────────────────────────────
echo -e "\n${BOLD}[4/6] Ejecutando prueba con el binario${RESET}"

mkdir -p "${REPORTS_DIR}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
STDOUT_LOG="${REPORTS_DIR}/run_${TIMESTAMP}.log"
SUMMARY_JSON="${REPORTS_DIR}/summary_${TIMESTAMP}.json"

info "Ejecutando: ${K6_BINARY} run [bundle] --vus 1 --duration 15s"
info "Log: ${STDOUT_LOG}"
echo ""

RUN_EXIT=0
"${K6_BINARY}" run \
  "${BUNDLE_PATH}" \
  --vus 1 \
  --duration 15s \
  --env K6_CLIENT="${CLIENT}" \
  --env K6_PROFILE="${PROFILE}" \
  --env K6_ENV="${ENV_NAME}" \
  --env API_BASE_URL="https://httpbin.org" \
  --summary-export="${SUMMARY_JSON}" \
  --log-format=text \
  2>&1 | tee "${STDOUT_LOG}" || RUN_EXIT=$?

echo ""

if [[ "${RUN_EXIT}" -eq 0 ]]; then
  pass "k6 run finalizo con exit code 0"
else
  fail "k6 run finalizo con exit code ${RUN_EXIT}"
fi

# ── CHECK 6: Validar metricas del resumen ─────────────────────────────────────
echo -e "\n${BOLD}[5/6] Validando metricas del resumen${RESET}"

if [[ -f "${SUMMARY_JSON}" ]]; then
  pass "Archivo de resumen generado: summary_${TIMESTAMP}.json"

  # Parsear metricas con node (k6 v1 framework JSON format)
  METRICS=$(node -e "
    const d = require('${SUMMARY_JSON}');
    const m = d.metrics || {};
    const reqs        = m['http_reqs']?.count ?? 0;
    const p95         = m['http_req_duration']?.['p(95)'] ?? 0;
    const failedRate  = m['http_req_failed']?.rate ?? 0;
    const checkPasses = m['checks']?.passes ?? 0;
    const checkFails  = m['checks']?.fails  ?? 0;
    const checkRate   = (checkPasses + checkFails) > 0
                          ? checkPasses / (checkPasses + checkFails)
                          : 1;
    const iters       = m['iterations']?.count ?? 0;
    process.stdout.write(
      'reqs=' + reqs +
      ' p95=' + p95.toFixed(1) +
      ' failed_rate=' + failedRate.toFixed(4) +
      ' check_rate=' + checkRate.toFixed(4) +
      ' check_passes=' + checkPasses +
      ' check_fails=' + checkFails +
      ' iters=' + iters
    );
  " 2>/dev/null || true)

  if [[ -n "${METRICS}" ]]; then
    HTTP_REQS=$(echo "${METRICS}" | grep -oE 'reqs=[0-9]+' | cut -d= -f2)
    P95=$(echo "${METRICS}" | grep -oE 'p95=[0-9.]+' | cut -d= -f2)
    FAILED_RATE=$(echo "${METRICS}" | grep -oE 'failed_rate=[0-9.]+' | cut -d= -f2)
    CHECK_RATE=$(echo "${METRICS}" | grep -oE 'check_rate=[0-9.]+' | cut -d= -f2)
    CHECK_PASSES=$(echo "${METRICS}" | grep -oE 'check_passes=[0-9]+' | cut -d= -f2)
    CHECK_FAILS=$(echo "${METRICS}" | grep -oE 'check_fails=[0-9]+' | cut -d= -f2)
    ITERS=$(echo "${METRICS}" | grep -oE 'iters=[0-9]+' | cut -d= -f2)

    info "Iteraciones completadas: ${ITERS:-?}"
    info "Peticiones HTTP:         ${HTTP_REQS:-?}"
    info "p95 response time:       ${P95:-?}ms"
    info "Tasa de errores HTTP:    $(node -e "process.stdout.write((${FAILED_RATE:-0}*100).toFixed(2)+'%')" 2>/dev/null || echo "${FAILED_RATE}")"
    info "Checks:                  ${CHECK_PASSES:-0} ✓ / ${CHECK_FAILS:-0} ✗  ($(node -e "process.stdout.write((${CHECK_RATE:-0}*100).toFixed(1)+'%')" 2>/dev/null))"
    echo ""

    [[ "${HTTP_REQS:-0}" -gt 0 ]] && \
      pass "Peticiones HTTP ejecutadas: ${HTTP_REQS}" || \
      fail "No se registraron peticiones HTTP"

    P95_INT=$(node -e "process.stdout.write(String(Math.round(${P95:-9999})))" 2>/dev/null || echo "9999")
    if [[ "${P95_INT}" -lt 3000 ]]; then
      pass "p95 response time: ${P95}ms (< 3000ms)"
    else
      warn "p95 response time: ${P95}ms (> 3000ms — puede ser latencia de red)"
    fi

    FAILED_PCT=$(node -e "process.stdout.write(String(Math.round(${FAILED_RATE:-1}*1000)))" 2>/dev/null || echo "1000")
    if [[ "${FAILED_PCT}" -lt 50 ]]; then
      pass "Tasa de errores HTTP: $(node -e "process.stdout.write((${FAILED_RATE:-0}*100).toFixed(2)+'%')" 2>/dev/null) (< 5%)"
    else
      fail "Tasa de errores HTTP elevada: ${FAILED_RATE}"
    fi

    CHECK_PCT=$(node -e "process.stdout.write(String(Math.round(${CHECK_RATE:-0}*100)))" 2>/dev/null || echo "0")
    if [[ "${CHECK_PCT}" -ge 90 ]]; then
      pass "Tasa de checks: $(node -e "process.stdout.write((${CHECK_RATE:-0}*100).toFixed(2)+'%')" 2>/dev/null) (>= 90%)"
    else
      fail "Tasa de checks baja: ${CHECK_RATE} (< 90%)"
    fi
  else
    warn "No se pudieron parsear las metricas del resumen JSON"
  fi
else
  warn "Archivo de resumen JSON no encontrado"
fi

# ── CHECK 6: Logs de ejecucion ────────────────────────────────────────────────
echo -e "\n${BOLD}[6/6] Analizando logs de ejecucion${RESET}"

if [[ -f "${STDOUT_LOG}" ]]; then
  # Verificar que el framework se inicializo
  if grep -q "execution-engine\|Starting:\|smoke-users" "${STDOUT_LOG}" 2>/dev/null; then
    pass "Framework inicializado correctamente (execution-engine activo)"
  else
    warn "No se encontro log de inicializacion del framework"
  fi

  # Verificar que no hay errores criticos de JS
  if grep -qiE "GoError|ReferenceError|TypeError|SyntaxError" "${STDOUT_LOG}" 2>/dev/null; then
    ERRORS=$(grep -iE "GoError|ReferenceError|TypeError|SyntaxError" "${STDOUT_LOG}" | head -3)
    fail "Errores JS/Go detectados en logs:\n${ERRORS}"
  else
    pass "Sin errores de runtime JS/Go en logs"
  fi

  # Contar iteraciones completadas
  ITER_LINE=$(grep -E "iterations|default.*[0-9]+ ✓" "${STDOUT_LOG}" | tail -3 || true)
  if [[ -n "${ITER_LINE}" ]]; then
    info "Iteraciones: $(echo "${ITER_LINE}" | head -1 | tr -s ' ')"
  fi
fi

# ── Resumen final ─────────────────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}──────────────────────────────────────────────${RESET}"
echo ""

if [[ "${FAILURES}" -eq 0 ]]; then
  echo -e "  ${GREEN}${BOLD}VALIDACION EXITOSA${RESET} — El binario k6 ejecuta el framework correctamente"
  echo ""
  echo -e "  Binario:  ${K6_BINARY} (${K6_VER:-desconocido})"
  echo -e "  Bundle:   dist/${DIST_CLIENT}/${SCENARIO}.js"
  echo -e "  Reporte:  ${STDOUT_LOG}"
  [[ -f "${SUMMARY_JSON}" ]] && echo -e "  Metricas: ${SUMMARY_JSON}"
  echo ""
  exit 0
else
  echo -e "  ${RED}${BOLD}VALIDACION FALLIDA${RESET} — ${FAILURES} verificacion(es) fallaron"
  echo ""
  echo -e "  Log completo: ${STDOUT_LOG}"
  echo ""
  exit 1
fi
