# External tools and MCP integration

How the skill consumes external tools — both Anthropic-managed MCP servers (Grafana, Linear, Jira, Slack, GitHub, etc.) and any custom scripts in `scripts/`. Read this when the engagement involves tooling beyond pure conversation.

This complements the skill's documentation-first approach with a clear pattern for when and how to invoke real tools.

---

## The tool discovery pattern (always use this)

When the user's task implies a tool would help, **always** call `tool_search` before assuming a capability isn't available. The visible tool list in any conversation is partial; many tools are deferred and loaded via search.

```
User: "Check our checkout dashboard for p99 trend"

Wrong: assume Grafana isn't connected, ask user to paste a screenshot.
Right: call tool_search(query="grafana dashboards"), see if the Grafana MCP
       is available, use it directly.
```

**Pattern in every engagement:**

1. Read the context document (if available) — it should list connected MCP servers under "Available diagnostic tools"
2. If context document is missing or stale, call `tool_search` with relevant keywords on first need
3. Only fall back to "user, please paste this" after tool_search returns empty

---

## MCP servers commonly relevant for PE engagements

### Grafana MCP

When connected, gives Claude direct access to:
- List dashboards, search by name or tag
- Query Prometheus / Loki / Tempo / Pyroscope data sources via PromQL / LogQL / TraceQL
- Read panel configurations and alert rules
- Inspect dashboard JSON for offline analysis

**Usage pattern:**
```
For any "what's the p99 right now" type question:
1. tool_search("grafana") → confirm Grafana MCP available
2. Use Grafana MCP to query: histogram_quantile(0.99, sum by (le)(rate(http_request_duration_seconds_bucket{service="checkout"}[5m])))
3. Report the value, include the query in the response for reproducibility
```

**Limitations**: Grafana MCP is read-only by default. Dashboard creation / modification typically requires the user to do it via the UI.

### Linear / Jira / GitHub Issues MCP

When connected, enables ticket creation from findings.

**Critical safety rule**: ticket creation is **always** an explicit-permission action. Never auto-create tickets, even if the user said "generate tickets" earlier in the conversation. Each batch of tickets requires explicit confirmation:

```
"I have 5 tickets drafted from the findings. Reviewing them in the chat first
so you can adjust before I create them in Linear. Confirm when ready: 'create
all' / 'create #1 #3 only' / 'edit #2 first'."
```

**Pattern for `ticket-generation` mode:**

1. Draft tickets in the conversation using the format from `references/ticket-generation.md`
2. User reviews, adjusts, approves
3. Call the MCP to create tickets, batch them in a single user-confirmation round
4. Return ticket IDs / URLs so the user can verify

### Slack / Teams MCP

When connected, useful for:
- Posting weekly digest to engagement channel (use case for `engagement-mode`)
- Cross-referencing existing discussions (search prior context on an incident)

**Safety rules:**
- Never auto-post — always show the user the message first, ask for `post` / `edit` / `cancel`
- Posting to a channel is an irreversible action (well, deletable, but visible to everyone)
- For exec digests, post via Slack only if the user explicitly asks; default to producing the markdown for them to copy

### Datadog / New Relic / Dynatrace MCP

When connected, gives APM data access. **Note**: Dynatrace is commonly used in enterprise environments; its MCP coverage may vary. If Dynatrace MCP is unavailable, prompt the user to paste relevant traces / charts.

**Pattern for observability-discrepancy investigations** (your active Istio vs Dynatrace case):

```
1. Query Istio metrics via Grafana MCP (PromQL on Prometheus/Mimir)
2. Query equivalent metric via Dynatrace MCP if available, otherwise ask user
3. Cross-check: histogram bucket configuration via Grafana → look for +Inf saturation
4. Report divergence with hypothesis ranking from references/tool-selection-guide.md
```

### GitHub MCP

When connected, enables:
- Reading source code to confirm hypotheses (e.g., "is CartEnricher.java doing N+1?")
- Drafting PR descriptions
- Linking PRs to tickets

**Safety rules:**
- Never auto-merge PRs (this is always explicit permission)
- Code reading is fine; code modification via PR creation requires user confirmation
- Respect access boundaries declared in context document (e.g., "no access to source code")

### Filesystem MCP

For local file access — reading project context docs, ADRs, runbooks the user has in their workspace. Always read-only unless the user explicitly grants write.

### Database MCPs (Postgres / MySQL)

For query plan analysis. **Always read-only.** Even when granted write, only run `EXPLAIN` / `EXPLAIN ANALYZE` / read queries.

### k6 Cloud / Grafana Cloud MCP

For load test orchestration. When connected, the skill can:
- Start a k6 scenario in the cloud and stream results
- Retrieve historical campaign results for baseline comparison

---

## Tool registration in the context document

When a user provides a context document (see `references/context-document-template.md`), it should declare connected MCP servers under "Available diagnostic tools":

```markdown
## Available diagnostic tools

- **Grafana** (URL: ...) — connected via Grafana MCP server; data sources: ...
- **Linear** — connected via Linear MCP server; project `X` for ticket creation
- **GitHub** — repo `org/repo` accessible; PRs OK; merge needs reviewer approval
- **Dynatrace** — web UI access (no MCP integration); ask user to paste relevant data
```

The skill reads this on every engagement start and uses it to:
- Skip "do you have Grafana?" questions when context says yes
- Default to specific MCPs without re-asking
- Know which tools to fall back from (Dynatrace via paste vs Grafana via MCP)

---

## Custom scripts pattern (when `scripts/` has content)

The skill ships with an empty `scripts/` directory plus documentation (see `scripts/README.md`). Future versions may add deterministic helpers.

**Invocation pattern from a reference file:**

```markdown
For a PromQL query going into a production alert, validate first:

\`\`\`bash
python scripts/validate_promql.py "<your-query>"
\`\`\`

The script catches counter-without-rate, histogram-quantile-on-non-bucket,
and missing-label-matchers bugs.
```

**Detection in skill:**
1. Check `scripts/` directory at engagement start (one `ls`)
2. If specific scripts are referenced in a reference being loaded, mention their availability
3. Invoke via `bash_tool` only with explicit user confirmation for first use in the conversation

**Why not auto-invoke**: scripts are deterministic but their output may not match the user's preferred response shape. Defaulting to "show me the script's plan, then run with confirmation" is the safer pattern.

---

## Permission patterns by action type

This skill works inside Claude's default action-type rules (prohibited / explicit permission / regular). Specific patterns for PE engagements:

### Regular actions (no extra permission)

- Reading public data via Grafana MCP, GitHub MCP (within declared access)
- Running `tool_search` to discover capabilities
- Reading files from filesystem
- Querying APIs that are read-only by design (Prometheus, Loki, Tempo)
- Running scripts in `scripts/` that produce read-only output (validators, analyzers)

### Explicit permission required

- **Creating tickets** (Linear / Jira / GitHub Issues) — show draft first, confirm batch
- **Posting to chat** (Slack / Teams) — show message first, confirm post
- **Running load tests in cloud** (k6 Cloud) — confirms cost + production-vs-staging target
- **Creating PRs** (GitHub MCP) — show diff summary first, confirm push
- **Modifying alert rules** in Grafana / Prometheus — explicit per-rule confirmation
- **Modifying dashboards** — show JSON diff, confirm

### Prohibited (never, even with permission)

- Modifying production data (database writes, cache flushes, file mutations on prod)
- Auto-merging PRs
- Auto-posting public statements (status pages, public Slack, customer-facing)
- Posting credentials, API keys, or secrets to any tool
- Bypassing PCI / HIPAA / regulatory scope declared in context document

---

## Extension recipe: adding a new MCP integration

When a new MCP server becomes available and you want the skill to use it:

1. **Document in this file** — add a section above with: name, what it enables, usage pattern, safety rules
2. **Update context document template** if the MCP becomes commonly used — add a line to the "Available diagnostic tools" section
3. **Update relevant reference files** to mention the MCP option for specific tasks (e.g., if a Cassandra MCP appears, update `db-perf` profile to mention it)
4. **Add anti-patterns** if you observe misuse during real engagements (e.g., "don't query the entire cluster — limit by service first")

The skill's strength is the conversation/methodology layer. MCP integrations make it more capable but should never replace the reasoning that the skill provides.

---

## Extension recipe: adding a custom script

When you want to add a deterministic helper:

1. Write the script in `scripts/<verb>_<noun>.py` (e.g., `analyze_gc_log.py`)
2. Make it stdlib-first; document any external deps in a comment at the top and add `requirements.txt` if non-trivial
3. JSON output to stdout, human-readable to stderr, exit code 0 = success
4. Add a row to `scripts/README.md` describing the script
5. Reference the script from the relevant reference file with usage example
6. Update `CHANGELOG.md`

---

## Honest scope: what this reference does not solve

- **Not a full MCP catalog** — the MCP ecosystem evolves rapidly; only listing the most common PE-relevant ones
- **Not authoritative on safety** — defer to Claude's core action-type rules; this reference adds PE-specific patterns on top
- **Not a vendor pitch** — Grafana, Linear, Datadog etc. are mentioned because they're common in real PE engagements, not as endorsements
- **No replacement for direct user access** — the skill works best when the user has direct access to the tools too; MCP automates routine queries, not informed judgment
