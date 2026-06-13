/**
 * T-065: k6 Enterprise Framework — MCP Server
 *
 * Exposes framework capabilities to any MCP-compatible client (Claude Desktop, IDEs, etc.)
 * via stdio transport.
 *
 * Resources:
 *   read_config(client, env?)     — read client configuration
 *   list_scenarios(client)        — list available test scenarios
 *   get_metrics(test_id)          — get past execution metrics
 *
 * Tools:
 *   run_test(client, test, ...)   — execute a k6 test
 *   validate_schema(file)         — validate config against JSON schema
 *   generate_scaffold(name, type) — scaffold a new client/test/service
 *
 * Setup (Claude Desktop):
 *   Add to ~/Library/Application Support/Claude/claude_desktop_config.json:
 *   {
 *     "mcpServers": {
 *       "k6-framework": {
 *         "command": "node",
 *         "args": ["/path/to/k6-framework/mcp-server/dist/index.js"]
 *       }
 *     }
 *   }
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { readConfig, listScenarios, getMetrics } from "./resources/index.js";
import { runTest, validateSchema, generateScaffold } from "./tools/index.js";
import {
  queryKnowledgeBase,
  getObservabilityData,
  validateGeneratedCode,
  getTestHistory,
  createJiraTicket,
} from "./tools/ai-tools.js";

// ── Server setup ──────────────────────────────────────────────────────────────

const server = new Server(
  { name: "k6-enterprise-framework", version: "1.0.0" },
  { capabilities: { resources: {}, tools: {} } }
);

// ── Resources ─────────────────────────────────────────────────────────────────

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: "k6://config/{client}/{env}",
      name: "read_config",
      description: "Read client configuration for a given environment",
      mimeType: "application/json",
    },
    {
      uri: "k6://scenarios/{client}",
      name: "list_scenarios",
      description: "List available test scenarios for a client",
      mimeType: "application/json",
    },
    {
      uri: "k6://metrics/{test_id}",
      name: "get_metrics",
      description: "Get execution metrics for a past test run (test_id: client/service/timestamp)",
      mimeType: "application/json",
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  try {
    if (uri.startsWith("k6://config/")) {
      const parts = uri.replace("k6://config/", "").split("/");
      const client = parts[0];
      const env = parts[1] ?? "default";
      const data = readConfig({ client, env });
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
      };
    }

    if (uri.startsWith("k6://scenarios/")) {
      const client = uri.replace("k6://scenarios/", "");
      const data = listScenarios({ client });
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
      };
    }

    if (uri.startsWith("k6://metrics/")) {
      const test_id = uri.replace("k6://metrics/", "");
      const data = getMetrics({ test_id });
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
      };
    }

    throw new Error(`Unknown resource URI: ${uri}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { contents: [{ uri, mimeType: "application/json", text: msg }] };
  }
});

// ── Tools ─────────────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "run_test",
      description: "Execute a k6 load test for a client",
      inputSchema: {
        type: "object",
        properties: {
          client: { type: "string", description: "Client name" },
          test: { type: "string", description: "Scenario path (e.g. api/smoke-users)" },
          profile: {
            type: "string",
            description: "Load profile: smoke, quick, load, stress (default: smoke)",
          },
          env: { type: "string", description: "Environment config name (default: default)" },
        },
        required: ["client", "test"],
      },
    },
    {
      name: "validate_schema",
      description: "Validate a configuration file against the framework JSON schemas",
      inputSchema: {
        type: "object",
        properties: {
          file: {
            type: "string",
            description: "Path to JSON config file (relative to framework root)",
          },
        },
        required: ["file"],
      },
    },
    {
      name: "generate_scaffold",
      description:
        "Generate a new framework artifact (client, test scenario, service, or data factory)",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Name for the new artifact" },
          type: {
            type: "string",
            enum: ["client", "test", "service", "factory"],
            description: "Artifact type",
          },
          client: {
            type: "string",
            description: "Client name (required for test/service/factory)",
          },
        },
        required: ["name", "type"],
      },
    },
    // ── T-109: AI Agent tools ─────────────────────────────────────────────
    {
      name: "query_knowledge_base",
      description:
        "Search the semantic knowledge base (RAG) for relevant k6 scripts, helpers, and documentation. Used by AI agents for few-shot context retrieval. CHK-API-374",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural language search query (min 3 chars)" },
          collection: { type: "string", description: "ChromaDB collection name (default: global)" },
          top_k: { type: "number", description: "Max documents to return (default: 5)" },
          type: {
            type: "string",
            enum: ["script", "doc", "helper", "pattern"],
            description: "Filter by document type",
          },
          client_id: {
            type: "string",
            description: "Client ID for tenant-isolated search (CHK-SEC-115)",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "get_observability_data",
      description:
        "Query observability backends (Prometheus, Tempo, Loki, Pyroscope) for metrics, traces, logs, and profiling data. Returns partial result if service unavailable (EC-AI-005). CHK-API-380",
      inputSchema: {
        type: "object",
        properties: {
          source: {
            type: "string",
            enum: ["prometheus", "tempo", "loki", "pyroscope"],
            description: "Observability backend to query",
          },
          query: {
            type: "string",
            description: "Native query (PromQL, LogQL, TraceQL, or service name for Pyroscope)",
          },
          from: { type: "string", description: "Start time (ISO 8601 or relative like -5m)" },
          to: { type: "string", description: "End time (ISO 8601 or 'now', default: 'now')" },
          step: { type: "string", description: "Step for time series (e.g. '15s', '1m')" },
          limit: { type: "number", description: "Max results (default: 100)" },
        },
        required: ["source", "query", "from"],
      },
    },
    {
      name: "validate_generated_code",
      description:
        "Validate AI-generated k6 TypeScript code against framework contracts: no secrets, correct imports, compilable TypeScript. CHK-API-364",
      inputSchema: {
        type: "object",
        properties: {
          code: { type: "string", description: "TypeScript k6 script code to validate" },
          filename: {
            type: "string",
            description:
              "Filename for TypeScript compilation context (default: generated-script.ts)",
          },
        },
        required: ["code"],
      },
    },
    {
      name: "get_test_history",
      description:
        "Retrieve past test execution history for a client/test with summarized metrics. Used by Analyst Agent for regression detection. CHK-API-350",
      inputSchema: {
        type: "object",
        properties: {
          client: { type: "string", description: "Client name" },
          test: {
            type: "string",
            description: "Test name (optional, returns all tests if omitted)",
          },
          limit: { type: "number", description: "Max history entries (default: 20)" },
        },
        required: ["client"],
      },
    },
    {
      name: "create_jira_ticket",
      description:
        "Create a Jira bug ticket for a detected performance issue. Credentials from env vars only (CHK-SEC-117). Persists locally if Jira unavailable (EC-AI-009). CHK-API-372",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string", description: "Jira project key (e.g. PERF)" },
          summary: { type: "string", description: "Ticket summary (max 255 chars)" },
          description: {
            type: "string",
            description: "Detailed description of the performance issue",
          },
          priority: {
            type: "string",
            enum: ["Highest", "High", "Medium", "Low", "Lowest"],
            description: "Issue priority (default: High)",
          },
          labels: {
            type: "array",
            items: { type: "string" },
            description: "Additional labels (performance is always added)",
          },
        },
        required: ["project", "summary", "description"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: unknown;

    switch (name) {
      case "run_test":
        result = await runTest(args as unknown as Parameters<typeof runTest>[0]);
        break;
      case "validate_schema":
        result = await validateSchema(args as unknown as Parameters<typeof validateSchema>[0]);
        break;
      case "generate_scaffold":
        result = generateScaffold(args as unknown as Parameters<typeof generateScaffold>[0]);
        break;
      // ── T-109: AI Agent tools ───────────────────────────────────────────
      case "query_knowledge_base":
        result = await queryKnowledgeBase(args as Parameters<typeof queryKnowledgeBase>[0]);
        break;
      case "get_observability_data":
        result = await getObservabilityData(args as Parameters<typeof getObservabilityData>[0]);
        break;
      case "validate_generated_code":
        result = await validateGeneratedCode(args as Parameters<typeof validateGeneratedCode>[0]);
        break;
      case "get_test_history":
        result = getTestHistory(args as Parameters<typeof getTestHistory>[0]);
        break;
      case "create_jira_ticket":
        result = await createJiraTicket(args as Parameters<typeof createJiraTicket>[0]);
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: msg }],
      isError: true,
    };
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("k6 Enterprise Framework MCP server running on stdio");
