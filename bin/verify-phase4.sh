#!/usr/bin/env bash
# bin/verify-phase4.sh — T-105: E2E verification of Phase 4 deliverables
#
# Verifies all Phase 4 (T-077 to T-105) components independently:
#   1. Notification service + formatters
#   2. Bot interface + Slack adapter
#   3. Regression suite + runner + scheduling
#   4. Quality gate engine + CI/CD templates
#   5. Capacity analyzer + projections + HTML report
#   6. APM correlator + infra metrics collector
#   7. Redis integration (helper + patterns + bin scripts)
#   8. Documentation
#
# Each check is independent and can be run selectively:
#   ./bin/verify-phase4.sh --only=redis
#   ./bin/verify-phase4.sh --only=notifications,quality-gate
#   ./bin/verify-phase4.sh --skip=redis    (skip Redis checks, useful without Redis running)
#
# Exit codes:
#   0 — all checks passed
#   1 — one or more checks failed
#
# Usage in CI:
#   ./bin/verify-phase4.sh --skip=redis 2>&1 | tee reports/phase4-verify.log

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRAMEWORK_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PASS=0
FAIL=0
SKIP=0

# ── Colors ────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
NC='\033[0m'

# ── Argument parsing ──────────────────────────────────────────────────────────
ONLY_GROUPS=""
SKIP_GROUPS=""
VERBOSE=false

for arg in "$@"; do
  case $arg in
    --only=*)  ONLY_GROUPS="${arg#*=}" ;;
    --skip=*)  SKIP_GROUPS="${arg#*=}" ;;
    --verbose) VERBOSE=true ;;
    --help|-h)
      echo "Usage: $0 [--only=group1,group2] [--skip=group1,group2] [--verbose]"
      echo ""
      echo "Groups: notifications, bot, regression, quality-gate, capacity, apm, redis, docs, ci-templates"
      echo ""
      echo "Examples:"
      echo "  $0                          # run all checks"
      echo "  $0 --skip=redis             # skip Redis checks (no Redis needed)"
      echo "  $0 --only=quality-gate,docs # run only selected groups"
      exit 0
      ;;
  esac
done

should_run() {
  local group="$1"
  if [[ -n "$ONLY_GROUPS" ]]; then
    echo "$ONLY_GROUPS" | tr ',' '\n' | grep -qx "$group" || return 1
  fi
  if [[ -n "$SKIP_GROUPS" ]]; then
    echo "$SKIP_GROUPS" | tr ',' '\n' | grep -qx "$group" && return 1
  fi
  return 0
}

# ── Check helpers ─────────────────────────────────────────────────────────────
check_file() {
  local label="$1"
  local file="$2"
  if [[ -f "${FRAMEWORK_DIR}/${file}" ]]; then
    echo -e "  ${GREEN}✓${NC} ${label}"
    ((PASS++)) || true
  else
    echo -e "  ${RED}✗${NC} ${label} — MISSING: ${file}"
    ((FAIL++)) || true
  fi
}

check_file_contains() {
  local label="$1"
  local file="$2"
  local pattern="$3"
  if [[ ! -f "${FRAMEWORK_DIR}/${file}" ]]; then
    echo -e "  ${RED}✗${NC} ${label} — file missing: ${file}"
    ((FAIL++)) || true
    return
  fi
  if grep -q "$pattern" "${FRAMEWORK_DIR}/${file}" 2>/dev/null; then
    echo -e "  ${GREEN}✓${NC} ${label}"
    ((PASS++)) || true
  else
    echo -e "  ${RED}✗${NC} ${label} — pattern not found: '${pattern}' in ${file}"
    ((FAIL++)) || true
  fi
}

check_executable() {
  local label="$1"
  local file="$2"
  if [[ -f "${FRAMEWORK_DIR}/${file}" && -x "${FRAMEWORK_DIR}/${file}" ]]; then
    echo -e "  ${GREEN}✓${NC} ${label}"
    ((PASS++)) || true
  elif [[ -f "${FRAMEWORK_DIR}/${file}" ]]; then
    echo -e "  ${YELLOW}⚠${NC} ${label} — exists but not executable: ${file}"
    ((SKIP++)) || true
  else
    echo -e "  ${RED}✗${NC} ${label} — MISSING: ${file}"
    ((FAIL++)) || true
  fi
}

check_cmd() {
  local label="$1"
  local cmd="$2"
  local expected_exit="${3:-0}"
  local actual_exit=0
  if eval "$cmd" > /dev/null 2>&1; then
    actual_exit=0
  else
    actual_exit=$?
  fi
  if [[ "$actual_exit" -eq "$expected_exit" ]]; then
    echo -e "  ${GREEN}✓${NC} ${label}"
    ((PASS++)) || true
  else
    echo -e "  ${RED}✗${NC} ${label} — command failed (exit ${actual_exit}): ${cmd}"
    ((FAIL++)) || true
  fi
}

skip_group() {
  local name="$1"
  echo -e "  ${GRAY}— Skipped (--skip=${name})${NC}"
  ((SKIP++)) || true
}

# ── Banner ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  k6 Framework — Phase 4 E2E Verification (T-105)${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  Framework: ${FRAMEWORK_DIR}"
echo -e "  Date:      $(date +%Y-%m-%dT%H:%M:%S)"
[[ -n "$ONLY_GROUPS" ]] && echo -e "  Only:      ${ONLY_GROUPS}"
[[ -n "$SKIP_GROUPS" ]] && echo -e "  Skip:      ${SKIP_GROUPS}"
echo ""

# ── 1. Notification Service (T-077/T-078) ─────────────────────────────────────
if should_run "notifications"; then
  echo -e "${CYAN}[1/9] Notification Service (T-077/T-078)${NC}"
  check_file "notification-service.ts" "src/integrations/notification-service.ts"
  check_file_contains "NotificationService class" "src/integrations/notification-service.ts" "class NotificationService"
  check_file_contains "SlackFormatter (Block Kit)" "src/integrations/notification-service.ts" "SlackFormatter"
  check_file_contains "EmailFormatter" "src/integrations/notification-service.ts" "EmailFormatter"
  check_file_contains "WebhookFormatter" "src/integrations/notification-service.ts" "WebhookFormatter"
  check_file_contains "retry with backoff" "src/integrations/notification-service.ts" "backoff\|retry\|attempt"
  check_file_contains "credential masking CHK-SEC-106" "src/integrations/notification-service.ts" "webhook.*not.*log\|secret\|no.*expos\|__ENV\['NOTIFY_SLACK_WEBHOOK'\]"
  echo ""
fi

# ── 2. Bot Interface (T-079/T-080) ─────────────────────────────────────────────
if should_run "bot"; then
  echo -e "${CYAN}[2/9] Bot Interface + Slack Adapter (T-079/T-080)${NC}"
  check_file "bot-interface.ts" "src/integrations/bot/bot-interface.ts"
  check_file "slack-adapter.ts" "src/integrations/bot/slack-adapter.ts"
  check_file_contains "BotAdapter interface" "src/integrations/bot/bot-interface.ts" "BotAdapter"
  check_file_contains "sanitizeBotParam (CHK-SEC-033)" "src/integrations/bot/bot-interface.ts" "sanitizeBotParam"
  check_file_contains "injection char stripping" "src/integrations/bot/bot-interface.ts" '[;|&`$><]'
  check_file_contains "SlackAdapter class" "src/integrations/bot/slack-adapter.ts" "SlackAdapter"
  check_file_contains "execution queue" "src/integrations/bot/slack-adapter.ts" "queue\|Queue"
  echo ""
fi

# ── 3. Regression Suite (T-081/T-082/T-083/T-084) ────────────────────────────
if should_run "regression"; then
  echo -e "${CYAN}[3/9] Regression Suite + Scheduling + Trends (T-081–T-084)${NC}"
  check_file "regression-suite.ts" "src/core/regression-suite.ts"
  check_file_contains "RegressionSuiteConfig" "src/core/regression-suite.ts" "RegressionSuiteConfig"
  check_file_contains "compareAgainstHistory" "src/core/regression-suite.ts" "compareAgainstHistory"
  check_file_contains "deviation levels: informative/significant/critical" "src/core/regression-suite.ts" "critical\|significant\|informative"
  check_file_contains "EC-COMP-006 (no baseline < 3 runs)" "src/core/regression-suite.ts" "3\|baseline\|EC-COMP"
  check_executable "bin/run-regression.sh" "bin/run-regression.sh"
  check_file_contains "exit code 99 (critical)" "bin/run-regression.sh" "99"
  check_file_contains "exit code 1 (significant)" "bin/run-regression.sh" "EXIT_CODE=1"
  check_file "trend-visualizer.ts" "src/reporting/trend-visualizer.ts"
  check_file_contains "30/60/90-day windows" "src/reporting/trend-visualizer.ts" "TrendWindow\|30 | 60 | 90\|30\|60\|90"
  check_file_contains "generateTrendHtml" "src/reporting/trend-visualizer.ts" "generateTrendHtml"
  check_file_contains "offline Chart.js (Canvas API)" "src/reporting/trend-visualizer.ts" "canvas\|Canvas\|getContext"
  echo ""
fi

# ── 4. Quality Gate + CI/CD (T-085/T-086/T-087/T-088/T-089) ─────────────────
if should_run "quality-gate"; then
  echo -e "${CYAN}[4/9] Quality Gate + CI/CD Templates (T-085–T-089)${NC}"
  check_file "quality-gate.ts" "src/core/quality-gate.ts"
  check_file_contains "QG_EXIT codes (0/1/2/99)" "src/core/quality-gate.ts" "QG_EXIT\|PASS.*0\|THRESHOLD_FAIL.*1"
  check_file_contains "QG_THRESHOLDS_OVERRIDE" "src/core/quality-gate.ts" "QG_THRESHOLDS_OVERRIDE"
  check_file_contains "GitHub Actions set-output format" "src/core/quality-gate.ts" "set-output\|github\|GitHub"
  check_file_contains "GitLab CI format" "src/core/quality-gate.ts" "gitlab\|GitLab\|GITLAB"
  check_file_contains "JUnit XML format" "src/core/quality-gate.ts" "junit\|JUnit\|xml"
  # GitHub Actions workflows
  check_file "perf-smoke.yml" ".github/workflows/perf-smoke.yml"
  check_file "perf-gate.yml" ".github/workflows/perf-gate.yml"
  check_file "perf-regression.yml" ".github/workflows/perf-regression.yml"
  check_file_contains "workflow_dispatch inputs" ".github/workflows/perf-smoke.yml" "workflow_dispatch"
  check_file_contains "PR quality gate blocks merge" ".github/workflows/perf-gate.yml" "pull_request"
  check_file_contains "nightly cron schedule" ".github/workflows/perf-regression.yml" "cron"
  # GitLab CI
  check_file ".gitlab-ci-perf.yml" "ci-templates/.gitlab-ci-perf.yml"
  check_file_contains "scheduled pipeline rule" "ci-templates/.gitlab-ci-perf.yml" 'schedule'
  check_file_contains "cross-pipeline trigger" "ci-templates/.gitlab-ci-perf.yml" "trigger"
  # Inline config (T-088)
  check_file "inline-config-loader.ts" "src/core/inline-config-loader.ts"
  check_file_contains "TEST_CONFIG env var" "src/core/inline-config-loader.ts" "TEST_CONFIG"
  check_file_contains "temp file 0600 permissions" "src/core/inline-config-loader.ts" "0o600\|0600"
  check_file_contains "HTTPS-only for remote config" "src/core/inline-config-loader.ts" "https://"
  check_file_contains "cleanup temp file" "src/core/inline-config-loader.ts" "cleanupTempConfig\|unlinkSync"
  echo ""
fi

# ── 5. Capacity Planning (T-090/T-091/T-092) ─────────────────────────────────
if should_run "capacity"; then
  echo -e "${CYAN}[5/9] Capacity Analysis + Projections + Report (T-090–T-092)${NC}"
  check_file "capacity-analyzer.ts" "src/reporting/capacity-analyzer.ts"
  check_file_contains "analyzeCapacity" "src/reporting/capacity-analyzer.ts" "analyzeCapacity"
  check_file_contains "inflection point detection" "src/reporting/capacity-analyzer.ts" "inflection\|detectInflectionPoint"
  check_file_contains "breaking point (error>5% or lat>3x)" "src/reporting/capacity-analyzer.ts" "ERROR_BURST_THRESHOLD\|LATENCY_BREAK_MULTIPLIER\|breakingPoint"
  check_file_contains "projectCapacity with log formula" "src/reporting/capacity-analyzer.ts" "Math.log\|projectCapacity"
  check_file_contains "confidence level high/medium/low" "src/reporting/capacity-analyzer.ts" "high.*medium.*low\|confidenceLevel"
  # T-092: HTML report
  check_file "capacity-report-generator.ts" "src/reporting/capacity-report-generator.ts"
  check_file_contains "generateCapacityReportHtml" "src/reporting/capacity-report-generator.ts" "generateCapacityReportHtml"
  check_file_contains "executive summary section" "src/reporting/capacity-report-generator.ts" "Executive Summary\|exec.*summary\|execSummary"
  check_file_contains "KPI cards (6 indicators)" "src/reporting/capacity-report-generator.ts" "kpi-grid\|kpi-card"
  check_file_contains "offline Canvas charts" "src/reporting/capacity-report-generator.ts" "getContext\|canvas\|Canvas"
  check_file_contains "writeCapacityReport (file output)" "src/reporting/capacity-report-generator.ts" "writeCapacityReport"
  echo ""
fi

# ── 6. APM Correlation (T-093/T-094/T-095) ───────────────────────────────────
if should_run "apm"; then
  echo -e "${CYAN}[6/9] APM Correlation + Infra Metrics (T-093–T-095)${NC}"
  check_file "infra-metrics-collector.ts" "src/observability/infra-metrics-collector.ts"
  check_file_contains "collectInfraMetrics (Prometheus query_range)" "src/observability/infra-metrics-collector.ts" "query_range\|collectInfraMetrics"
  check_file_contains "CPU/memory/disk/network metrics" "src/observability/infra-metrics-collector.ts" "cpu\|memory\|disk\|network"
  check_file_contains "Tempo/APM trace correlation" "src/observability/infra-metrics-collector.ts" "tempo\|Tempo\|trace\|Trace"
  check_file_contains "graceful degradation (returns null)" "src/observability/infra-metrics-collector.ts" "null\|warning\|unavailable"
  check_file_contains "detectCorrelations" "src/observability/infra-metrics-collector.ts" "detectCorrelations\|correlation"
  check_file_contains "formatCorrelationHtml" "src/observability/infra-metrics-collector.ts" "formatCorrelationHtml"
  echo ""
fi

# ── 7. Redis Integration (T-096/T-097/T-098/T-099/T-100/T-101) ───────────────
if should_run "redis"; then
  echo -e "${CYAN}[7/9] Redis Integration (T-096–T-101)${NC}"
  # T-096: Complete RedisHelper
  check_file "redis-helper.ts" "src/helpers/redis-helper.ts"
  check_file_contains "set/get/del/exists" "src/helpers/redis-helper.ts" "async set\|async get\|async del\|async exists"
  check_file_contains "mset/mget" "src/helpers/redis-helper.ts" "async mset\|async mget"
  check_file_contains "incr/incrby" "src/helpers/redis-helper.ts" "async incr\|async incrby"
  check_file_contains "lpush/llen/lrange" "src/helpers/redis-helper.ts" "async lpush\|async llen\|async lrange"
  check_file_contains "hset/hget/hgetall" "src/helpers/redis-helper.ts" "async hset\|async hget\|async hgetall"
  check_file_contains "disconnect" "src/helpers/redis-helper.ts" "async disconnect"
  check_file_contains "REDIS_URL env var support" "src/helpers/redis-helper.ts" "REDIS_URL"
  check_file_contains "credential masking CHK-SEC-106" "src/helpers/redis-helper.ts" "maskUrl\|CHK-SEC-106\|\*\*\*"
  check_file_contains "WRONGTYPE error handling EC-RED-005" "src/helpers/redis-helper.ts" "WRONGTYPE\|EC-RED-005\|hgetall.*type"
  # T-097: SharedArray pattern
  check_file "16-redis-data-pool.ts" "clients/_reference/scenarios/api/16-redis-data-pool.ts"
  check_file_contains "SharedArray usage" "clients/_reference/scenarios/api/16-redis-data-pool.ts" "SharedArray"
  check_file_contains "setup/default/teardown lifecycle" "clients/_reference/scenarios/api/16-redis-data-pool.ts" "export function setup\|export function teardown\|export default"
  # T-098: bin scripts
  check_file "load-redis-data.js" "bin/load-redis-data.js"
  check_file "clean-redis-data.js" "bin/clean-redis-data.js"
  check_file_contains "load: --users, --products, --clear" "bin/load-redis-data.js" "\-\-users\|\-\-products\|\-\-clear"
  check_file_contains "clean: --pattern, --all" "bin/clean-redis-data.js" "\-\-pattern\|\-\-all"
  check_file_contains "load: no-log credentials CHK-SEC-107" "bin/load-redis-data.js" "maskUrl\|CHK-SEC-107\|\*\*\*"
  check_file_contains "clean: SCAN+DEL (no KEYS)" "bin/clean-redis-data.js" "scan\|SCAN"
  check_file_contains "load: progress indicator >1000" "bin/load-redis-data.js" "progressBar\|progress"
  # T-099: Redis patterns
  check_file "redis-patterns.ts" "src/patterns/redis-patterns.ts"
  check_file_contains "UserPool pattern" "src/patterns/redis-patterns.ts" "class UserPool"
  check_file_contains "DistributedRateLimiter" "src/patterns/redis-patterns.ts" "class DistributedRateLimiter"
  check_file_contains "StatsCounter" "src/patterns/redis-patterns.ts" "class StatsCounter"
  check_file_contains "parseCsv utility" "src/patterns/redis-patterns.ts" "function parseCsv"
  check_file_contains "pool: VU modulo assignment SC-096" "src/patterns/redis-patterns.ts" "__VU\|vu.*%.*poolSize\|modulo\|% this.poolSize"
  check_file_contains "rate: INCR+EXPIRE pattern" "src/patterns/redis-patterns.ts" "incr\|expire\|EXPIRE"
  check_file_contains "namespaced keys CHK-API-346" "src/patterns/redis-patterns.ts" "user:\|rate:\|stats:"
  # T-100: Docker Compose redis profile
  check_file_contains "redis profile in docker-compose" "infrastructure/docker-compose.yml" "profile.*redis\|T-100.*Optional\|Optional service.*redis\|profile: redis\|profiles:$"
  check_file_contains "REDIS_URL injected to k6-runner" "infrastructure/docker-compose.yml" "REDIS_URL"
  check_file_contains "port NOT exposed CHK-SEC-108" "infrastructure/docker-compose.yml" "expose.*6379\|6379.*expose"
  # T-101: Redis security
  check_file "redis-security.ts" "src/helpers/redis-security.ts"
  check_file_contains "warnIfNoRedisAuth CHK-SEC-104" "src/helpers/redis-security.ts" "warnIfNoRedisAuth\|CHK-SEC-104"
  check_file_contains "maskRedisUrl CHK-SEC-106" "src/helpers/redis-security.ts" "maskRedisUrl\|CHK-SEC-106"
  check_file_contains "SENSITIVE_KEY_DEFAULT_TTL CHK-SEC-105" "src/helpers/redis-security.ts" "SENSITIVE_KEY_DEFAULT_TTL\|CHK-SEC-105"
  check_file_contains "warnIfLargeValue EC-RED-011" "src/helpers/redis-security.ts" "warnIfLargeValue\|EC-RED-011\|1MB\|ONE_MB"
  check_file_contains "CleanupTracker" "src/helpers/redis-security.ts" "CleanupTracker"
  # T-104: Redis test suite
  check_file "test-redis.ts" "clients/_reference/scenarios/test-redis.ts"
  check_file_contains "100% coverage: all operations" "clients/_reference/scenarios/test-redis.ts" "hset\|lpush\|incr\|mset\|hgetall"
  check_file_contains "latency check < 5ms" "clients/_reference/scenarios/test-redis.ts" "redis_op_duration\|p.*95.*5\|<5"
  check_file_contains "graceful skip if Redis unavailable" "clients/_reference/scenarios/test-redis.ts" "redisAvailable\|unavailable\|skip"
  check_file_contains "teardown cleanup (no residual data)" "clients/_reference/scenarios/test-redis.ts" "teardown.*cleanup\|cleanup.*teardown\|deleteByPrefix"
  echo ""
fi

# ── 8. Documentation (T-102/T-103) ───────────────────────────────────────────
if should_run "docs"; then
  echo -e "${CYAN}[8/9] Documentation (T-102/T-103)${NC}"
  check_file "docs/CI_CD_INTEGRATION.md" "docs/CI_CD_INTEGRATION.md"
  check_file_contains "4 exit codes documented" "docs/CI_CD_INTEGRATION.md" "exit code.*0\|exit code.*1\|exit code.*2\|exit code.*99"
  check_file_contains "GitHub Actions guide" "docs/CI_CD_INTEGRATION.md" "GitHub Actions"
  check_file_contains "GitLab CI guide" "docs/CI_CD_INTEGRATION.md" "GitLab CI"
  check_file_contains "cross-repo pattern" "docs/CI_CD_INTEGRATION.md" "separate repository\|different.*repo\|consumer repo\|cross.*pipeline\|another repo"
  check_file_contains "TEST_CONFIG documented" "docs/CI_CD_INTEGRATION.md" "TEST_CONFIG"
  check_file_contains "notification channels documented" "docs/CI_CD_INTEGRATION.md" "Slack\|webhook\|email"
  check_file_contains "troubleshooting section" "docs/CI_CD_INTEGRATION.md" "Troubleshooting\|troubleshoot"
  check_file_contains "decision tree" "docs/CI_CD_INTEGRATION.md" "Decision Tree\|decision tree"
  check_file "docs/REDIS_DATA_SUPPORT.md" "docs/REDIS_DATA_SUPPORT.md"
  check_file_contains "quick reference table" "docs/REDIS_DATA_SUPPORT.md" "Quick Reference\|quick reference"
  check_file_contains "3 config scenarios (local/docker/auth)" "docs/REDIS_DATA_SUPPORT.md" "Local\|Docker\|auth\|Authentication"
  check_file_contains "3 patterns with diagrams" "docs/REDIS_DATA_SUPPORT.md" "User Pool\|Rate Limit\|Stats Counter"
  check_file_contains "workflow steps" "docs/REDIS_DATA_SUPPORT.md" "Step 1\|Step 2\|Workflow"
  check_file_contains "CSV + JSON format examples" "docs/REDIS_DATA_SUPPORT.md" "CSV\|JSON"
  check_file_contains "best practices do/don't" "docs/REDIS_DATA_SUPPORT.md" "DO\|DON.*T\|do not\|avoid"
  check_file_contains "troubleshooting 5+ errors" "docs/REDIS_DATA_SUPPORT.md" "Troubleshooting"
  echo ""
fi

# ── 9. CI/CD Templates ────────────────────────────────────────────────────────
if should_run "ci-templates"; then
  echo -e "${CYAN}[9/9] CI/CD Templates (T-086/T-087)${NC}"
  check_file ".github/workflows/perf-smoke.yml" ".github/workflows/perf-smoke.yml"
  check_file ".github/workflows/perf-gate.yml" ".github/workflows/perf-gate.yml"
  check_file ".github/workflows/perf-regression.yml" ".github/workflows/perf-regression.yml"
  check_file "ci-templates/.gitlab-ci-perf.yml" "ci-templates/.gitlab-ci-perf.yml"
  check_file_contains "GitHub: smoke uses workflow_dispatch" ".github/workflows/perf-smoke.yml" "workflow_dispatch"
  check_file_contains "GitHub: gate runs on PR" ".github/workflows/perf-gate.yml" "pull_request"
  check_file_contains "GitHub: regression on cron" ".github/workflows/perf-regression.yml" "cron"
  check_file_contains "GitHub: artifacts upload" ".github/workflows/perf-smoke.yml" "upload-artifact"
  check_file_contains "GitHub: secrets.PERF_*" ".github/workflows/perf-smoke.yml" "secrets.PERF_"
  check_file_contains "GitLab: manual job" "ci-templates/.gitlab-ci-perf.yml" "when: manual"
  check_file_contains "GitLab: MR pipeline gate" "ci-templates/.gitlab-ci-perf.yml" "merge_request_event"
  check_file_contains "GitLab: schedule rule" "ci-templates/.gitlab-ci-perf.yml" 'CI_PIPELINE_SOURCE.*schedule'
  check_file_contains "GitLab: JUnit artifacts" "ci-templates/.gitlab-ci-perf.yml" "junit"
  check_file_contains "GitLab: cross-pipeline trigger" "ci-templates/.gitlab-ci-perf.yml" "trigger:"
  echo ""
fi

# ── Summary ───────────────────────────────────────────────────────────────────
TOTAL=$((PASS + FAIL + SKIP))
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  Phase 4 Verification Complete"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  Total:   ${TOTAL} checks"
echo -e "  ${GREEN}Passed:  ${PASS}${NC}"
if [[ $FAIL -gt 0 ]]; then
  echo -e "  ${RED}Failed:  ${FAIL}${NC}"
fi
if [[ $SKIP -gt 0 ]]; then
  echo -e "  ${YELLOW}Skipped: ${SKIP}${NC}"
fi
echo ""

if [[ $FAIL -eq 0 ]]; then
  echo -e "  ${GREEN}✅ Phase 4 deliverables verified successfully.${NC}"
  echo ""
  exit 0
else
  echo -e "  ${RED}❌ ${FAIL} check(s) failed. Review output above.${NC}"
  echo ""
  exit 1
fi
