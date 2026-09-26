#!/usr/bin/env bash
# bin/scan-skills.sh — NVIDIA SkillSpector scan of agent skills and the MCP server.
#
# Usage:
#   bin/scan-skills.sh [--semantic] [--sarif-dir=<dir>] [path...]
#
#   path        a skill dir (has SKILL.md), a dir of skills, or any source dir.
#               Default: .claude/skills mcp-server/src
#   --semantic  add LLM analysis through the local claude CLI session
#               (SKILLSPECTOR_PROVIDER=claude_cli unless already set)
#   --sarif-dir where SARIF goes (default: reports/skillspector): one file per
#               target plus skillspector.sarif, all merged with repo-relative paths
#
# Each skill is scanned on its own (a recursive scan hits SkillSpector's
# aggregate limit in semantic mode) against security/baselines/<name>.yaml,
# the triaged findings documented in security/skillspector-triage.md.
# Exit 1 when any target has a finding that is not in its baseline, 2 on setup errors.
#
# Install: uv tool install git+https://github.com/NVIDIA/skillspector.git

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASELINE_DIR="${ROOT_DIR}/security/baselines"
SARIF_DIR="${ROOT_DIR}/reports/skillspector"
SEMANTIC=false
PATHS=()

for arg in "$@"; do
  case "$arg" in
    --semantic) SEMANTIC=true ;;
    --sarif-dir=*) SARIF_DIR="${arg#*=}" ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "scan-skills: unknown flag $arg" >&2; exit 2 ;;
    *) PATHS+=("$arg") ;;
  esac
done
[[ ${#PATHS[@]} -eq 0 ]] && PATHS=("${ROOT_DIR}/.claude/skills" "${ROOT_DIR}/mcp-server/src")

if ! command -v skillspector >/dev/null 2>&1; then
  echo "scan-skills: skillspector not found. Install: uv tool install git+https://github.com/NVIDIA/skillspector.git" >&2
  exit 2
fi

MODE_ARGS=(--no-llm)
if $SEMANTIC; then
  MODE_ARGS=()
  export SKILLSPECTOR_PROVIDER="${SKILLSPECTOR_PROVIDER:-claude_cli}"
fi

# Expand a dir of skills into one target per skill.
TARGETS=()
for p in "${PATHS[@]}"; do
  p="$(cd "$p" && pwd)" || exit 2
  if [[ -f "$p/SKILL.md" ]]; then
    TARGETS+=("$p")
  elif compgen -G "$p/*/SKILL.md" >/dev/null; then
    for s in "$p"/*/SKILL.md; do TARGETS+=("$(dirname "$s")"); done
  else
    TARGETS+=("$p")
  fi
done

mkdir -p "$SARIF_DIR"
SARIF_DIR="$(cd "$SARIF_DIR" && pwd)"
FAILED=()
for t in "${TARGETS[@]}"; do
  name="$(basename "$t")"
  [[ "$name" == "src" ]] && name="$(basename "$(dirname "$t")")"
  baseline="${BASELINE_DIR}/${name}.yaml"
  base_args=()
  [[ -f "$baseline" ]] && base_args=(--baseline "$baseline")
  sarif="${SARIF_DIR}/${name}.sarif"
  rm -f "$sarif"

  skillspector scan "$t" "${MODE_ARGS[@]}" "${base_args[@]}" --format sarif -o "$sarif" >/dev/null 2>&1
  # Rewrite locations to repo-relative paths and count unsuppressed results.
  count="$(node - "$sarif" "${t#"$ROOT_DIR"/}" <<'JS'
const fs = require("fs");
const [file, prefix] = process.argv.slice(2);
try {
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  let open = 0;
  for (const run of doc.runs || []) {
    for (const r of run.results || []) {
      for (const loc of r.locations || []) {
        const a = loc.physicalLocation && loc.physicalLocation.artifactLocation;
        if (a && a.uri && !a.uri.startsWith(prefix + "/")) a.uri = `${prefix}/${a.uri}`;
      }
      if (!(r.suppressions || []).length) {
        open++;
        const l = ((r.locations || [])[0] || {}).physicalLocation || {};
        console.error(`    ${r.ruleId} ${(r.properties || {}).severity || r.level} ${(l.artifactLocation || {}).uri}:${(l.region || {}).startLine || ""} ${String((r.message || {}).text || "").slice(0, 90)}`);
      }
    }
  }
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + "\n");
  console.log(open);
} catch {
  console.log("error");
}
JS
)"
  if [[ "$count" == "0" ]]; then
    printf '  %-26s clean (baseline: %s)\n' "$name" "$([[ -f "$baseline" ]] && echo "${baseline#"$ROOT_DIR"/}" || echo none)"
  elif [[ "$count" == "error" ]]; then
    printf '  %-26s SCAN FAILED — no SARIF produced\n' "$name"
    FAILED+=("$name")
  else
    printf '  %-26s %s new finding(s) — %s\n' "$name" "$count" "${sarif#"$ROOT_DIR"/}"
    FAILED+=("$name")
  fi
done

# One merged run for code scanning (it rejects several runs of one tool per upload).
node - "$SARIF_DIR" <<'JS'
const fs = require("fs");
const path = require("path");
const dir = process.argv[2];
let merged = null;
for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".sarif") && n !== "skillspector.sarif").sort()) {
  const doc = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  for (const run of doc.runs || []) {
    if (!merged) merged = { ...doc, runs: [{ ...run, results: [], invocations: [] }] };
    const rules = merged.runs[0].tool.driver.rules || (merged.runs[0].tool.driver.rules = []);
    for (const rule of run.tool.driver.rules || []) if (!rules.some((x) => x.id === rule.id)) rules.push(rule);
    merged.runs[0].results.push(...(run.results || []));
    merged.runs[0].invocations.push(...(run.invocations || []));
  }
}
if (merged) fs.writeFileSync(path.join(dir, "skillspector.sarif"), JSON.stringify(merged, null, 2) + "\n");
JS

if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo "scan-skills: new findings in: ${FAILED[*]}. Fix them, or triage in security/skillspector-triage.md and add to security/baselines/<name>.yaml." >&2
  exit 1
fi
echo "scan-skills: all targets clean against their baselines."
