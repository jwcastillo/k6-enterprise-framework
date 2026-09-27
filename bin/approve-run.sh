#!/usr/bin/env bash
# approve-run.sh — a human approves ONE guarded run (heavy profile, production-like env,
# production load or an unlocked scenario gate). The runners refuse such runs with
# exit 109 until a matching approval exists.
#
# Usage:
#   ./bin/approve-run.sh --scenario=<bucket/path> --profile=<p> --env=<e> [--client=<c>] [--ttl=4h] [--reason="..."]
#
#   --client   Monorepo client (default _reference). Ignored in a standalone repo.
#   --ttl      Validity window, 1m..24h (default 4h). Approvals are single use.
#
# Interactive only: refuses without a terminal on stdin and stdout, prints what will be
# approved and asks you to type a random 6-character code (read from /dev/tty).
# The record is written outside the repository, under
# ${XDG_STATE_HOME:-$HOME/.local/state}/k6-framework/approvals/, HMAC-signed with a
# per-user secret. AI agents must never run this; they ask the human to.
#
# Exit codes: 0 approved, 1 cancelled / code mismatch, 2 usage error or no terminal.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  sed -n '2,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 0
fi

if [[ ! -t 0 || ! -t 1 ]]; then
  echo "approve-run: refusing — needs an interactive terminal on stdin and stdout. A human must run it." >&2
  exit 2
fi

CLIENT="_reference"
ARGS=()
for a in "$@"; do
  case "$a" in
    --client=*) CLIENT="${a#*=}" ;;
    --scenario=*|--profile=*|--env=*|--ttl=*|--reason=*) ARGS+=("$a") ;;
    *) echo "approve-run: unknown option '$a' (see --help)" >&2; exit 2 ;;
  esac
done
# Standalone export: one client, named after the repository directory (as its runner does).
[[ -d "${ROOT_DIR}/clients" ]] || CLIENT="$(basename "${ROOT_DIR}")"

exec /usr/bin/env -u NODE_OPTIONS node "${SCRIPT_DIR}/_run-approval.js" approve \
  --client="${CLIENT}" --root="${ROOT_DIR}" ${ARGS[@]+"${ARGS[@]}"}
