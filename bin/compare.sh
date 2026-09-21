#!/usr/bin/env bash
# compare.sh — prefer-k6-compare wrapper with go-install and JS fallback
#
# T-261-compare: Three-tier resolution for baseline-vs-current regression gating.
#   Tier A — k6-compare on PATH:   exec k6-compare positionally (exit 0/3/5/1)
#   Tier B — go on PATH:           go install k6-compare, then exec it
#   Tier C — no k6-compare/go:     fall back to node bin/compare-results.js (exit 0/1)
#
# Usage: bin/compare.sh <baseline.json> <current.json> [extra k6-compare flags...]
#
# Exit codes:
#   0  — no regression detected
#   3  — regression detected (k6-compare only)
#   5  — load-model mismatch / open vs closed (k6-compare only)
#   1  — error / usage / degraded (also the compare-results.js fallback exit for degraded)

set -euo pipefail

# ── Help ──────────────────────────────────────────────────────────────────────

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'EOF'
USAGE
  bin/compare.sh <baseline.json> <current.json> [extra k6-compare flags...]

DESCRIPTION
  Wrapper that prefers the k6-compare Go tool for precise, per-metric,
  load-model-aware regression gating. Falls back to bin/compare-results.js
  when neither k6-compare nor go is available.

  Resolution order:
    1. k6-compare on PATH                 → exec k6-compare positionally
    2. go on PATH (but no k6-compare yet) → go install github.com/jwcastillo/k6-compare@latest,
                                            then exec k6-compare
    3. no k6-compare, no go               → node bin/compare-results.js --baseline=<f> --current=<f>
                                            (fallback; richer per-metric gating + load-model
                                            safety require k6-compare)

EXIT CODES
  0   no regression detected
  3   regression detected                       (k6-compare only)
  5   load-model mismatch (open vs closed loop) (k6-compare only)
  1   tool error / usage error / degraded       (also the fallback exit for degraded)

OPTIONAL GO INSTALL
  To install k6-compare manually before first use:
    go install github.com/jwcastillo/k6-compare@latest

EXAMPLES
  bin/compare.sh reports/my-client/api/summary-20260101-120000.json \
                 reports/my-client/api/summary-20260613-100000.json
EOF
  exit 0
fi

# ── Argument validation ────────────────────────────────────────────────────────

if [[ $# -lt 2 ]]; then
  echo "compare.sh: error: requires exactly two positional args: <baseline.json> <current.json>" >&2
  echo "Usage: bin/compare.sh <baseline.json> <current.json> [extra k6-compare flags...]" >&2
  exit 1
fi

BASELINE="$1"
CURRENT="$2"
shift 2
EXTRA=("$@")

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Tier A: k6-compare already on PATH ────────────────────────────────────────

if command -v k6-compare >/dev/null 2>&1; then
  exec k6-compare "$BASELINE" "$CURRENT" "${EXTRA[@]+"${EXTRA[@]}"}"
fi

# ── Tier B: go available — install k6-compare and exec ───────────────────────

if command -v go >/dev/null 2>&1; then
  echo "k6-compare not found — installing via go install github.com/jwcastillo/k6-compare@latest" >&2
  if go install github.com/jwcastillo/k6-compare@latest 2>&1; then
    # Resolve the freshly installed binary from GOBIN / GOPATH/bin
    GOBIN_DIR="$(go env GOBIN 2>/dev/null || true)"
    if [[ -z "$GOBIN_DIR" ]]; then
      GOBIN_DIR="$(go env GOPATH 2>/dev/null || true)/bin"
    fi
    export PATH="${GOBIN_DIR}:${PATH}"
    if command -v k6-compare >/dev/null 2>&1; then
      exec k6-compare "$BASELINE" "$CURRENT" "${EXTRA[@]+"${EXTRA[@]}"}"
    fi
  fi
  echo "k6-compare install failed or binary not found — falling back to bin/compare-results.js" >&2
fi

# ── Tier C: fallback to bin/compare-results.js ────────────────────────────────
# Note: compare-results.js uses exit 0 (ok) / 1 (degraded) only — the 0/3/5 exit
# codes from k6-compare are NOT available via this fallback. The no-Go fallback
# still gates (exit 1 surfaces as FINAL_EXIT=99 in run-test.sh Step 4b).

echo "k6-compare/go unavailable — falling back to bin/compare-results.js; richer per-metric gating + load-model safety need k6-compare" >&2
exec node "$SCRIPT_DIR/compare-results.js" --baseline="$BASELINE" --current="$CURRENT"
