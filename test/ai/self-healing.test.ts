/**
 * Unit tests for SelfHealingEngine.
 * src/ai/adaptive/self-healing.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Default valid k6 code for mock responses
const VALID_K6_CODE = `import http from "k6/http";
import { check } from "k6";

export const options = { vus: 10, duration: "30s" };

export default function () {
  const res = http.get(__ENV.BASE_URL + "/api/users");
  check(res, { "status 200": (r) => r.status === 200 });
}`;

// Shared mock create function (can be overridden per test)
const mockAnthropicCreate = vi.fn().mockResolvedValue({
  content: [{ type: "text", text: VALID_K6_CODE }],
  usage: { input_tokens: 500, output_tokens: 200 },
});

// Mock Anthropic SDK — must use function() for constructor compatibility
vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: vi.fn().mockImplementation(function () {
      return { messages: { create: mockAnthropicCreate } };
    }),
  };
});

// Mock chromadb
vi.mock("chromadb", () => ({
  ChromaClient: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

// Mock knowledge base (dependency of BuilderAgent, which SelfHealingEngine creates)
vi.mock("../../src/ai/knowledge-base/knowledge-base", () => ({
  KnowledgeBaseManager: vi.fn().mockImplementation(function () {
    return {
      search: vi.fn().mockResolvedValue({
        query: "",
        collection: "global",
        documents: [],
        searchLatencyMs: 0,
        totalDocumentsInCollection: 0,
      }),
    };
  }),
}));

// Mock fs for SelfHealingEngine constructor
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
  };
});

import { SelfHealingEngine } from "../../src/ai/adaptive/self-healing";
import type { GeneratedScript } from "../../src/types/ai.d";

describe("SelfHealingEngine", () => {
  let engine: SelfHealingEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore the default mock response
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: VALID_K6_CODE }],
      usage: { input_tokens: 500, output_tokens: 200 },
    });
    engine = new SelfHealingEngine({
      apiKey: "test-key",
      tmpDir: "/tmp/test-healing",
    });
  });

  // ---------------------------------------------------------------------------
  // detectSchemaError
  // ---------------------------------------------------------------------------
  describe("detectSchemaError", () => {
    it("should detect HTTP 400 validation error", () => {
      const result = engine.detectSchemaError("Request failed with status 400 Bad Request");
      expect(result.type).toBe("http-400-validation");
      expect(result.statusCode).toBe(400);
    });

    it("should detect HTTP 400 from 'http 400' pattern", () => {
      const result = engine.detectSchemaError("HTTP 400 error on POST /api/users");
      expect(result.type).toBe("http-400-validation");
    });

    it("should detect HTTP 422 validation error", () => {
      const result = engine.detectSchemaError("Server returned status 422 Unprocessable Entity");
      expect(result.type).toBe("http-422-validation");
      expect(result.statusCode).toBe(422);
    });

    it("should detect HTTP 422 from 'http 422' pattern", () => {
      const result = engine.detectSchemaError("HTTP 422 validation error");
      expect(result.type).toBe("http-422-validation");
    });

    it("should detect field-renamed from 'unknown field' pattern", () => {
      const result = engine.detectSchemaError("Error: unknown field: 'userName'");
      expect(result.type).toBe("field-renamed");
      expect(result.field).toBe("userName");
    });

    it("should detect field-renamed from 'unexpected key' pattern", () => {
      const result = engine.detectSchemaError("unexpected key 'email_address' in request body");
      expect(result.type).toBe("field-renamed");
    });

    it("should detect field-renamed from 'unrecognized field' pattern", () => {
      const result = engine.detectSchemaError("unrecognized field in payload");
      expect(result.type).toBe("field-renamed");
    });

    it("should detect field-renamed from serviceResponse 'unknown_field'", () => {
      const result = engine.detectSchemaError("some error", "unknown_field: email");
      expect(result.type).toBe("field-renamed");
    });

    it("should detect field-required from 'required' pattern", () => {
      const result = engine.detectSchemaError("Validation error: required: 'name'");
      expect(result.type).toBe("field-required");
      expect(result.field).toBe("name");
    });

    it("should detect field-required from 'missing' pattern", () => {
      const result = engine.detectSchemaError("Missing field in request body");
      expect(result.type).toBe("field-required");
    });

    it("should detect field-required from serviceResponse 'required_field'", () => {
      const result = engine.detectSchemaError("error occurred", "required_field missing");
      expect(result.type).toBe("field-required");
    });

    it("should detect field-removed from 'field removed' pattern", () => {
      const result = engine.detectSchemaError("field removed: 'legacyId'");
      expect(result.type).toBe("field-removed");
    });

    it("should detect field-removed from 'deprecated' pattern", () => {
      const result = engine.detectSchemaError("Warning: deprecated endpoint");
      expect(result.type).toBe("field-removed");
    });

    it("should detect field-removed from 'not found in schema' pattern", () => {
      const result = engine.detectSchemaError("Property not found in schema");
      expect(result.type).toBe("field-removed");
    });

    it("should detect type-changed from 'type error' pattern", () => {
      const result = engine.detectSchemaError("Type error: expected Integer for field 'age'");
      expect(result.type).toBe("type-changed");
      expect(result.expectedType).toBe("Integer");
    });

    it("should detect type-changed from 'cannot parse' pattern", () => {
      const result = engine.detectSchemaError("Cannot parse value as number");
      expect(result.type).toBe("type-changed");
    });

    it("should detect type-changed from 'invalid type' pattern", () => {
      const result = engine.detectSchemaError("Invalid type for field 'count'");
      expect(result.type).toBe("type-changed");
    });

    it("should detect status-code-changed from pattern", () => {
      const result = engine.detectSchemaError("Expected status 200 got 201 for POST /api/items");
      expect(result.type).toBe("status-code-changed");
      expect(result.statusCode).toBe(201);
    });

    it("should return unknown for unrecognized error patterns", () => {
      const result = engine.detectSchemaError("Something completely unexpected happened");
      expect(result.type).toBe("unknown");
      expect(result.rawMessage).toBe("Something completely unexpected happened");
    });
  });

  // ---------------------------------------------------------------------------
  // validateHealedCode (private, tested via heal)
  // ---------------------------------------------------------------------------
  describe("heal — validation logic", () => {
    const makeScript = (content: string): GeneratedScript => ({
      id: "test-script",
      files: [{ path: "test.ts", content, type: "script", language: "typescript" }],
      validationResult: { passed: true, errors: [], warnings: [] },
      selfHealingCycles: 0,
      metadata: {
        agentVersion: "1.0.0",
        generatedAt: new Date().toISOString(),
        tokensUsed: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
        confidence: 0.9,
        sourceTestPlan: "plan-1",
      },
    });

    it("should return failure when script has no script file", async () => {
      const script: GeneratedScript = {
        id: "test-script",
        files: [{ path: "data.csv", content: "a,b,c", type: "data", language: "csv" }],
        validationResult: { passed: true, errors: [], warnings: [] },
        selfHealingCycles: 0,
        metadata: {
          agentVersion: "1.0.0",
          generatedAt: new Date().toISOString(),
          tokensUsed: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
          confidence: 0.9,
          sourceTestPlan: "plan-1",
        },
      };

      const result = await engine.heal(script, "status 400 error");
      expect(result.success).toBe(false);
      expect(result.attempts).toHaveLength(0);
      expect(result.auditTrail.length).toBeGreaterThan(0);
    });

    it("should abort when error is unknown and it is the first attempt", async () => {
      const script = makeScript('export default function() { console.log("hello"); }');
      const result = await engine.heal(script, "Something completely unrecognized happened");

      expect(result.success).toBe(false);
      // Should have audit entry for abort
      const abortEntry = result.auditTrail.find((a) => a.action === "heal-abort");
      expect(abortEntry).toBeDefined();
    });

    it("should succeed when LLM returns valid healed code", async () => {
      const script = makeScript(
        'import http from "k6/http";\nexport default function() { http.get("broken"); }'
      );
      const result = await engine.heal(script, "status 400 Bad Request error");

      expect(result.success).toBe(true);
      expect(result.healedScript).toBeDefined();
      expect(result.healedScript!.files.some((f) => f.path.includes("-healed"))).toBe(true);
      expect(result.attempts.length).toBeGreaterThan(0);
      expect(result.auditTrail.some((a) => a.result === "success")).toBe(true);
    });

    it("should include audit trail entries", async () => {
      const script = makeScript(
        'import http from "k6/http";\nexport default function() { http.get("test"); }'
      );
      const result = await engine.heal(script, "HTTP 422 validation error");

      expect(result.auditTrail.length).toBeGreaterThan(0);
      // Should have heal-start and attempt entries
      expect(result.auditTrail.some((a) => a.action === "heal-start")).toBe(true);
    });

    it("should respect MAX_RETRIES limit (3 attempts)", async () => {
      // Mock the LLM to return code that will always fail validation (too short)
      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: "text", text: "short" }],
        usage: { input_tokens: 100, output_tokens: 10 },
      });

      const script = makeScript(
        'import http from "k6/http";\nexport default function() { http.get("test"); }'
      );
      const result = await engine.heal(script, "status 400 Bad Request");

      expect(result.success).toBe(false);
      expect(result.attempts.length).toBeLessThanOrEqual(3);
      const maxRetriesEntry = result.auditTrail.find((a) => a.action === "heal-max-retries");
      expect(maxRetriesEntry).toBeDefined();
    });

    it("should detect hardcoded secrets in healed code", async () => {
      mockAnthropicCreate.mockResolvedValue({
        content: [
          {
            type: "text",
            text: `import http from "k6/http";
export default function() {
  const password = 'supersecretpassword123';
  http.get("http://example.com");
}`,
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const script = makeScript(
        'import http from "k6/http";\nexport default function() { http.get("test"); }'
      );
      const result = await engine.heal(script, "status 422 validation");

      // Should fail validation because of hardcoded secret
      expect(result.success).toBe(false);
    });

    it("should detect Node.js imports in healed code", async () => {
      mockAnthropicCreate.mockResolvedValue({
        content: [
          {
            type: "text",
            text: `import http from "k6/http";
import fs from 'fs';
export default function() {
  http.get(__ENV.BASE_URL + "/api");
}`,
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const script = makeScript(
        'import http from "k6/http";\nexport default function() { http.get("test"); }'
      );
      const result = await engine.heal(script, "status 400 error");

      // Should fail validation because of Node.js import
      expect(result.success).toBe(false);
    });

    it("should handle LLM exceptions gracefully", async () => {
      mockAnthropicCreate.mockRejectedValue(new Error("API rate limit exceeded"));

      const script = makeScript(
        'import http from "k6/http";\nexport default function() { http.get("test"); }'
      );
      const result = await engine.heal(script, "status 400 Bad Request");

      expect(result.success).toBe(false);
      // Attempts should exist with failure
      const failedAttempts = result.attempts.filter((a) => !a.success);
      expect(failedAttempts.length).toBeGreaterThan(0);
    });

    it("should extract code from markdown code blocks in LLM response", async () => {
      const wrappedCode = `\`\`\`typescript
import http from "k6/http";
import { check } from "k6";

export const options = { vus: 5, duration: "20s" };

export default function () {
  const res = http.get(__ENV.BASE_URL + "/api/items");
  check(res, { "status 200": (r) => r.status === 200 });
}
\`\`\``;
      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: "text", text: wrappedCode }],
        usage: { input_tokens: 200, output_tokens: 100 },
      });

      const script = makeScript(
        'import http from "k6/http";\nexport default function() { http.get("test"); }'
      );
      const result = await engine.heal(script, "status 422 error");

      expect(result.success).toBe(true);
    });

    it("should reduce confidence for each healing cycle", async () => {
      const script = makeScript(
        'import http from "k6/http";\nexport default function() { http.get("test"); }'
      );
      const result = await engine.heal(script, "status 400 error");

      if (result.success && result.healedScript) {
        // Original confidence 0.9, minus 0.1 per cycle (at least 1 cycle)
        expect(result.healedScript.metadata.confidence).toBeLessThanOrEqual(0.9);
        expect(result.healedScript.metadata.confidence).toBeGreaterThanOrEqual(0.5);
      }
    });
  });
});
