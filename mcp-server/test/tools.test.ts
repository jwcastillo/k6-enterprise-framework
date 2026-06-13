/**
 * COV-07 — mcp-server tools coverage bootstrap.
 *
 * Tests the 3 exported tools (runTest, validateSchema, generateScaffold)
 * by mocking the runCliCommand transport so no real k6/bash is spawned.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the utils/framework module before importing tools/index
vi.mock("../src/utils/framework.js", async () => {
  const actual = await vi.importActual<typeof import("../src/utils/framework.js")>(
    "../src/utils/framework.js"
  );
  return {
    ...actual,
    // Replace runCliCommand with a stub that returns predictable results
    runCliCommand: vi.fn(() => ({ stdout: "OK\n", stderr: "", exitCode: 0 })),
    // Allow validateClientExists to short-circuit instead of touching the FS
    validateClientExists: vi.fn((name: string) => `/fake/clients/${name}`),
  };
});

import {
  runTest,
  validateSchema,
  generateScaffold,
} from "../src/tools/index.js";
import * as framework from "../src/utils/framework.js";

describe("mcp-server tools (COV-07)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── runTest ───────────────────────────────────────────────────────────────

  describe("runTest", () => {
    it("invokes runCliCommand with sanitized args and returns pass result", () => {
      const result = runTest({
        client: "myclient",
        test: "api/smoke-users",
        profile: "smoke",
        env: "default",
      });
      expect(result.status).toBe("pass");
      expect(result.exitCode).toBe(0);
      expect(framework.runCliCommand).toHaveBeenCalledOnce();
      const cmdArg = (framework.runCliCommand as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(cmdArg).toContain("myclient");
      expect(cmdArg).toContain("api/smoke-users");
      expect(cmdArg).toContain("smoke");
    });

    it("returns fail status when underlying command exits non-zero", () => {
      (framework.runCliCommand as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        stdout: "threshold violation",
        stderr: "",
        exitCode: 99,
      });
      const result = runTest({ client: "myclient", test: "api/smoke" });
      expect(result.status).toBe("fail");
      expect(result.exitCode).toBe(99);
    });

    it("validates client existence (throws when validation rejects)", () => {
      (framework.validateClientExists as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        const err = new Error(JSON.stringify({ code: "NOT_FOUND", message: "Client not found" }));
        err.name = "McpError";
        throw err;
      });
      expect(() => runTest({ client: "nonexistent", test: "api/smoke" })).toThrow();
    });
  });

  // ── validateSchema ────────────────────────────────────────────────────────

  describe("validateSchema", () => {
    it("rejects paths outside the framework root", async () => {
      // Use a path that resolves outside the framework root
      await expect(validateSchema({ file: "../../../etc/passwd" })).rejects.toMatchObject({
        code: expect.any(String),
      });
    });

    it("rejects non-existent files with NOT_FOUND", async () => {
      await expect(
        validateSchema({ file: "this-file-does-not-exist-xyz.json" })
      ).rejects.toMatchObject({
        code: expect.any(String),
      });
    });
  });

  // ── generateScaffold ──────────────────────────────────────────────────────

  describe("generateScaffold", () => {
    it("calls create-client.sh for type='client'", () => {
      const result = generateScaffold({ name: "newclient", type: "client" });
      expect(result.created).toBeInstanceOf(Array);
      expect(framework.runCliCommand).toHaveBeenCalledOnce();
      const cmd = (framework.runCliCommand as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(cmd).toMatch(/create-client\.sh/);
      expect(cmd).toContain("newclient");
    });

    it("requires --client for non-client types", () => {
      expect(() => generateScaffold({ name: "foo", type: "test" })).toThrow();
    });

    it("calls generate.js for type='test' with --client", () => {
      const result = generateScaffold({
        name: "smoke-orders",
        type: "test",
        client: "myclient",
      });
      expect(result.created).toBeInstanceOf(Array);
      const cmd = (framework.runCliCommand as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(cmd).toMatch(/generate\.js/);
      expect(cmd).toContain("smoke-orders");
      expect(cmd).toContain("myclient");
    });

    it("throws SCAFFOLD_FAILED when underlying command exits non-zero", () => {
      (framework.runCliCommand as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        stdout: "permission denied",
        stderr: "",
        exitCode: 1,
      });
      expect(() => generateScaffold({ name: "x", type: "client" })).toThrow();
    });
  });
});
