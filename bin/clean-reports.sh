#!/usr/bin/env bash
# clean-reports.sh — Remove generated report artifacts
#
# Usage:
#   ./bin/clean-reports.sh                        # clean all clients
#   ./bin/clean-reports.sh --client=my-client  # clean one client
#   ./bin/clean-reports.sh --dry-run              # show what would be deleted

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPORTS_DIR="${ROOT_DIR}/reports"

CLIENT=""
DRY_RUN=false

for arg in "$@"; do
  case "${arg}" in
    --client=*) CLIENT="${arg#*=}" ;;
    --dry-run)  DRY_RUN=true ;;
    --help|-h)
      echo "Usage: ./bin/clean-reports.sh [--client=<name>] [--dry-run]"
      echo ""
      echo "Options:"
      echo "  --client=<name>  Only clean reports for this client"
      echo "  --dry-run        Show what would be deleted without deleting"
      exit 0
      ;;
    *) echo "Unknown argument: ${arg}"; exit 1 ;;
  esac
done

if [[ ! -d "${REPORTS_DIR}" ]]; then
  echo "No reports directory found at ${REPORTS_DIR}"
  exit 0
fi

TARGET="${REPORTS_DIR}"
if [[ -n "${CLIENT}" ]]; then
  TARGET="${REPORTS_DIR}/${CLIENT}"
  if [[ ! -d "${TARGET}" ]]; then
    echo "No reports found for client '${CLIENT}'"
    exit 0
  fi
fi

# Count files
FILE_COUNT=$(find "${TARGET}" -type f \( -name "*.html" -o -name "*.json" -o -name "*.csv" -o -name "*.log" -o -name "*.md" -o -name "*.txt" \) 2>/dev/null | wc -l | tr -d ' ')
DIR_COUNT=$(find "${TARGET}" -mindepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')

if [[ "${FILE_COUNT}" -eq 0 ]]; then
  echo "Nothing to clean."
  exit 0
fi

echo "Reports directory: ${TARGET}"
echo "Files to remove:   ${FILE_COUNT}"
echo "Directories:       ${DIR_COUNT}"

if [[ "${DRY_RUN}" == "true" ]]; then
  echo ""
  echo "Files:"
  find "${TARGET}" -type f \( -name "*.html" -o -name "*.json" -o -name "*.csv" -o -name "*.log" -o -name "*.md" -o -name "*.txt" \) | sort
  echo ""
  echo "(dry-run — nothing deleted)"
else
  if [[ -n "${CLIENT}" ]]; then
    rm -rf "${TARGET}"/*/
    echo "Cleaned reports for client '${CLIENT}'"
  else
    find "${REPORTS_DIR}" -mindepth 1 -maxdepth 1 -type d -exec rm -rf {}/ \;
    echo "Cleaned all reports"
  fi
fi
