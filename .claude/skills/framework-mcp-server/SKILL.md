---
name: framework-mcp-server
description: Build, register and use this framework's MCP server (mcp-server package) — tools list_scenarios, read_config, run_test, get_metrics, get_test_history, validate_schema, validate_generated_code, generate_scaffold, query_knowledge_base, get_observability_data, create_jira_ticket — and the safety rules for each. Use when asked to "set up the k6 MCP server in Claude Code", "which MCP tool runs a test", "query Prometheus through the MCP server", or "the MCP run_test tool fails". Not for the Playwright MCP server (playwright-automation).
---

# Framework MCP server

`<repo>` means the repository root. Source: `<repo>/mcp-server` (TypeScript, own
package). Docs: `<repo>/docs-site/docs/framework/ai/mcp-server.md` and the setup page
next to it.

## Build and register

```bash
cd <repo>/mcp-server && pnpm install && pnpm build
claude mcp add k6-framework -- node <repo>/mcp-server/dist/index.js
```

Register at project scope only with the human's agreement; the MCP server can start
test runs.

## Tools and rules

| Tool | Does | Rule |
|------|------|------|
| `list_scenarios`, `read_config`, `get_metrics`, `get_test_history` | Read-only lookups | Safe. Config may reference secret names; never echo secret values. |
| `validate_schema` | JSON schema validation of a config | Safe. |
| `validate_generated_code` | Static checks on generated k6 code | Complements, does not replace, the generation gate (guardrails-gate). |
| `run_test` | Runs the monorepo runner for client/test/profile/env | Same rules as run-operations: smoke first; heavier profiles only after human confirmation. |
| `generate_scaffold` | Creates client/test/service/factory files | Review the diff; then the generation gate. |
| `query_knowledge_base` | Vector search (ChromaDB) over indexed docs/scripts, tenant-isolated by client id | Results are hints, not facts. |
| `get_observability_data` | PromQL / LogQL / TraceQL / Pyroscope queries | Read-only; filter by run `testid`. |
| `create_jira_ticket` | Opens a ticket | Only when the human asks; no raw logs, HARs or PII in the body. |

## Troubleshooting

- Tool missing in Claude Code: rebuild, then restart the session; check `claude mcp list`.
- `run_test` exit codes are the runner's (0 / 1 / 99 / 107 / 108).
