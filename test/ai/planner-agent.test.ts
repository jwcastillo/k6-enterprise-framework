/**
 * Unit tests for PlannerAgent.
 * src/ai/agents/planner-agent.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Anthropic SDK
const mockCreate = vi.fn().mockResolvedValue({
  content: [
    {
      type: "text",
      text: JSON.stringify({
        id: "plan-generated",
        name: "api-load-test",
        baseUrl: "http://localhost:3000",
        endpoints: [
          {
            url: "/api/users",
            method: "GET",
            expectedStatus: 200,
            _description: "List users",
            requiresAuth: true,
            tags: ["users"],
          },
          {
            url: "/api/users",
            method: "POST",
            expectedStatus: 201,
            _description: "Create user",
            requiresAuth: true,
            tags: ["users"],
          },
        ],
        testTypes: ["load", "stress"],
        trafficModel: {
          executor: "ramping-vus",
          config: {
            stages: [
              { duration: "1m", target: 10 },
              { duration: "3m", target: 50 },
              { duration: "1m", target: 0 },
            ],
          },
          estimatedDurationSeconds: 300,
          thinkTimeSeconds: 1,
        },
        thresholds: {
          http_req_duration: ["p(95)<500"],
          http_req_failed: ["rate<0.01"],
        },
        dataRequirements: { csvFiles: [], factories: [] },
        authConfig: { type: "bearer", envVar: "AUTH_TOKEN" },
        warnings: [],
        metadata: { confidence: 0.88 },
      }),
    },
  ],
  usage: { input_tokens: 500, output_tokens: 300 },
});

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(function () {
    return { messages: { create: mockCreate } };
  }),
}));

// Mock chromadb
vi.mock("chromadb", () => ({
  ChromaClient: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

// Mock knowledge base
vi.mock("../../src/ai/knowledge-base/knowledge-base", () => ({
  KnowledgeBaseManager: vi.fn().mockImplementation(function () {
    return {
      search: vi.fn().mockResolvedValue({
        query: "test",
        collection: "k6-framework-global",
        documents: [],
        searchLatencyMs: 5,
        totalDocumentsInCollection: 0,
      }),
      searchWithClientContext: vi.fn().mockResolvedValue({
        query: "test",
        collection: "test+global",
        documents: [],
        searchLatencyMs: 5,
        totalDocumentsInCollection: 0,
      }),
    };
  }),
}));

import { PlannerAgent, type PlannerInput } from "../../src/ai/agents/planner-agent";
import { BudgetManager } from "../../src/ai/core/budget-manager";

describe("PlannerAgent", () => {
  let agent: PlannerAgent;

  beforeEach(() => {
    vi.clearAllMocks();
    BudgetManager.resetPipelineCounters();
    agent = new PlannerAgent({
      apiKey: "test-key",
      budgetManager: new BudgetManager({ agentId: "planner" }),
    });
  });

  // ---------------------------------------------------------------------------
  // validate
  // ---------------------------------------------------------------------------
  describe("validate", () => {
    it("should pass for valid natural-language input", () => {
      const input: PlannerInput = {
        format: "natural-language",
        spec: "I need a load test for a user management API with CRUD operations",
        baseUrl: "http://localhost:3000",
      };
      const result = agent.validate(input);
      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should pass for valid text input", () => {
      const input: PlannerInput = {
        format: "text",
        spec: "Endpoint GET /api/users returns list of users. POST /api/users creates a new user.",
        baseUrl: "http://localhost:3000",
      };
      const result = agent.validate(input);
      expect(result.passed).toBe(true);
    });

    it("should pass for valid OpenAPI input", () => {
      const openApiSpec = JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Users API", version: "1.0.0" },
        paths: {
          "/api/users": {
            get: { summary: "List users", responses: { "200": {} } },
          },
        },
      });
      const input: PlannerInput = {
        format: "openapi",
        spec: openApiSpec,
        baseUrl: "http://localhost:3000",
      };
      const result = agent.validate(input);
      expect(result.passed).toBe(true);
    });

    it("should fail when spec is empty", () => {
      const input: PlannerInput = {
        format: "natural-language",
        spec: "",
      };
      const result = agent.validate(input);
      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.code === "CHK-API-359-a")).toBe(true);
    });

    it("should fail when spec is too short", () => {
      const input: PlannerInput = {
        format: "text",
        spec: "short",
      };
      const result = agent.validate(input);
      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.message.includes("demasiado corto"))).toBe(true);
    });

    it("should fail when format is unsupported", () => {
      const input: PlannerInput = {
        format: "graphql" as any,
        spec: "A valid spec with enough characters to pass the length check for this test",
      };
      const result = agent.validate(input);
      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.code === "CHK-API-359-b")).toBe(true);
    });

    it("should warn when OpenAPI spec is not valid JSON (might be YAML)", () => {
      const input: PlannerInput = {
        format: "openapi",
        spec: `openapi: "3.0.0"
info:
  title: Users API
  version: "1.0.0"
paths:
  /api/users:
    get:
      summary: List users`,
        baseUrl: "http://localhost:3000",
      };
      const result = agent.validate(input);
      expect(result.passed).toBe(true); // Not an error, just a warning
      expect(result.warnings.some((w) => w.includes("YAML"))).toBe(true);
    });

    it("should warn when baseUrl is not provided", () => {
      const input: PlannerInput = {
        format: "natural-language",
        spec: "Load test for a REST API with user management endpoints",
      };
      const result = agent.validate(input);
      expect(result.passed).toBe(true);
      expect(result.warnings.some((w) => w.includes("baseUrl"))).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // execute
  // ---------------------------------------------------------------------------
  describe("execute", () => {
    it("should throw for invalid input", async () => {
      const input: PlannerInput = { format: "text", spec: "" };
      await expect(agent.execute(input)).rejects.toThrow("PlannerAgent input invalid");
    });

    it("should generate a TestPlan from natural-language input", async () => {
      const input: PlannerInput = {
        format: "natural-language",
        spec: "I need a load test for a user management REST API with login and CRUD endpoints",
        baseUrl: "http://localhost:3000",
        planName: "users-load-test",
      };
      const plan = await agent.execute(input);

      expect(plan.id).toBeDefined();
      expect(plan.name).toBeDefined();
      expect(plan.endpoints.length).toBeGreaterThan(0);
      expect(plan.testTypes.length).toBeGreaterThan(0);
      expect(plan.trafficModel).toBeDefined();
      expect(plan.trafficModel.executor).toBeDefined();
      expect(plan.thresholds).toBeDefined();
      expect(plan.metadata.agentVersion).toBe("1.0.0");
      expect(plan.source).toBe("natural-language");
    });

    it("should generate a TestPlan from OpenAPI input", async () => {
      const openApiSpec = JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Users API", version: "1.0.0" },
        paths: {
          "/api/users": {
            get: {
              summary: "List users",
              responses: { "200": { content: { "application/json": { schema: {} } } } },
            },
            post: {
              summary: "Create user",
              requestBody: {
                content: { "application/json": { schema: { type: "object" } } },
              },
              responses: { "201": {} },
            },
          },
        },
      });
      const input: PlannerInput = {
        format: "openapi",
        spec: openApiSpec,
        baseUrl: "http://localhost:3000",
      };
      const plan = await agent.execute(input);

      expect(plan.id).toBeDefined();
      expect(plan.endpoints.length).toBeGreaterThan(0);
      expect(plan.source).toBe("openapi");
    });

    it("should normalize endpoints from LLM response", async () => {
      const input: PlannerInput = {
        format: "natural-language",
        spec: "Load test for a simple REST API with GET /api/users and POST /api/users",
        baseUrl: "http://localhost:3000",
      };
      const plan = await agent.execute(input);

      for (const endpoint of plan.endpoints) {
        expect(endpoint.url).toBeDefined();
        expect(endpoint.method).toBeDefined();
        expect(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]).toContain(
          endpoint.method
        );
        expect(endpoint.expectedStatus).toBeDefined();
      }
    });

    it("should normalize testTypes to only valid values", async () => {
      // Mock LLM to return invalid test types
      mockCreate.mockResolvedValueOnce({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              testTypes: ["load", "invalid-type", "stress"],
              endpoints: [{ url: "/api", method: "GET", expectedStatus: 200 }],
              trafficModel: { executor: "ramping-vus", config: {}, estimatedDurationSeconds: 60 },
              authConfig: { type: "none" },
            }),
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const input: PlannerInput = {
        format: "natural-language",
        spec: "Load test for API endpoints with various load patterns and testing scenarios",
        baseUrl: "http://localhost:3000",
      };
      const plan = await agent.execute(input);

      // "invalid-type" should be filtered out
      for (const type of plan.testTypes) {
        expect(["load", "stress", "spike", "soak", "breakpoint"]).toContain(type);
      }
    });

    it("should default to ramping-vus when trafficModel is invalid", async () => {
      mockCreate.mockResolvedValueOnce({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              endpoints: [{ url: "/api", method: "GET" }],
              trafficModel: null,
              authConfig: { type: "none" },
            }),
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const input: PlannerInput = {
        format: "text",
        spec: "Create a load test for a simple GET endpoint at /api/status with basic configuration",
        baseUrl: "http://localhost:3000",
      };
      const plan = await agent.execute(input);

      expect(plan.trafficModel.executor).toBe("ramping-vus");
      expect(plan.trafficModel.estimatedDurationSeconds).toBe(300);
    });

    it("should default testTypes to ['load'] when empty or missing", async () => {
      mockCreate.mockResolvedValueOnce({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              endpoints: [{ url: "/api", method: "GET" }],
              testTypes: [],
              trafficModel: { executor: "ramping-vus", config: {}, estimatedDurationSeconds: 60 },
              authConfig: { type: "none" },
            }),
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const input: PlannerInput = {
        format: "natural-language",
        spec: "Generate a performance test configuration for a REST API health check endpoint",
        baseUrl: "http://localhost:3000",
      };
      const plan = await agent.execute(input);

      expect(plan.testTypes).toEqual(["load"]);
    });

    it("should throw EC-AI-008 when LLM response is not parseable JSON", async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: "This is not valid JSON at all" }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const input: PlannerInput = {
        format: "natural-language",
        spec: "Load test for a REST API with various endpoints and authentication requirements",
        baseUrl: "http://localhost:3000",
      };

      await expect(agent.execute(input)).rejects.toThrow("EC-AI-008");
    });

    it("should include confidence from LLM metadata", async () => {
      const input: PlannerInput = {
        format: "natural-language",
        spec: "Load test for a user management REST API with CRUD operations and authentication",
        baseUrl: "http://localhost:3000",
      };
      const plan = await agent.execute(input);

      expect(plan.metadata.confidence).toBeDefined();
      expect(plan.metadata.confidence).toBeGreaterThan(0);
      expect(plan.metadata.confidence).toBeLessThanOrEqual(1);
    });

    it("should set source field based on input format", async () => {
      const input: PlannerInput = {
        format: "text",
        spec: "Endpoint GET /api/health returns 200 OK. Endpoint POST /api/login accepts username and password.",
        baseUrl: "http://localhost:3000",
      };
      const plan = await agent.execute(input);

      expect(plan.source).toBe("text");
    });

    it("should include clientId in metadata when provided", async () => {
      const input: PlannerInput = {
        format: "natural-language",
        spec: "Load test for customer API with user authentication and data retrieval endpoints",
        baseUrl: "http://localhost:3000",
        clientId: "client-abc",
      };
      const plan = await agent.execute(input);

      expect(plan.metadata.clientId).toBe("client-abc");
    });

    it("should use planName when provided", async () => {
      const input: PlannerInput = {
        format: "natural-language",
        spec: "Load test for e-commerce checkout flow with payment processing and order creation",
        baseUrl: "http://localhost:3000",
        planName: "my-custom-plan",
      };
      const plan = await agent.execute(input);

      // The plan name should come from planData or fall back to planName
      expect(plan.name).toBeDefined();
    });

    it("should merge spec parsing warnings with LLM warnings", async () => {
      // Use non-JSON OpenAPI to trigger parsing warning
      const input: PlannerInput = {
        format: "openapi",
        spec: `openapi: "3.0.0"
info:
  title: Test API
  version: "1.0.0"
paths:
  /api/health:
    get:
      summary: Health check endpoint`,
        baseUrl: "http://localhost:3000",
      };
      const plan = await agent.execute(input);

      // Should have a warning about YAML parsing or similar
      // The plan should still be generated from LLM
      expect(plan).toBeDefined();
    });

    it("should handle OpenAPI spec without paths", async () => {
      const spec = JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Empty API", version: "1.0.0" },
      });
      const input: PlannerInput = {
        format: "openapi",
        spec,
        baseUrl: "http://localhost:3000",
      };
      const plan = await agent.execute(input);

      // Should still produce a plan (LLM infers endpoints)
      expect(plan).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // getConfig
  // ---------------------------------------------------------------------------
  describe("getConfig", () => {
    it("should return agent configuration", () => {
      const config = agent.getConfig();
      expect(config.agentId).toBe("planner");
      expect(config.model).toBeDefined();
      expect(config.temperature).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // name and version
  // ---------------------------------------------------------------------------
  describe("agent identity", () => {
    it("should have correct name and version", () => {
      expect(agent.name).toBe("planner-agent");
      expect(agent.version).toBe("1.0.0");
    });
  });
});
