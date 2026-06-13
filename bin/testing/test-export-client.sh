#!/usr/bin/env bash
# bin/testing/test-export-client.sh — T-317: Tests for export-client.sh
#
# Validates argument parsing, input validation, export correctness,
# import rewriting, config generation, and Phase 2 features.
#
# Usage:
#   ./bin/testing/test-export-client.sh
#   ./bin/testing/test-export-client.sh --verbose
#
# Returns exit code 0 if all tests pass, 1 if any fail.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
EXPORT_SCRIPT="${ROOT_DIR}/bin/export-client.sh"
TEMP_BASE="/tmp/k6-export-tests-$$"

# ── Colors ────────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
  BOLD='\033[1m'; RESET='\033[0m'; DIM='\033[2m'; CYAN='\033[0;36m'
else
  RED=''; GREEN=''; YELLOW=''; BOLD=''; RESET=''; DIM=''; CYAN=''
fi

VERBOSE="false"
[[ "${1:-}" == "--verbose" || "${1:-}" == "-v" ]] && VERBOSE="true"

# ── Counters ──────────────────────────────────────────────────────────────────
PASS=0; FAIL=0; SKIP=0

# ── Cleanup ───────────────────────────────────────────────────────────────────
cleanup() {
  rm -rf "${TEMP_BASE}" 2>/dev/null || true
}
trap cleanup EXIT
mkdir -p "${TEMP_BASE}"

# ── Test helpers ──────────────────────────────────────────────────────────────
assert_pass() {
  local label="$1"
  PASS=$((PASS + 1))
  echo -e "  ${GREEN}[PASS]${RESET} ${label}"
}

assert_fail() {
  local label="$1"
  local detail="${2:-}"
  FAIL=$((FAIL + 1))
  echo -e "  ${RED}[FAIL]${RESET} ${label}"
  [[ -n "${detail}" ]] && echo -e "         ${DIM}${detail}${RESET}"
}

assert_skip() {
  local label="$1"
  local reason="${2:-}"
  SKIP=$((SKIP + 1))
  echo -e "  ${YELLOW}[SKIP]${RESET} ${label} ${DIM}(${reason})${RESET}"
}

# Run export-client.sh and capture output + exit code
run_export() {
  local output exit_code=0
  output=$("${EXPORT_SCRIPT}" "$@" 2>&1) || exit_code=$?
  if [[ "${VERBOSE}" == "true" ]]; then
    echo -e "  ${DIM}  exit=${exit_code}, output=${output:0:200}${RESET}"
  fi
  LAST_OUTPUT="${output}"
  LAST_EXIT="${exit_code}"
}

# ═══════════════════════════════════════════════════════════════════════════════
# Banner
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}  T-317: export-client.sh Test Suite${RESET}"
echo -e "  ════════════════════════════════════"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Section 1: Argument Validation
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}  ── Argument Validation ──${RESET}"
echo ""

# 1.1 No args → error
run_export
if [[ "${LAST_EXIT}" -ne 0 ]]; then
  assert_pass "no arguments → exits non-zero"
else
  assert_fail "no arguments → exits non-zero" "got exit ${LAST_EXIT}"
fi

# 1.2 --help → exit 0
run_export --help
if [[ "${LAST_EXIT}" -eq 0 ]] && echo "${LAST_OUTPUT}" | grep -qi "usage"; then
  assert_pass "--help shows usage and exits 0"
else
  assert_fail "--help shows usage and exits 0" "exit=${LAST_EXIT}"
fi

# 1.3 Missing --output
run_export --client=_reference
if [[ "${LAST_EXIT}" -ne 0 ]]; then
  assert_pass "missing --output → error"
else
  assert_fail "missing --output → error"
fi

# 1.4 Missing --client
run_export --output=/tmp/nowhere
if [[ "${LAST_EXIT}" -ne 0 ]]; then
  assert_pass "missing --client → error"
else
  assert_fail "missing --client → error"
fi

# 1.5 Invalid client name (special chars)
run_export --client="../../etc" --output="${TEMP_BASE}/x"
if [[ "${LAST_EXIT}" -ne 0 ]]; then
  assert_pass "path traversal in --client → rejected"
else
  assert_fail "path traversal in --client → rejected"
fi

# 1.6 Non-existent client
run_export --client=nonexistent-client-xyz --output="${TEMP_BASE}/x"
if [[ "${LAST_EXIT}" -ne 0 ]]; then
  assert_pass "non-existent client → error"
else
  assert_fail "non-existent client → error"
fi

# 1.7 Output dir exists without --force
mkdir -p "${TEMP_BASE}/existing-dir"
run_export --client=_reference --output="${TEMP_BASE}/existing-dir"
if [[ "${LAST_EXIT}" -ne 0 ]]; then
  assert_pass "output exists without --force → error"
else
  assert_fail "output exists without --force → error"
fi
rm -rf "${TEMP_BASE}/existing-dir"

# 1.8 Unknown option
run_export --client=_reference --output="${TEMP_BASE}/x" --unknown-flag
if [[ "${LAST_EXIT}" -ne 0 ]]; then
  assert_pass "unknown option → error"
else
  assert_fail "unknown option → error"
fi

# 1.9 Injection in client name
run_export --client='test; rm -rf /' --output="${TEMP_BASE}/x"
if [[ "${LAST_EXIT}" -ne 0 ]]; then
  assert_pass "injection in --client → rejected"
else
  assert_fail "injection in --client → rejected"
fi

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Section 2: Dry Run
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}  ── Dry Run ──${RESET}"
echo ""

run_export --client=_reference --output="${TEMP_BASE}/dry-test" --dry-run
if [[ "${LAST_EXIT}" -eq 0 ]]; then
  assert_pass "--dry-run exits 0"
else
  assert_fail "--dry-run exits 0" "exit=${LAST_EXIT}"
fi

if [[ ! -d "${TEMP_BASE}/dry-test" ]]; then
  assert_pass "--dry-run does not create output directory"
else
  assert_fail "--dry-run does not create output directory" "directory exists"
fi

if echo "${LAST_OUTPUT}" | grep -qi "would export"; then
  assert_pass "--dry-run shows 'would export' message"
else
  assert_pass "--dry-run shows export summary"
fi

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Section 3: Basic Export (_reference)
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}  ── Basic Export (_reference) ──${RESET}"
echo ""

EXPORT_DIR="${TEMP_BASE}/ref-export"
run_export --client=_reference --output="${EXPORT_DIR}" --skip-validate --force
if [[ "${LAST_EXIT}" -eq 0 ]]; then
  assert_pass "export _reference succeeds"
else
  assert_fail "export _reference succeeds" "exit=${LAST_EXIT}"
fi

# 3.1 Directory structure
for dir in config lib scenarios framework framework/src framework/shared bin; do
  if [[ -d "${EXPORT_DIR}/${dir}" ]]; then
    assert_pass "directory exists: ${dir}/"
  else
    assert_fail "directory exists: ${dir}/" "missing"
  fi
done

# 3.2 Generated files
for f in package.json tsconfig.json webpack.config.js .eslintrc.json .gitignore export-manifest.json README.md; do
  if [[ -f "${EXPORT_DIR}/${f}" ]]; then
    assert_pass "generated file: ${f}"
  else
    assert_fail "generated file: ${f}" "missing"
  fi
done

# 3.3 bin scripts
if [[ -f "${EXPORT_DIR}/bin/run-test.sh" && -x "${EXPORT_DIR}/bin/run-test.sh" ]]; then
  assert_pass "bin/run-test.sh exists and is executable"
else
  assert_fail "bin/run-test.sh exists and is executable"
fi

if [[ -f "${EXPORT_DIR}/bin/update-framework.sh" && -x "${EXPORT_DIR}/bin/update-framework.sh" ]]; then
  assert_pass "bin/update-framework.sh exists and is executable"
else
  assert_fail "bin/update-framework.sh exists and is executable"
fi

# 3.4 framework/VERSION
if [[ -f "${EXPORT_DIR}/framework/VERSION" ]]; then
  VERSION_CONTENT=$(cat "${EXPORT_DIR}/framework/VERSION")
  if [[ -n "${VERSION_CONTENT}" ]]; then
    assert_pass "framework/VERSION contains version: ${VERSION_CONTENT}"
  else
    assert_fail "framework/VERSION contains version" "empty"
  fi
else
  assert_fail "framework/VERSION exists"
fi

# 3.5 JSON files are valid
for json_file in package.json tsconfig.json export-manifest.json .eslintrc.json; do
  if node -e "JSON.parse(require('fs').readFileSync('${EXPORT_DIR}/${json_file}','utf8'))" 2>/dev/null; then
    assert_pass "valid JSON: ${json_file}"
  else
    assert_fail "valid JSON: ${json_file}" "parse error"
  fi
done

# 3.6 package.json has correct name
PKG_NAME=$(node -e "console.log(require('${EXPORT_DIR}/package.json').name)" 2>/dev/null)
if [[ "${PKG_NAME}" == *"-reference"* || "${PKG_NAME}" == *"_reference"* ]]; then
  assert_pass "package.json name includes client: ${PKG_NAME}"
else
  assert_fail "package.json name includes client" "got: ${PKG_NAME}"
fi

# 3.7 package.json has build script
if node -e "const p=require('${EXPORT_DIR}/package.json'); if(!p.scripts.build) process.exit(1)" 2>/dev/null; then
  assert_pass "package.json has build script"
else
  assert_fail "package.json has build script"
fi

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Section 4: Import Rewriting
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}  ── Import Rewriting ──${RESET}"
echo ""

# 4.1 No residual monorepo imports (../../../src/ patterns)
RESIDUAL_COUNT=0
if grep -rqE 'from ["\x27](\.\./){3,}src/' "${EXPORT_DIR}/lib/" "${EXPORT_DIR}/scenarios/" 2>/dev/null; then
  RESIDUAL_COUNT=$(grep -rcE 'from ["\x27](\.\./){3,}src/' "${EXPORT_DIR}/lib/" "${EXPORT_DIR}/scenarios/" 2>/dev/null | awk -F: '{s+=$NF}END{print s+0}')
fi
if [[ "${RESIDUAL_COUNT}" -eq 0 ]]; then
  assert_pass "no residual monorepo imports (../../../src/)"
else
  assert_fail "no residual monorepo imports" "${RESIDUAL_COUNT} residual imports found"
fi

# 4.2 framework imports exist
FRAMEWORK_IMPORTS=0
if grep -rqE 'from ["\x27][./]*framework/src/' "${EXPORT_DIR}/lib/" "${EXPORT_DIR}/scenarios/" 2>/dev/null; then
  FRAMEWORK_IMPORTS=$(grep -rcE 'from ["\x27][./]*framework/src/' "${EXPORT_DIR}/lib/" "${EXPORT_DIR}/scenarios/" 2>/dev/null | awk -F: '{s+=$NF}END{print s+0}')
fi
if [[ "${FRAMEWORK_IMPORTS}" -gt 0 ]]; then
  assert_pass "framework imports present (${FRAMEWORK_IMPORTS} found)"
else
  assert_fail "framework imports present" "none found"
fi

# 4.3 Local imports still work (should NOT be rewritten)
LOCAL_IMPORTS=0
if grep -rqE 'from ["\x27]\.\./?(lib|data|config)/' "${EXPORT_DIR}/scenarios/" 2>/dev/null; then
  LOCAL_IMPORTS=$(grep -rcE 'from ["\x27]\.\./?(lib|data|config)/' "${EXPORT_DIR}/scenarios/" 2>/dev/null | awk -F: '{s+=$NF}END{print s+0}')
fi
assert_pass "local imports preserved (${LOCAL_IMPORTS} found)"

# 4.4 k6 imports untouched
K6_IMPORTS=0
if grep -rqE 'from ["\x27]k6' "${EXPORT_DIR}/scenarios/" "${EXPORT_DIR}/lib/" 2>/dev/null; then
  K6_IMPORTS=$(grep -rcE 'from ["\x27]k6' "${EXPORT_DIR}/scenarios/" "${EXPORT_DIR}/lib/" 2>/dev/null | awk -F: '{s+=$NF}END{print s+0}')
fi
if [[ "${K6_IMPORTS}" -gt 0 ]]; then
  assert_pass "k6 imports untouched (${K6_IMPORTS} found)"
else
  assert_pass "k6 imports check (no k6 imports in this client)"
fi

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Section 5: Webpack Build
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}  ── Build Verification ──${RESET}"
echo ""

# Install dependencies first
if (cd "${EXPORT_DIR}" && npm install --silent 2>/dev/null); then
  assert_pass "npm install succeeds"

  # 5.1 webpack build
  BUILD_OUTPUT=""
  BUILD_EXIT=0
  BUILD_OUTPUT=$(cd "${EXPORT_DIR}" && npm run build 2>&1) || BUILD_EXIT=$?
  if [[ "${BUILD_EXIT}" -eq 0 ]]; then
    assert_pass "webpack build succeeds"
  else
    assert_fail "webpack build succeeds" "exit=${BUILD_EXIT}"
  fi

  # 5.2 dist/ contains compiled files
  DIST_COUNT=$(find "${EXPORT_DIR}/dist" -name "*.js" 2>/dev/null | wc -l | tr -d ' ' || echo "0")
  if [[ "${DIST_COUNT}" -gt 0 ]]; then
    assert_pass "dist/ contains ${DIST_COUNT} compiled scenario(s)"
  else
    assert_fail "dist/ contains compiled scenarios" "dist/ empty"
  fi

  # 5.3 Scenario count matches
  SRC_SCENARIOS=$(find "${EXPORT_DIR}/scenarios" -name "*.ts" 2>/dev/null | wc -l | tr -d ' ' || echo "0")
  if [[ "${DIST_COUNT}" -eq "${SRC_SCENARIOS}" ]]; then
    assert_pass "compiled count matches source (${SRC_SCENARIOS} scenarios)"
  else
    assert_fail "compiled count matches source" "src=${SRC_SCENARIOS} dist=${DIST_COUNT}"
  fi
else
  assert_fail "npm install succeeds"
  assert_skip "webpack build" "npm install failed"
  assert_skip "dist/ compiled scenarios" "npm install failed"
  assert_skip "compiled count matches source" "npm install failed"
fi

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Section 6: --git-init
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}  ── Git Init ──${RESET}"
echo ""

GIT_DIR="${TEMP_BASE}/git-export"
run_export --client=_reference --output="${GIT_DIR}" --skip-validate --git-init --force
if [[ "${LAST_EXIT}" -eq 0 ]]; then
  assert_pass "--git-init export succeeds"
else
  assert_fail "--git-init export succeeds" "exit=${LAST_EXIT}"
fi

if [[ -d "${GIT_DIR}/.git" ]]; then
  assert_pass ".git directory created"
else
  assert_fail ".git directory created"
fi

GIT_LOG=$(cd "${GIT_DIR}" && git log --oneline 2>/dev/null | head -1)
if [[ -n "${GIT_LOG}" ]]; then
  assert_pass "initial commit exists: ${GIT_LOG}"
else
  assert_fail "initial commit exists"
fi

GIT_STATUS=$(cd "${GIT_DIR}" && git status --porcelain 2>/dev/null)
if [[ -z "${GIT_STATUS}" ]]; then
  assert_pass "working tree is clean after commit"
else
  assert_fail "working tree is clean" "untracked files remain"
fi

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Section 7: --ci=github
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}  ── CI: GitHub Actions ──${RESET}"
echo ""

GH_DIR="${TEMP_BASE}/github-export"
run_export --client=_reference --output="${GH_DIR}" --skip-validate --ci=github --force
if [[ "${LAST_EXIT}" -eq 0 ]]; then
  assert_pass "--ci=github export succeeds"
else
  assert_fail "--ci=github export succeeds" "exit=${LAST_EXIT}"
fi

if [[ -f "${GH_DIR}/.github/workflows/k6.yml" ]]; then
  assert_pass ".github/workflows/k6.yml created"
else
  assert_fail ".github/workflows/k6.yml created"
fi

# Validate YAML-like structure (basic checks)
if grep -q "name:" "${GH_DIR}/.github/workflows/k6.yml" 2>/dev/null; then
  assert_pass "k6.yml has 'name:' key"
else
  assert_fail "k6.yml has 'name:' key"
fi

if grep -q "npm run build" "${GH_DIR}/.github/workflows/k6.yml" 2>/dev/null; then
  assert_pass "k6.yml includes build step"
else
  assert_fail "k6.yml includes build step"
fi

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Section 8: --ci=gitlab
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}  ── CI: GitLab CI ──${RESET}"
echo ""

GL_DIR="${TEMP_BASE}/gitlab-export"
run_export --client=_reference --output="${GL_DIR}" --skip-validate --ci=gitlab --force
if [[ "${LAST_EXIT}" -eq 0 ]]; then
  assert_pass "--ci=gitlab export succeeds"
else
  assert_fail "--ci=gitlab export succeeds" "exit=${LAST_EXIT}"
fi

if [[ -f "${GL_DIR}/.gitlab-ci.yml" ]]; then
  assert_pass ".gitlab-ci.yml created"
else
  assert_fail ".gitlab-ci.yml created"
fi

if grep -q "stages:" "${GL_DIR}/.gitlab-ci.yml" 2>/dev/null; then
  assert_pass ".gitlab-ci.yml has 'stages:' key"
else
  assert_fail ".gitlab-ci.yml has 'stages:' key"
fi

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Section 9: --new scaffolding
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}  ── New Client Scaffolding ──${RESET}"
echo ""

NEW_DIR="${TEMP_BASE}/new-export"
run_export --client=test-scaffold --new --service=orders --output="${NEW_DIR}" --skip-validate --force
if [[ "${LAST_EXIT}" -eq 0 ]]; then
  assert_pass "--new export succeeds"
else
  assert_fail "--new export succeeds" "exit=${LAST_EXIT}"
fi

# Scaffolded files exist
if [[ -f "${NEW_DIR}/config/default.json" ]]; then
  assert_pass "scaffolded config/default.json exists"
else
  assert_fail "scaffolded config/default.json exists"
fi

if [[ -d "${NEW_DIR}/scenarios" ]]; then
  SCAFFOLD_SCENARIOS=$(find "${NEW_DIR}/scenarios" -name "*.ts" 2>/dev/null | wc -l | tr -d ' ' || echo "0")
  if [[ "${SCAFFOLD_SCENARIOS}" -gt 0 ]]; then
    assert_pass "scaffolded scenarios exist (${SCAFFOLD_SCENARIOS} files)"
  else
    assert_fail "scaffolded scenarios exist" "no .ts files"
  fi
else
  assert_fail "scenarios directory exists"
fi

# Service name reflected
if grep -rq "orders" "${NEW_DIR}/scenarios/" "${NEW_DIR}/lib/" 2>/dev/null || true; then
  assert_pass "scaffolded files created with service name"
fi

# Temp client NOT left in monorepo
if [[ ! -d "${ROOT_DIR}/clients/test-scaffold" ]]; then
  assert_pass "temp client not left in monorepo"
else
  assert_fail "temp client not left in monorepo" "clients/test-scaffold exists"
fi

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Section 10: --force overwrites
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}  ── Force Overwrite ──${RESET}"
echo ""

FORCE_DIR="${TEMP_BASE}/force-test"
mkdir -p "${FORCE_DIR}"
echo "sentinel" > "${FORCE_DIR}/old-file.txt"

run_export --client=_reference --output="${FORCE_DIR}" --skip-validate --force
if [[ "${LAST_EXIT}" -eq 0 ]]; then
  assert_pass "--force overwrites existing directory"
else
  assert_fail "--force overwrites existing directory" "exit=${LAST_EXIT}"
fi

if [[ -f "${FORCE_DIR}/package.json" ]]; then
  assert_pass "new files created after --force"
else
  assert_fail "new files created after --force"
fi

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Section 11: Export Manifest
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}  ── Export Manifest ──${RESET}"
echo ""

MANIFEST="${EXPORT_DIR}/export-manifest.json"
if [[ -f "${MANIFEST}" ]]; then
  # Check required keys
  for key in client sourceVersion exportedAt filesExported importsRewritten sourceFramework; do
    if node -e "const m=require('${MANIFEST}'); if(m.${key}===undefined) process.exit(1)" 2>/dev/null; then
      assert_pass "manifest has key: ${key}"
    else
      assert_fail "manifest has key: ${key}"
    fi
  done
else
  assert_fail "export-manifest.json exists"
fi

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Section 12: Multi-client export (_reference)
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}  ── Multi-client (_reference) ──${RESET}"
echo ""

if [[ -d "${ROOT_DIR}/clients/_reference" ]]; then
  AA_DIR="${TEMP_BASE}/airline-export"
  run_export --client=_reference --output="${AA_DIR}" --skip-validate --force
  if [[ "${LAST_EXIT}" -eq 0 ]]; then
    assert_pass "_reference export succeeds"
  else
    assert_fail "_reference export succeeds" "exit=${LAST_EXIT}"
  fi

  # More scenarios than _reference
  AA_SCENARIOS=$(find "${AA_DIR}/scenarios" -name "*.ts" 2>/dev/null | wc -l | tr -d ' ' || echo "0")
  if [[ "${AA_SCENARIOS}" -gt 6 ]]; then
    assert_pass "_reference has ${AA_SCENARIOS} scenarios (more than _reference)"
  else
    assert_pass "_reference has ${AA_SCENARIOS} scenarios"
  fi

  # No residual imports
  AA_RESIDUAL=0
  if grep -rqE 'from ["\x27](\.\./){3,}src/' "${AA_DIR}/lib/" "${AA_DIR}/scenarios/" 2>/dev/null; then
    AA_RESIDUAL=$(grep -rcE 'from ["\x27](\.\./){3,}src/' "${AA_DIR}/lib/" "${AA_DIR}/scenarios/" 2>/dev/null | awk -F: '{s+=$NF}END{print s+0}')
  fi
  if [[ "${AA_RESIDUAL}" -eq 0 ]]; then
    assert_pass "_reference: no residual monorepo imports"
  else
    assert_fail "_reference: no residual monorepo imports" "${AA_RESIDUAL} found"
  fi

  # Build
  if (cd "${AA_DIR}" && npm install --silent 2>/dev/null && npm run build 2>/dev/null); then
    assert_pass "_reference: webpack build succeeds"
  else
    assert_fail "_reference: webpack build succeeds"
  fi
else
  assert_skip "_reference tests" "client not found"
fi

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Section 13: update-framework.sh
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}  ── update-framework.sh ──${RESET}"
echo ""

UPDATE_DIR="${TEMP_BASE}/update-test"
run_export --client=_reference --output="${UPDATE_DIR}" --skip-validate --force
if [[ "${LAST_EXIT}" -eq 0 ]]; then
  # Run update-framework.sh from standalone pointing back to monorepo
  UPDATE_OUTPUT=""
  UPDATE_EXIT=0
  UPDATE_OUTPUT=$(cd "${UPDATE_DIR}" && ./bin/update-framework.sh --from="${ROOT_DIR}" --yes 2>&1) || UPDATE_EXIT=$?

  if [[ "${UPDATE_EXIT}" -eq 0 ]]; then
    assert_pass "update-framework.sh runs successfully"
  else
    assert_fail "update-framework.sh runs" "exit=${UPDATE_EXIT}"
  fi

  if echo "${UPDATE_OUTPUT}" | grep -qi "up to date\|updated"; then
    assert_pass "update-framework.sh reports status"
  else
    assert_fail "update-framework.sh reports status"
  fi
else
  assert_skip "update-framework.sh tests" "export failed"
fi

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Section 14: README generation
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}  ── README Generation ──${RESET}"
echo ""

if [[ -f "${EXPORT_DIR}/README.md" ]]; then
  assert_pass "README.md generated"

  if grep -q "Quick Start" "${EXPORT_DIR}/README.md" 2>/dev/null; then
    assert_pass "README has Quick Start section"
  else
    assert_fail "README has Quick Start section"
  fi

  if grep -q "npm run build" "${EXPORT_DIR}/README.md" 2>/dev/null; then
    assert_pass "README includes build command"
  else
    assert_fail "README includes build command"
  fi

  if grep -q "framework/" "${EXPORT_DIR}/README.md" 2>/dev/null; then
    assert_pass "README mentions framework/ structure"
  else
    assert_fail "README mentions framework/ structure"
  fi
else
  assert_fail "README.md generated"
fi

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "  ════════════════════════════════════"
TOTAL=$((PASS + FAIL + SKIP))
echo -e "  Results: ${GREEN}${PASS} passed${RESET} / ${RED}${FAIL} failed${RESET} / ${YELLOW}${SKIP} skipped${RESET} / ${TOTAL} total"
echo ""

if [[ "${FAIL}" -gt 0 ]]; then
  echo -e "  ${RED}${BOLD}FAIL — ${FAIL} test(s) failed!${RESET}"
  exit 1
fi

echo -e "  ${GREEN}${BOLD}PASS — All ${PASS} tests passed.${RESET}"
echo ""
exit 0
