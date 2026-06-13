---
title: "MCP Server — US22"
sidebar_position: 2
---
# MCP Server — US22

Expose the k6 Enterprise Framework to Claude Desktop and other MCP-compatible clients via the Model Context Protocol.

**Tasks:** T-065, T-066, T-067, T-068  
**Directory:** `k6-framework/mcp-server/`

---

## What is MCP?

The [Model Context Protocol](https://modelcontextprotocol.io/) lets AI assistants interact with external tools and data sources through a standardized interface. The k6 Framework MCP server exposes:

- **Resources** — read-only data (configs, scenario lists, past metrics)
- **Tools** — actions (run tests, validate schemas, scaffold new artifacts)

---

## Setup

### Build

```bash
cd k6-framework/mcp-server
npm install
npm run build
# Output: dist/index.js
```

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

Restart Claude Desktop. The server starts automatically when Claude needs it.

### Other MCP clients

Any client that supports the MCP stdio transport can connect:

```bash
# Start manually (for testing or custom clients)
node k6-framework/mcp-server/dist/index.js
```

The server communicates via stdin/stdout in the MCP JSON-RPC protocol.

---

## Resources

Resources are read-only data sources identified by URI.

### read_config — `k6://config/{client}/{env}`

Read a client's configuration for a given environment.

```
k6://config/clienteA/default
k6://config/clienteA/staging
```

Returns the parsed JSON config from `clients/{client}/config/{env}.json`.

**Example interaction:**
```
User: Show me the clienteA production config.
→ reads k6://config/clienteA/production
→ returns JSON with services, thresholds, SLO definitions
```

### list_scenarios — `k6://scenarios/{client}`

List all test scenarios available for a client.

```
k6://scenarios/clienteA
```

Returns an array of scenario paths relative to `clients/{client}/scenarios/`.

### get_metrics — `k6://metrics/{test_id}`

Retrieve execution metrics for a past test run.

```
k6://metrics/clienteA/api/smoke-users/2026-02-17_143000
```

`test_id` format: `{client}/{scenario}/{timestamp}` — matches the report directory structure.

Returns metrics from `reports/{client}/{scenario}/{timestamp}/k6-summary.json`.

---

## Tools

Tools are actions that modify state or execute processes.

### run_test

Execute a k6 load test for a client.

```json
{
  "client": "clienteA",
  "test": "api/smoke-users",
  "profile": "smoke",
  "env": "default"
}
```

**Parameters:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `client` | string | yes | — | Client name |
| `test` | string | yes | — | Scenario path (e.g. `api/smoke-users`) |
| `profile` | string | no | `smoke` | Load profile: smoke, quick, load, stress |
| `env` | string | no | `default` | Config environment name |

**Returns:**

```json
{
  "status": "pass",
  "exitCode": 0,
  "output": "✓ checks.........................: 100.00%\n...",
  "reportPath": "reports/clienteA/api/smoke-users/2026-02-17_143000"
}
```

**Concurrency guard:** If the same `client+test` combination is already running, the tool  
returns error `ALREADY_RUNNING` immediately (EC-AI-001).

**Example interaction:**
```
User: Run a smoke test for clienteA's smoke-users scenario.
→ calls run_test({ client: "clienteA", test: "api/smoke-users", profile: "smoke" })
→ returns pass/fail status + truncated output (≤8000 chars)
```

### validate_schema

Validate a configuration file against the framework's JSON schemas.

```json
{
  "file": "clients/clienteA/config/default.json"
}
```

The tool tries all schemas in `shared/schemas/` and returns the best match.

**Returns:**

```json
{
  "valid": true,
  "errors": []
}
```

On failure:

```json
{
  "valid": false,
  "errors": [
    { "path": "/services/0/baseUrl", "message": "must be a string" }
  ]
}
```

### generate_scaffold

Generate a new framework artifact.

```json
{
  "name": "OrderService",
  "type": "service",
  "client": "clienteA"
}
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Name for the artifact |
| `type` | enum | yes | `client` \| `test` \| `service` \| `factory` |
| `client` | string | for non-client types | Target client |

**Returns:**

```json
{
  "created": [
    "clients/clienteA/lib/services/OrderService.ts"
  ]
}
```

---

## Example Claude interactions

### Running a test

```
User: Run a load test for clienteA with the load profile.
Claude: I'll run the load test for clienteA.
[calls run_test({ client: "clienteA", test: "api/smoke-users", profile: "load" })]
The load test completed with status: pass. All 47 checks passed (100%).
Report saved to: reports/clienteA/api/smoke-users/2026-02-17_150000
```

### Checking config

```
User: What services does clienteA test?
Claude: Let me check the clienteA configuration.
[reads k6://config/clienteA/default]
clienteA tests 2 services:
- users-api (https://api.example.com, SLO: p95 < 500ms)
- orders-api (https://orders.example.com, SLO: p95 < 800ms)
```

### Scaffolding

```
User: Create a new client called "payment-service".
Claude: I'll scaffold a new client for payment-service.
[calls generate_scaffold({ name: "payment-service", type: "client" })]
Created:
- clients/payment-service/config/default.json
- clients/payment-service/scenarios/api/smoke-baseline.ts
- clients/payment-service/lib/services/payment-service-service.ts
- clients/payment-service/README.md
```

---

## Security

### Path traversal prevention

All file paths are validated to be within `FRAMEWORK_ROOT` before any file operation:

```typescript
const absFile = resolve(FRAMEWORK_ROOT, file);
if (!absFile.startsWith(FRAMEWORK_ROOT)) {
  throw mcpError("INVALID_PARAMS", "File path must be within the framework directory.");
}
```

### Shell injection prevention

All arguments passed to shell commands are sanitized via `sanitizeArg()`,  
which rejects characters: `; & | $ ( ) { } [ ] < > \` ' " \n \r \0`

This covers the OWASP command injection pattern (CHK-SEC-110).

### Structured errors

All tool errors return a structured object with `code`, `message`, and optional `details`:

```json
{
  "code": "CLIENT_NOT_FOUND",
  "message": "Client 'unknown-client' does not exist.",
  "details": { "clientsDir": "clients/" }
}
```

---

## Architecture

```
mcp-server/
├── src/
│   ├── index.ts              ← MCP Server + stdio transport
│   ├── resources/
│   │   └── index.ts          ← readConfig, listScenarios, getMetrics
│   ├── tools/
│   │   └── index.ts          ← runTest, validateSchema, generateScaffold
│   └── utils/
│       └── framework.ts      ← path helpers, sanitization, runCliCommand
├── dist/                     ← compiled output (npm run build)
├── package.json
├── tsconfig.json
└── README.md
```

### Runtime dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@modelcontextprotocol/sdk` | ^1.x | MCP protocol implementation |
| `ajv` | resolved from parent | JSON schema validation |
| `ajv-formats` | resolved from parent | Format validators (email, uri, etc.) |

The MCP server resolves `ajv` and `ajv-formats` from the parent `k6-framework/node_modules`  
via relative path — no separate install required.

---

## Development

### Watch mode

```bash
cd k6-framework/mcp-server
npx tsc --watch
```

### Testing the server manually

Use the MCP Inspector or any stdio-based MCP client:

```bash
# Install MCP inspector globally
npm install -g @modelcontextprotocol/inspector

# Inspect the server
npx @modelcontextprotocol/inspector node dist/index.js
```

### Adding a new tool

1. Add the handler function to `src/tools/index.ts` with a typed params interface
2. Register in `src/index.ts`:
   - Add to `ListToolsRequestSchema` handler (inputSchema)
   - Add a `case` to the `CallToolRequestSchema` switch

### Adding a new resource

1. Add the reader function to `src/resources/index.ts`
2. Register in `src/index.ts`:
   - Add to `ListResourcesRequestSchema` handler (URI template)
   - Add a branch to the `ReadResourceRequestSchema` handler
