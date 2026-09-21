#!/usr/bin/env bash
# quick.sh — on-demand wrapper for the k6-quick Go CLI (one-command URL smoke test)
#
# T-quick-cfh: Two-tier resolution for ad-hoc URL smoke testing.
#   Tier A — k6-quick on PATH:   exec k6-quick "$@" (propagates exit code unchanged)
#   Tier B — go on PATH:         go install github.com/jwcastillo/k6-quick@latest, then exec it
#   Tier C — no k6-quick/go:     clear error + non-zero exit (NO JS fallback)
#
# AD-HOC ESCAPE HATCH: This script BYPASSES the 5-bucket scenario taxonomy and
# run-test.sh entirely. It uses whatever `k6` binary is on PATH for real runs.
# Use bin/run-test.sh for structured, taxonomy-driven load tests.

set -euo pipefail

# ── Help ──────────────────────────────────────────────────────────────────────

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'EOF'
USAGE
  bin/quick.sh <url> [k6-quick flags...]

DESCRIPTION
  Ad-hoc one-command URL smoke test wrapper for the k6-quick Go CLI.

  ** AD-HOC ESCAPE HATCH **
  This script BYPASSES the 5-bucket scenario taxonomy and run-test.sh entirely.
  It uses whatever `k6` binary is on PATH for real runs (except --print-script,
  which prints the generated k6 script and needs no k6 binary).
  For structured, taxonomy-driven load tests, use ./bin/run-test.sh instead.

  Resolution order:
    1. k6-quick on PATH         → exec k6-quick "$@" (all args passed through)
    2. go on PATH (no k6-quick) → go install github.com/jwcastillo/k6-quick@latest,
                                  then exec k6-quick "$@"
    3. no k6-quick, no go      → clear error, non-zero exit (NO JS fallback)

K6-QUICK FLAGS
  <url>                   Target URL (required positional arg)
  -c, --vus N             Number of virtual users (default: 10)
  -d, --duration T        Test duration e.g. 30s, 1m (default: 30s)
  -n, --iterations N      Fixed iteration count (overrides duration)
      --rps N             Target requests per second
  -m, --method METHOD     HTTP method (default: GET)
  -H, --header K:V        Request header (repeatable)
  -b, --body BODY         Request body
      --threshold EXPR    Threshold expression e.g. "http_req_duration:p(95)<500" (repeatable)
      --print-script      Print generated k6 script and exit (no k6 binary needed)

EXIT CODES
  0   success / no threshold breached
  99  k6 threshold failure (propagated from k6-quick via exec)
  1   error (k6-quick error, tool missing, or usage error)

OPTIONAL GO INSTALL
  To install k6-quick manually before first use:
    go install github.com/jwcastillo/k6-quick@latest

EXAMPLES
  bin/quick.sh https://example.com -c 50 -d 30s
  bin/quick.sh https://example.com --rps 100 --threshold "http_req_duration:p(95)<500"
  bin/quick.sh https://example.com --print-script
  bin/quick.sh https://example.com -c 10 -d 1m -H "Authorization:Bearer $TOKEN"
EOF
  exit 0
fi

# ── Tier A: k6-quick already on PATH ──────────────────────────────────────────

if command -v k6-quick >/dev/null 2>&1; then
  exec k6-quick "$@"
fi

# ── Tier B: go available — install k6-quick and exec ─────────────────────────

if command -v go >/dev/null 2>&1; then
  echo "k6-quick not found — installing via go install github.com/jwcastillo/k6-quick@latest" >&2
  if go install github.com/jwcastillo/k6-quick@latest 2>&1; then
    # Resolve the freshly installed binary from GOBIN / GOPATH/bin
    GOBIN_DIR="$(go env GOBIN 2>/dev/null || true)"
    if [[ -z "$GOBIN_DIR" ]]; then
      GOBIN_DIR="$(go env GOPATH 2>/dev/null || true)/bin"
    fi
    export PATH="${GOBIN_DIR}:${PATH}"
    if command -v k6-quick >/dev/null 2>&1; then
      exec k6-quick "$@"
    fi
  fi
  echo "quick.sh: error: k6-quick install failed or binary not found after go install — there is no JS fallback for k6-quick." >&2
  exit 1
fi

# ── Tier C: neither k6-quick nor go ───────────────────────────────────────────

echo "quick.sh: error: neither k6-quick nor go found on PATH." >&2
echo "  Install Go and run: go install github.com/jwcastillo/k6-quick@latest" >&2
echo "  There is no JS fallback for k6-quick." >&2
exit 1
