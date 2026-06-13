#!/usr/bin/env bash
# version.sh — Semantic version bump utility (T-151)
#
# Reads the current version from package.json and bumps it following semver.
# Updates package.json in place and prints the new version.
#
# Usage:
#   bin/version.sh patch        Bump patch: 1.2.3 → 1.2.4
#   bin/version.sh minor        Bump minor: 1.2.3 → 1.3.0
#   bin/version.sh major        Bump major: 1.2.3 → 2.0.0
#   bin/version.sh get          Print current version and exit
#   bin/version.sh set 1.4.0    Set specific version
#   bin/version.sh --help       Show this help
#
# Exit codes:
#   0  success
#   1  invalid argument or version format

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PKG_JSON="${ROOT_DIR}/package.json"

RED='\033[0;31m'; GREEN='\033[0;32m'; BOLD='\033[1m'; RESET='\033[0m'

print_help() {
  cat <<EOF
${BOLD}version.sh${RESET} — Semantic version bump utility

Usage:
  bin/version.sh patch        Bump patch: 1.2.3 → 1.2.4
  bin/version.sh minor        Bump minor: 1.2.3 → 1.3.0
  bin/version.sh major        Bump major: 1.2.3 → 2.0.0
  bin/version.sh get          Print current version
  bin/version.sh set <v>      Set specific version (e.g. 2.0.0)
  bin/version.sh --help       Show this help

Exit codes:
  0  success
  1  error
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  print_help; exit 0
fi

# Read current version from package.json
if [[ ! -f "${PKG_JSON}" ]]; then
  echo -e "${RED}[version] package.json not found: ${PKG_JSON}${RESET}" >&2
  exit 1
fi

CURRENT=$(node -e "process.stdout.write(require('${PKG_JSON}').version)")

if [[ -z "${CURRENT}" ]]; then
  echo -e "${RED}[version] Cannot read version from package.json${RESET}" >&2
  exit 1
fi

# Validate semver format
SEMVER_RE='^([0-9]+)\.([0-9]+)\.([0-9]+)$'
if [[ ! "${CURRENT}" =~ ${SEMVER_RE} ]]; then
  echo -e "${RED}[version] Current version '${CURRENT}' is not valid semver${RESET}" >&2
  exit 1
fi

MAJOR="${BASH_REMATCH[1]}"
MINOR="${BASH_REMATCH[2]}"
PATCH="${BASH_REMATCH[3]}"

BUMP="${1:-get}"

case "${BUMP}" in
  get)
    echo "${CURRENT}"
    exit 0
    ;;
  patch)
    PATCH=$((PATCH + 1))
    ;;
  minor)
    MINOR=$((MINOR + 1))
    PATCH=0
    ;;
  major)
    MAJOR=$((MAJOR + 1))
    MINOR=0
    PATCH=0
    ;;
  set)
    NEW_VERSION="${2:-}"
    if [[ -z "${NEW_VERSION}" ]]; then
      echo -e "${RED}[version] 'set' requires a version argument: bin/version.sh set 2.0.0${RESET}" >&2
      exit 1
    fi
    if [[ ! "${NEW_VERSION}" =~ ${SEMVER_RE} ]]; then
      echo -e "${RED}[version] '${NEW_VERSION}' is not valid semver (expected X.Y.Z)${RESET}" >&2
      exit 1
    fi
    NEW_VER="${NEW_VERSION}"
    node -e "
      const fs = require('fs');
      const pkg = require('${PKG_JSON}');
      pkg.version = '${NEW_VER}';
      fs.writeFileSync('${PKG_JSON}', JSON.stringify(pkg, null, 2) + '\n');
    "
    echo -e "${GREEN}[version] ${CURRENT} → ${NEW_VER}${RESET}"
    echo "${NEW_VER}"
    exit 0
    ;;
  *)
    echo -e "${RED}[version] Unknown command '${BUMP}'. Use: patch | minor | major | get | set <v>${RESET}" >&2
    exit 1
    ;;
esac

NEW_VER="${MAJOR}.${MINOR}.${PATCH}"

# Update package.json
node -e "
  const fs = require('fs');
  const pkg = require('${PKG_JSON}');
  pkg.version = '${NEW_VER}';
  fs.writeFileSync('${PKG_JSON}', JSON.stringify(pkg, null, 2) + '\n');
"

echo -e "${GREEN}[version] ${CURRENT} → ${NEW_VER}${RESET}"
echo "${NEW_VER}"
