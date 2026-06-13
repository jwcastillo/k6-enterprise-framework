---
title: "k6 Enterprise Framework — MCP Server"
sidebar_position: 3
---
# k6 Enterprise Framework — MCP Server

Exposes framework capabilities to any MCP-compatible client (Claude Desktop, IDEs, custom agents).

---

## Resources

| Resource URI | Description |
|---|---|
| `k6://config/{client}/{env}` | Read client configuration JSON |
| `k6://scenarios/{client}` | List available test scenarios |
| `k6://metrics/{client}/{service}/{timestamp}` | Get execution metrics from past run |

## Tools

| Tool | Description |
|---|---|
| `run_test` | Execute a k6 test via run-test.sh |
| `validate_schema` | Validate a config file against JSON schemas |
| `generate_scaffold` | Scaffold a new client, test, service, or factory |

---

## Installation

```bash
cd mcp-server
npm install
npm run build
```

---

## Configuration for Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "k6-framework": {
      "command": "node",
      "args": ["/absolute/path/to/k6-framework/mcp-server/dist/index.js"]
    }
  }
}
```

On Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Restart Claude Desktop after editing.

---

## Configuration for other MCP clients

Any client supporting stdio transport can connect:

```json
{
  "command": "node",
  "args": ["/path/to/k6-framework/mcp-server/dist/index.js"],
  "transport": "stdio"
}
```

---

## Example interactions (Claude Desktop)

```
You: List the scenarios for the examples client.
→ Calls: list_scenarios({ client: "examples" })

You: Run the smoke test for client acme, scenario api/smoke-users.
→ Calls: run_test({ client: "acme", test: "api/smoke-users", profile: "smoke" })

You: Is the config for client acme valid?
→ Calls: validate_schema({ file: "clients/acme/config/default.json" })

You: Create a new client called beta-team.
→ Calls: generate_scaffold({ name: "beta-team", type: "client" })
```

---

## Security

- All `client` and `test` parameters are sanitized to prevent shell injection
- File access is restricted to within the framework root directory
- Concurrent execution of the same `client:test` pair is blocked with `ALREADY_RUNNING` error
- The server does not expose filesystem paths outside the framework root

---

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `NOT_FOUND: Client 'x' not found` | Client directory doesn't exist | Run `bin/create-client.sh x` |
| `ALREADY_RUNNING` | Same test already executing | Wait for completion or kill the running process |
| `INVALID_PARAMS: unsafe characters` | Shell injection attempt | Use only alphanumeric names |
| Server doesn't start | Wrong `dist/index.js` path | Run `npm run build` in `mcp-server/` |
