#!/usr/bin/env bash
# bin/detect-secrets.sh — T-130: Scan for hardcoded secrets in the codebase
#
# Usage:
#   ./bin/detect-secrets.sh              # scan default directories
#   ./bin/detect-secrets.sh src clients  # scan specific directories
#
# Returns exit code 0 if no secrets found, 1 if any are detected.
# Intended for use in pre-commit hooks and CI/CD pipelines.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Directories to scan (default: src, clients, bin, shared — excluding node_modules/dist)
if [[ $# -gt 0 ]]; then
  SCAN_DIRS=("$@")
else
  SCAN_DIRS=("src" "clients" "shared")
fi

# File extensions to scan
INCLUDE_GLOBS=(
  "*.ts"
  "*.js"
  "*.sh"
  "*.json"
  "*.yaml"
  "*.yml"
  "*.env"
  "*.env.example"
)

# ── Secret patterns ────────────────────────────────────────────────────────────
# Each pattern is a grep extended regex. Matches are reported as findings.
declare -a PATTERNS=(
  # AWS Access Key ID
  'AKIA[0-9A-Z]{16}'
  # AWS Secret Access Key (40 chars base64-ish)
  'AWS_SECRET_ACCESS_KEY\s*=\s*[A-Za-z0-9+/]{40}'
  # GitHub Personal Access Token
  'ghp_[A-Za-z0-9]{36}'
  # GitHub App token
  'ghs_[A-Za-z0-9]{36}'
  # JWT (Bearer token with 3 base64url segments)
  'Bearer eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}'
  # RSA/EC private key header
  '-----BEGIN (RSA |EC )?PRIVATE KEY-----'
  # OpenAI / Stripe-style key
  'sk-[A-Za-z0-9]{20,}'
  # Slack token
  'xox[baprs]-[0-9A-Za-z]{10,}'
  # Hardcoded password assignment (literal value, not variable reference)
  "['\"]password['\"]\s*[:=]\s*['\"][^'\"${}]{8,}['\"]"
  # Hardcoded api_key literal
  "['\"]api_key['\"]\s*[:=]\s*['\"][^'\"${}]{8,}['\"]"
)

# ── Allowlist markers ──────────────────────────────────────────────────────────
# Lines containing any of these strings are excluded from findings.
ALLOWLIST_MARKERS=(
  "secret-allow"
  "# nosec"
  "# noqa"
  "secretsignore"
  "example"
  "placeholder"
  '\${'
  '__ENV'
  'YOUR_'
  '<your'
  'REPLACE_'
  'changeme'
  'xxxxxxxxx'
)

# Build grep pattern for allowlist exclusion
ALLOWLIST_GREP=""
for marker in "${ALLOWLIST_MARKERS[@]}"; do
  if [[ -z "${ALLOWLIST_GREP}" ]]; then
    ALLOWLIST_GREP="${marker}"
  else
    ALLOWLIST_GREP="${ALLOWLIST_GREP}|${marker}"
  fi
done

# ── Build include options ──────────────────────────────────────────────────────
INCLUDE_OPTS=()
for glob in "${INCLUDE_GLOBS[@]}"; do
  INCLUDE_OPTS+=("--include=${glob}")
done

# ── Scan ──────────────────────────────────────────────────────────────────────
FOUND=0
TOTAL_SCANNED=0

for pattern in "${PATTERNS[@]}"; do
  while IFS= read -r match; do
    TOTAL_SCANNED=$((TOTAL_SCANNED + 1))
    # Apply allowlist filter
    if echo "${match}" | grep -qE "${ALLOWLIST_GREP}" 2>/dev/null; then
      continue
    fi
    echo "[SECRET] ${match}"
    FOUND=$((FOUND + 1))
  done < <(
    grep -rEn "${INCLUDE_OPTS[@]}" \
      --exclude-dir=node_modules \
      --exclude-dir=dist \
      --exclude-dir=.git \
      "${pattern}" \
      "${SCAN_DIRS[@]/#/${ROOT_DIR}/}" 2>/dev/null || true
  )
done

echo ""
if [[ $FOUND -gt 0 ]]; then
  echo "[FAIL] ${FOUND} potential secret(s) detected. Review before committing."
  echo "       Add '# secret-allow' to the line if this is a false positive."
  exit 1
fi

echo "[OK] No hardcoded secrets detected. Scanned directories: ${SCAN_DIRS[*]}"
exit 0
