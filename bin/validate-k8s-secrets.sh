#!/usr/bin/env bash
# bin/validate-k8s-secrets.sh — T-131: Verify K8s CRD manifests contain no literal secrets.
#
# Scans YAML manifests in infrastructure/k8s/ to ensure credentials are always
# provided via secretKeyRef, not as literal `value:` strings.
#
# Usage:
#   ./bin/validate-k8s-secrets.sh                    # scan default k8s dir
#   ./bin/validate-k8s-secrets.sh path/to/manifest   # scan specific file/dir
#
# Exit 0 — no literal secrets found.
# Exit 1 — one or more literal secret values detected.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; RESET='\033[0m'

SCAN_TARGET="${1:-${ROOT_DIR}/infrastructure/k8s}"

# ── Sensitive env var name patterns ──────────────────────────────────────────
# These names indicate the value should come from a secretKeyRef, not literal.
SENSITIVE_NAME_RE='(TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|CREDENTIAL|AUTH)'

FOUND=0

echo ""
echo -e "${BOLD}  T-131: K8s CRD Secret Literal Validator${RESET}"
echo -e "  Scanning: ${SCAN_TARGET}"
echo -e "  ─────────────────────────────────────────"
echo ""

# Walk all YAML files
while IFS= read -r -d '' file; do
  # Look for `- name: <SENSITIVE_VAR>` followed (within 3 lines) by `value:` (not valueFrom:)
  # Uses a small awk state machine: when we see a sensitive name, we check next lines for `value:`
  matches=$(awk '
    /- name:/ {
      name = $0
      sensitive = 0
      if (name ~ /'"${SENSITIVE_NAME_RE}"'/) { sensitive = 1 }
      look_ahead = 3
      next
    }
    sensitive && look_ahead > 0 {
      look_ahead--
      if (/^[[:space:]]+value:/ && !/valueFrom/) {
        print FILENAME ":" NR ": " $0 " (name was: " name ")"
        sensitive = 0
      }
      if (/valueFrom:/) { sensitive = 0 }
    }
  ' FILENAME="${file}" "${file}" 2>/dev/null || true)

  if [[ -n "${matches}" ]]; then
    echo -e "  ${RED}[FAIL]${RESET} ${file#${ROOT_DIR}/}"
    while IFS= read -r line; do
      echo -e "         ${line}"
    done <<< "${matches}"
    FOUND=$((FOUND + 1))
  fi
done < <(find "${SCAN_TARGET}" -name "*.yaml" -o -name "*.yml" | sort | tr '\n' '\0')

echo ""
if [[ "${FOUND}" -gt 0 ]]; then
  echo -e "  ${RED}${BOLD}FAIL — ${FOUND} manifest(s) contain literal secret values.${RESET}"
  echo -e "  Replace with secretKeyRef:"
  echo -e "    env:"
  echo -e "      - name: APP_API_KEY"
  echo -e "        valueFrom:"
  echo -e "          secretKeyRef:"
  echo -e "            name: k6-secrets"
  echo -e "            key: APP_API_KEY"
  exit 1
fi

echo -e "  ${GREEN}${BOLD}PASS — No literal secrets found in K8s manifests.${RESET}"
echo -e "  Scanned: $(find "${SCAN_TARGET}" \( -name "*.yaml" -o -name "*.yml" \) | wc -l | tr -d ' ') manifest(s)"
exit 0
