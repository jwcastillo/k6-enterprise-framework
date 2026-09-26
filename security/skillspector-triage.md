# SkillSpector triage

Scanner: [NVIDIA SkillSpector](https://github.com/NVIDIA/skillspector) v2.12.0, static (`--no-llm`) plus semantic
analysis with `SKILLSPECTOR_PROVIDER=claude_cli`. Targets: every skill in `.claude/skills/` and `mcp-server/src`.
Run `bin/scan-skills.sh` (static) or `bin/scan-skills.sh --semantic`. Accepted findings live in
`security/baselines/<skill>.yaml` as rules (rule id + file + finding text) with the reason below;
CI fails on anything else.

Verdicts: **TP** true positive · **FP** false positive · **TP – upstream PR** true positive in a skill vendored
from `grafana/skills` (see `skills-lock.json`); it is not edited here (that would break the lock hash) and the fix
goes upstream.

## Result per target (static)

| Target | Owner | Before | After | Open findings | Notes |
| --- | --- | --- | --- | --- | --- |
| dashboarding | vendored (grafana/skills) | 9 LOW | 0 LOW **SAFE** | 0 (2 baselined) | complete coverage |
| k6 | vendored (grafana/skills) | 50 MEDIUM | 0 LOW CAUTION | 0 (8 baselined) | partial coverage (parser limits, missing refs) |
| k6-docs | vendored (grafana/skills) | 33 MEDIUM | 0 LOW CAUTION | 0 (3 baselined) | partial coverage |
| opentelemetry | vendored (grafana/skills) | 100 CRITICAL | 0 LOW CAUTION | 0 (13 baselined) | partial coverage; 4 TP pending upstream |
| promql | vendored (grafana/skills) | 0 LOW SAFE | 0 LOW **SAFE** | 0 | complete coverage |
| k6-performance-tester | framework | 15 LOW | 0 LOW CAUTION | 0 | partial: ~40 references to repo paths not bundled with the skill |
| performance-engineering | framework | 100 CRITICAL | 0 LOW CAUTION | 0 (19 baselined) | partial coverage (parser limits) |
| performance-report | framework | 25 MEDIUM | 0 LOW CAUTION | 0 | partial: one path reference; it reaches SAFE once the line that names a replay capture file drops it |
| mcp-server/src | framework | 9 LOW | 0 LOW CAUTION | 0 | partial: parser span limits on TS template literals |

`CAUTION` with score 0 and no findings: SkillSpector fails closed whenever coverage is partial. For these targets
that is (a) references to framework files that live in the repo, not in the skill bundle (`reference_missing`),
and (b) its bounded shell parser giving up on backtick code spans and `${obj.prop}` template literals
(`static_parse_limit`). Neither can be removed without deleting the repo paths and code examples that are the
point of those skills.

## Resolved in this change

| Skill | Finding id | Severity | Pattern | File:line | Verdict | Reason | Action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| performance-engineering | TM2/PE3/PE2 | HIGH/MEDIUM | Chaining abuse / credential access / sudo | references/cicd-perf-gates.md:51-77 | FP (CI doc) → rewritten | `sudo gpg`/keyring/apt steps inside a GitHub Actions example, not agent instructions | Replaced with `grafana/setup-k6-action@v1` (also fixes the second job, which installed k6 without adding the repo) |
| performance-engineering | E1 | MEDIUM | External transmission | references/cicd-perf-gates.md:92 | FP → rewritten | Slack webhook POST from CI secrets | `slackapi/slack-github-action@v2` |
| performance-engineering | TM1 | HIGH | Tool parameter abuse (`git push --force`, `git reset --hard`) | references/code-review-commit-workflow.md:412,415; CHANGELOG.md:227 | FP → rewritten | Listed as actions that need explicit authorization | Reworded without the literal commands |
| performance-engineering | RA1 | HIGH | Self-modification | references/skill-self-maintenance.md:9; expert-profiles.md:350; CHANGELOG.md:163 | FP → rewritten | Text says the skill is NOT autonomous self-update; edits need per-commit approval | "autonomous editing of the skill" |
| performance-engineering | AR1 | HIGH | Anti-refusal statement | references/expert-profiles.md:439 | FP → rewritten | "don't refuse to look at the new dimension" is about profile scope | "instead of ignoring the new dimension" |
| performance-engineering | EA2 | MEDIUM | Autonomous decision making | SKILL.md:75; CHANGELOG.md:171 | FP → rewritten | "Don't ask the user for what the context doc provides" / "no version bump without consent" | Reworded |
| performance-engineering | E1 | MEDIUM | External transmission | references/llm-perf-and-tokens.md:32 | FP → rewritten | Raw curl to the token-count API, duplicated by the SDK example below it | curl block removed |
| performance-engineering | E1 | MEDIUM | External transmission | references/diagnostic-playbooks.md:18; tool-selection-guide.md:122 | FP → rewritten | Prose mention of `curl -w`; wrk2 example against a sample host | Reworded; `$BASE_URL` |
| performance-engineering | RP1 | MEDIUM | Unpinned image | references/cicd-pipeline-optimization.md:302 | FP → rewritten | `docker run --rm` in an anti-pattern bullet, no image | Reworded |
| k6-performance-tester | RP1 | MEDIUM | Unpinned npx | SKILL.md:766 | TP → fixed | `npx tsc` fetches the unrelated `tsc` package when typescript is absent; repo uses pnpm | `pnpm build` / `pnpm typecheck` |
| k6-performance-tester | AS3 | MEDIUM | Skill enumeration | SKILL.md:28 | FP → rewritten | Mentions personal `~/.claude/skills/` config; matched because the heading ends in "ls" | Reworded |
| performance-report | AE1 | HIGH | Incomplete analysis (runtime limit) | SKILL.md:82 | FP (transient) | 0.25 s artifact-integrity limit hit while another scan loaded the machine; clean on re-run | None needed; a slow CI runner can hit it again (see Limitations in the docs) |
| mcp-server/src | RP1 | MEDIUM | Unpinned npx | tools/ai-tools.ts:350 | TP → fixed | `npx tsc` would fetch the unrelated `tsc` package when typescript is missing | Runs `<repo>/node_modules/.bin/tsc` |

## Accepted (baselined)

| Skill | Finding id | Severity | Pattern | File:line | Verdict | Reason | Action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| dashboarding | E1 | MEDIUM | External Transmission | SKILL.md:56 | FP | Documented Grafana HTTP API call to the user's own $GRAFANA with their $TOKEN; that is the skill's purpose, no third-party destination. | Baselined |
| dashboarding | E1 | MEDIUM | External Transmission | SKILL.md:119 | FP | Documented Grafana HTTP API call to the user's own $GRAFANA with their $TOKEN; that is the skill's purpose, no third-party destination. | Baselined |
| k6 | AE1 | HIGH | Incomplete referenced artifact analysis | SKILL.md:21 | FP | Scanner limitation: the static shell parser hit its span limit on markdown/JS (backtick code spans, `${obj.prop}` template literals, `<placeholder>` text) or a missing repo-path reference; not evasion. | Baselined |
| k6 | AE1 | HIGH | Incomplete referenced artifact analysis | SKILL.md:23 | FP | Scanner limitation: the static shell parser hit its span limit on markdown/JS (backtick code spans, `${obj.prop}` template literals, `<placeholder>` text) or a missing repo-path reference; not evasion. | Baselined |
| k6 | AE1 | HIGH | Incomplete referenced artifact analysis | SKILL.md:153 | FP | Scanner limitation: the static shell parser hit its span limit on markdown/JS (backtick code spans, `${obj.prop}` template literals, `<placeholder>` text) or a missing repo-path reference; not evasion. | Baselined |
| k6 | AE1 | HIGH | Incomplete referenced artifact analysis | SKILL.md:28 | FP | Scanner limitation: the static shell parser hit its span limit on markdown/JS (backtick code spans, `${obj.prop}` template literals, `<placeholder>` text) or a missing repo-path reference; not evasion. | Baselined |
| k6 | AE1 | HIGH | Incomplete referenced artifact analysis | SKILL.md:164 | FP | Scanner limitation: the static shell parser hit its span limit on markdown/JS (backtick code spans, `${obj.prop}` template literals, `<placeholder>` text) or a missing repo-path reference; not evasion. | Baselined |
| k6 | AE1 | HIGH | Incomplete referenced artifact analysis | SKILL.md:32 | FP | Scanner limitation: the static shell parser hit its span limit on markdown/JS (backtick code spans, `${obj.prop}` template literals, `<placeholder>` text) or a missing repo-path reference; not evasion. | Baselined |
| k6 | AE1 | HIGH | Incomplete referenced artifact analysis | SKILL.md:41 | FP | Scanner limitation: the static shell parser hit its span limit on markdown/JS (backtick code spans, `${obj.prop}` template literals, `<placeholder>` text) or a missing repo-path reference; not evasion. | Baselined |
| k6 | LP3 | MEDIUM | MCP Least Privilege | SKILL.md:1 | TP – upstream PR | SKILL.md has no allowed-tools frontmatter; declaring the tool scope is a cheap least-privilege improvement upstream. | Upstream PR to grafana/skills; baselined meanwhile |
| k6-docs | P2 | HIGH | Hidden Instructions | references/testing-workflow.md:9 | FP | `<!-- md-k6:skip -->` is the literal docs-tooling marker being documented, inside inline code; no hidden instruction. | Baselined |
| k6-docs | LP3 | MEDIUM | MCP Least Privilege | SKILL.md:1 | TP – upstream PR | SKILL.md has no allowed-tools frontmatter; declaring the tool scope is a cheap least-privilege improvement upstream. | Upstream PR to grafana/skills; baselined meanwhile |
| k6-docs | RA2 | MEDIUM | Session Persistence | references/troubleshooting.md:171 | FP | Troubleshooting tip telling the human to add npm's bin dir to PATH in their shell rc; the agent is not told to persist anything. | Baselined |
| opentelemetry | AE1 | HIGH | Incomplete referenced artifact analysis | SKILL.md:94 | FP | Scanner limitation: the static shell parser hit its span limit on markdown/JS (backtick code spans, `${obj.prop}` template literals, `<placeholder>` text) or a missing repo-path reference; not evasion. | Baselined |
| opentelemetry | AE1 | HIGH | Incomplete referenced artifact analysis | SKILL.md:136 | FP | Scanner limitation: the static shell parser hit its span limit on markdown/JS (backtick code spans, `${obj.prop}` template literals, `<placeholder>` text) or a missing repo-path reference; not evasion. | Baselined |
| opentelemetry | AE1 | HIGH | Incomplete referenced artifact analysis | SKILL.md:96 | FP | Scanner limitation: the static shell parser hit its span limit on markdown/JS (backtick code spans, `${obj.prop}` template literals, `<placeholder>` text) or a missing repo-path reference; not evasion. | Baselined |
| opentelemetry | PE5 | HIGH | Privileged Container / Container Escape | references/instrumentation.md:718 | TP – upstream PR | Beyla Docker example uses --privileged; Beyla documents a capability-based alternative (BPF, PERFMON, SYS_PTRACE, ...) that should be the default example. | Upstream PR to grafana/skills; baselined meanwhile |
| opentelemetry | PE5 | HIGH | Privileged Container / Container Escape | references/instrumentation.md:719 | FP | Host networking is required for Beyla to observe host traffic in the documented deployment; documentation of a required setting. | Baselined |
| opentelemetry | TM4 | HIGH | Privileged Kubernetes Workload | references/instrumentation.md:744 | FP | hostPID is required by the Beyla DaemonSet to see node processes; documented requirement. | Baselined |
| opentelemetry | TM4 | HIGH | Privileged Kubernetes Workload | references/instrumentation.md:749 | TP – upstream PR | Beyla DaemonSet example runs privileged; upstream should show the capability-based securityContext instead. | Upstream PR to grafana/skills; baselined meanwhile |
| opentelemetry | TM4 | HIGH | Privileged Kubernetes Workload | references/instrumentation.md:762 | FP | Read-only style mount of /sys/kernel/security required by eBPF; documented requirement. | Baselined |
| opentelemetry | PE2 | MEDIUM | Sudo/Root Execution | references/collector-config.md:15 | FP | `sudo apt-get install alloy` is a human install instruction in a reference doc, not an agent instruction. | Baselined |
| opentelemetry | RP1 | MEDIUM | MCP Rug Pull | references/collector-config.md:18 | TP – upstream PR | Docker images referenced without a tag (implicit :latest); upstream examples should pin a version. | Upstream PR to grafana/skills; baselined meanwhile |
| opentelemetry | RP1 | MEDIUM | MCP Rug Pull | references/collector-config.md:342 | TP – upstream PR | Docker images referenced without a tag (implicit :latest); upstream examples should pin a version. | Upstream PR to grafana/skills; baselined meanwhile |
| opentelemetry | RP1 | MEDIUM | MCP Rug Pull | references/instrumentation.md:717 | TP – upstream PR | Docker images referenced without a tag (implicit :latest); upstream examples should pin a version. | Upstream PR to grafana/skills; baselined meanwhile |
| opentelemetry | E1 | MEDIUM | External Transmission | references/instrumentation.md:815 | FP | curl smoke test against the user's own Grafana Cloud OTLP endpoint with a placeholder credential. | Baselined |
| performance-engineering | AE1 | HIGH | Incomplete referenced artifact analysis | SKILL.md:16 | FP | Scanner limitation: the static shell parser hit its span limit on markdown/JS (backtick code spans, `${obj.prop}` template literals, `<placeholder>` text) or a missing repo-path reference; not evasion. | Baselined |
| performance-engineering | AE1 | HIGH | Incomplete referenced artifact analysis | SKILL.md:26 | FP | Scanner limitation: the static shell parser hit its span limit on markdown/JS (backtick code spans, `${obj.prop}` template literals, `<placeholder>` text) or a missing repo-path reference; not evasion. | Baselined |
| performance-engineering | AE1 | HIGH | Incomplete referenced artifact analysis | SKILL.md:61 | FP | Scanner limitation: the static shell parser hit its span limit on markdown/JS (backtick code spans, `${obj.prop}` template literals, `<placeholder>` text) or a missing repo-path reference; not evasion. | Baselined |
| performance-engineering | AE1 | HIGH | Incomplete referenced artifact analysis | SKILL.md:66 | FP | Scanner limitation: the static shell parser hit its span limit on markdown/JS (backtick code spans, `${obj.prop}` template literals, `<placeholder>` text) or a missing repo-path reference; not evasion. | Baselined |
| performance-engineering | AE1 | HIGH | Incomplete referenced artifact analysis | SKILL.md:308 | FP | Scanner limitation: the static shell parser hit its span limit on markdown/JS (backtick code spans, `${obj.prop}` template literals, `<placeholder>` text) or a missing repo-path reference; not evasion. | Baselined |
| performance-engineering | AE1 | HIGH | Incomplete referenced artifact analysis | SKILL.md:143 | FP | Scanner limitation: the static shell parser hit its span limit on markdown/JS (backtick code spans, `${obj.prop}` template literals, `<placeholder>` text) or a missing repo-path reference; not evasion. | Baselined |
| performance-engineering | AE1 | HIGH | Incomplete referenced artifact analysis | SKILL.md:343 | FP | Scanner limitation: the static shell parser hit its span limit on markdown/JS (backtick code spans, `${obj.prop}` template literals, `<placeholder>` text) or a missing repo-path reference; not evasion. | Baselined |
| performance-engineering | AE1 | HIGH | Incomplete referenced artifact analysis | SKILL.md:144 | FP | Scanner limitation: the static shell parser hit its span limit on markdown/JS (backtick code spans, `${obj.prop}` template literals, `<placeholder>` text) or a missing repo-path reference; not evasion. | Baselined |
| performance-engineering | AE1 | HIGH | Incomplete referenced artifact analysis | SKILL.md:344 | FP | Scanner limitation: the static shell parser hit its span limit on markdown/JS (backtick code spans, `${obj.prop}` template literals, `<placeholder>` text) or a missing repo-path reference; not evasion. | Baselined |
| performance-engineering | AE1 | HIGH | Incomplete referenced artifact analysis | SKILL.md:323 | FP | Scanner limitation: the static shell parser hit its span limit on markdown/JS (backtick code spans, `${obj.prop}` template literals, `<placeholder>` text) or a missing repo-path reference; not evasion. | Baselined |
| performance-engineering | AE1 | HIGH | Incomplete referenced artifact analysis | SKILL.md:327 | FP | Scanner limitation: the static shell parser hit its span limit on markdown/JS (backtick code spans, `${obj.prop}` template literals, `<placeholder>` text) or a missing repo-path reference; not evasion. | Baselined |
| performance-engineering | AE1 | HIGH | Incomplete referenced artifact analysis | SKILL.md:331 | FP | Scanner limitation: the static shell parser hit its span limit on markdown/JS (backtick code spans, `${obj.prop}` template literals, `<placeholder>` text) or a missing repo-path reference; not evasion. | Baselined |
| performance-engineering | AE1 | HIGH | Incomplete referenced artifact analysis | SKILL.md:333 | FP | Scanner limitation: the static shell parser hit its span limit on markdown/JS (backtick code spans, `${obj.prop}` template literals, `<placeholder>` text) or a missing repo-path reference; not evasion. | Baselined |
| performance-engineering | AE1 | HIGH | Incomplete referenced artifact analysis | SKILL.md:345 | FP | Scanner limitation: the static shell parser hit its span limit on markdown/JS (backtick code spans, `${obj.prop}` template literals, `<placeholder>` text) or a missing repo-path reference; not evasion. | Baselined |
| performance-engineering | P2 | HIGH | Hidden Instructions | references/web-vitals-deep-dive.md:64 | FP | HTML comments inside ```html performance examples; the regex spans DOTALL from one comment to a keyword pages later. Visible code, not hidden instructions. | Baselined |
| performance-engineering | P2 | HIGH | Hidden Instructions | references/web-vitals-deep-dive.md:64 | FP | HTML comments inside ```html performance examples; the regex spans DOTALL from one comment to a keyword pages later. Visible code, not hidden instructions. | Baselined |
| performance-engineering | P2 | HIGH | Hidden Instructions | references/web-vitals-deep-dive.md:174 | FP | HTML comments inside ```html performance examples; the regex spans DOTALL from one comment to a keyword pages later. Visible code, not hidden instructions. | Baselined |
| performance-engineering | AS3 | MEDIUM | Skill Enumeration | INTEGRATION-NOTES.md:20 | FP | Attribution link to the upstream source of integrated guidance (a URL ending in SKILL.md); the skill never reads other skills. | Baselined |
| performance-engineering | AS3 | MEDIUM | Skill Enumeration | README.md:396 | FP | Attribution link to the upstream source of integrated guidance (a URL ending in SKILL.md); the skill never reads other skills. | Baselined |

## Semantic analysis (claude_cli)

Semantic runs add quality/intent analyzers (SQP, SDI, TP4). Framework-owned findings were fixed; vendored ones are
baselined as TP pending upstream PRs. A recursive semantic scan hits SkillSpector's aggregate limit, so
`bin/scan-skills.sh --semantic` scans one skill at a time.

| Skill | Finding id | Severity | File | Verdict | Reason / action |
| --- | --- | --- | --- | --- | --- |
| performance-engineering | SQP-2 | MEDIUM | SKILL.md:108 | TP → fixed | "Executes the measurement directly (k6 runs)" without confirmation → load runs need the user's confirmation of target and profile, never production without approval |
| performance-engineering | SQP-2 | MEDIUM | references/external-tools-and-mcp.md:110 | TP → fixed | EXPLAIN ANALYZE executes the statement → restricted to SELECT / rolled-back transaction, ask first |
| performance-engineering | SQP-2 | MEDIUM | references/java-frameworks-and-distributions.md:110 | TP → fixed | Actuator heapdump/threaddump/httptrace exposed → separate non-public management port |
| performance-engineering | SQP-2 | MEDIUM | references/k6-patterns.md:472 | TP → fixed | "Run a 30s smoke if possible" → only after the user confirms a non-production target |
| performance-engineering | SQP-2 | MEDIUM | references/runtime-perf-tuning.md:558 | TP → fixed | `node --inspect=0.0.0.0` → loopback only |
| performance-engineering | SQP-1 | LOW | SKILL.md:3 | TP → fixed | Broad triggers → description now excludes unrelated coding / passing complaints |
| performance-engineering | SDI-1 | LOW | SKILL.md:143 | TP → fixed | Read-and-report manifest vs commit workflow → description states commits are proposed and applied per approval |
| performance-engineering | SQP-2 | LOW | references/db-optimization.md:108 | TP → fixed | Drop unused indexes → never PK/unique, check replicas |
| performance-engineering | SQP-2 | LOW | references/diagnostic-playbooks.md:19 | TP → fixed | Captured production traffic → redact, gitignored dir, delete after |
| performance-engineering | SDI-2/SQP-2 | LOW | references/llm-perf-and-tokens.md:314 | TP → fixed | `rtk init -g` global hook → user decision, never run for them |
| performance-engineering | SQP-2 | LOW | references/runtime-perf-tuning.md:145 | TP → fixed | Heap dumps hold process memory → restrict and delete |
| performance-engineering | SQP-3 | LOW | references/expert-profiles.md:447 | FP | Spanish-only activation templates are intentional; baselined |
| k6-performance-tester | SQP-2 | MEDIUM | SKILL.md:446 | TP → fixed | Heavy profiles without a production warning → only smoke/quick by default, confirmed non-production target |
| k6-performance-tester | SQP-2 | LOW | SKILL.md:1076 | TP → fixed | Redis cleanup deletes every key under the prefix → use a dedicated test Redis |
| performance-report | SQP-2 | LOW | SKILL.md:76 | TP (deferred) | Publishing a client-readable doc without a review step; left for the separate client-references cleanup of this file to avoid conflicting edits |
| mcp-server/src | SDI-4 | LOW | tools/ai-tools.ts:498 | TP → fixed | JSDoc said Jira credentials params are used; the code (correctly) reads env vars only → JSDoc fixed |
| dashboarding | SQP-2 | LOW | SKILL.md | TP – upstream PR | Pushes use overwrite: true without warning that an existing dashboard with the same uid/title is replaced; should check first or warn. |
| k6 | SQP-2 | MEDIUM | SKILL.md | TP – upstream PR | Step 5 validates with a real k6 run without asking; the validation run sends traffic to whatever the script targets. Should ask for or confirm a non-production target. In this repo the PreToolUse hook blocks bare k6 run anyway. |
| k6-docs | TP4 | MEDIUM | SKILL.md | TP – upstream PR | Description does not disclose that a helper installs a global third-party npm package (agent-browser). |
| k6-docs | SQP-2 | LOW | SKILL.md | TP – upstream PR | Validation steps switch the user's k6 checkout to master and pull without checking git status or asking. |
| k6-docs | SQP-2 | LOW | references/agent-browser-reference.md | TP – upstream PR | Tells the agent to npm install -g agent-browser without asking the user. |
| k6-docs | SQP-2 | LOW | references/testing-workflow.md | TP – upstream PR | git checkout/pull master in the user's repo without checking for local work. |
| k6-docs | SQP-2 | LOW | references/workflows/review.md | TP – upstream PR | Checks out branches in several repos without warning about uncommitted work. |
| k6-docs | SDI-2 | LOW | scripts/check_agent_browser.sh | TP – upstream PR | Script installs an unpinned global npm package outside the declared scope. |
| opentelemetry | SQP-2 | MEDIUM | references/instrumentation.md | TP – upstream PR | Same Beyla privileged/host-namespace settings as PE5/TM4, with no warning; upstream should show least-privilege capabilities. |
| opentelemetry | SQP-2 | LOW | references/collector-config.md | TP – upstream PR | insecure_skip_verify for kubelet scraping and an Alloy UI bound to 0.0.0.0 without a warning. |

## Counts

- Static — accepted (baselined): 38 FP occurrences, 7 TP occurrences pending upstream PRs (vendored skills);
  resolved here: 13 findings (2 TP fixed, 11 FP rewritten away or transient).
- Semantic — framework-owned: 15 TP fixed, 1 TP deferred (performance-report, LOW), 1 FP baselined;
  vendored: 10 TP pending upstream PRs, baselined.
