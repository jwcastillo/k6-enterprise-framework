import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  validateCliInput,
  assertNoPathTraversal,
  validateRunTestInputs,
  SAFE_NAME_PATTERN,
  SAFE_PATH_PATTERN,
  CLIENT_IDENTITY_PATTERN,
} from "../../src/core/input-validator";

describe("InputValidator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Pattern exports ──────────────────────────────────────────────────────

  describe("SAFE_NAME_PATTERN", () => {
    it("should match alphanumeric, underscore, hyphen, dot", () => {
      expect(SAFE_NAME_PATTERN.test("my-client_v1.0")).toBe(true);
    });

    it("should not match strings with spaces", () => {
      expect(SAFE_NAME_PATTERN.test("has space")).toBe(false);
    });

    it("should not match strings with slashes", () => {
      expect(SAFE_NAME_PATTERN.test("path/segment")).toBe(false);
    });

    it("should not match shell metacharacters", () => {
      expect(SAFE_NAME_PATTERN.test("$(whoami)")).toBe(false);
      expect(SAFE_NAME_PATTERN.test("foo;bar")).toBe(false);
      expect(SAFE_NAME_PATTERN.test("foo|bar")).toBe(false);
      expect(SAFE_NAME_PATTERN.test("foo&bar")).toBe(false);
    });
  });

  describe("SAFE_PATH_PATTERN", () => {
    it("should match paths with forward slashes", () => {
      expect(SAFE_PATH_PATTERN.test("scenarios/auth/login")).toBe(true);
    });

    it("should match simple names", () => {
      expect(SAFE_PATH_PATTERN.test("smoke-test.ts")).toBe(true);
    });

    it("should not match backticks", () => {
      expect(SAFE_PATH_PATTERN.test("`command`")).toBe(false);
    });
  });

  describe("CLIENT_IDENTITY_PATTERN", () => {
    it("should match email-like identities", () => {
      expect(CLIENT_IDENTITY_PATTERN.test("user@domain.com")).toBe(true);
    });

    it("should match simple usernames", () => {
      expect(CLIENT_IDENTITY_PATTERN.test("admin_user")).toBe(true);
    });

    it("should not match strings with spaces", () => {
      expect(CLIENT_IDENTITY_PATTERN.test("user name")).toBe(false);
    });
  });

  // ── validateCliInput ────────────────────────────────────────────────────

  describe("validateCliInput()", () => {
    it("should accept valid input matching pattern", () => {
      expect(() =>
        validateCliInput("--client", "my-team", SAFE_NAME_PATTERN),
      ).not.toThrow();
    });

    it("should throw for non-string input", () => {
      expect(() =>
        validateCliInput("--client", 42 as unknown as string, SAFE_NAME_PATTERN),
      ).toThrow("must be a string");
    });

    it("should throw for empty string", () => {
      expect(() =>
        validateCliInput("--client", "", SAFE_NAME_PATTERN),
      ).toThrow("cannot be empty");
    });

    it("should throw for input exceeding max length (256 chars)", () => {
      const longInput = "a".repeat(257);
      expect(() =>
        validateCliInput("--client", longInput, SAFE_NAME_PATTERN),
      ).toThrow("exceeds maximum length");
    });

    it("should accept input at exactly max length (256 chars)", () => {
      const exactInput = "a".repeat(256);
      expect(() =>
        validateCliInput("--client", exactInput, SAFE_NAME_PATTERN),
      ).not.toThrow();
    });

    it("should throw for null byte injection", () => {
      expect(() =>
        validateCliInput("--client", "valid\0inject", SAFE_NAME_PATTERN),
      ).toThrow("contains null byte");
    });

    it("should throw for path traversal (..) sequences", () => {
      expect(() =>
        validateCliInput("--scenario", "../../etc/passwd", SAFE_PATH_PATTERN),
      ).toThrow("Path traversal detected");
    });

    it("should throw when value does not match pattern", () => {
      expect(() =>
        validateCliInput("--client", "$(whoami)", SAFE_NAME_PATTERN),
      ).toThrow("Invalid value for");
    });

    it("should throw for shell injection via semicolon", () => {
      expect(() =>
        validateCliInput("--client", "valid;rm -rf /", SAFE_NAME_PATTERN),
      ).toThrow(); // Either path traversal or invalid value
    });

    it("should throw for shell injection via pipe", () => {
      expect(() =>
        validateCliInput("--client", "valid|cat /etc/passwd", SAFE_NAME_PATTERN),
      ).toThrow();
    });

    it("should throw for shell injection via ampersand", () => {
      expect(() =>
        validateCliInput("--client", "valid&malicious", SAFE_NAME_PATTERN),
      ).toThrow();
    });

    it("should accept valid path with forward slashes when using SAFE_PATH_PATTERN", () => {
      expect(() =>
        validateCliInput("--scenario", "auth/login-flow", SAFE_PATH_PATTERN),
      ).not.toThrow();
    });

    it("should include 'forward slash' hint in error for SAFE_PATH_PATTERN", () => {
      expect(() =>
        validateCliInput("--scenario", "bad$(cmd)", SAFE_PATH_PATTERN),
      ).toThrow("forward slash");
    });
  });

  // ── assertNoPathTraversal ───────────────────────────────────────────────

  describe("assertNoPathTraversal()", () => {
    it("should not throw for clean paths", () => {
      expect(() =>
        assertNoPathTraversal("/reports/client-a", "--reports-dir"),
      ).not.toThrow();
    });

    it("should throw for path containing '..'", () => {
      expect(() =>
        assertNoPathTraversal("../../../etc/shadow", "--reports-dir"),
      ).toThrow("Path traversal detected");
    });

    it("should throw for path containing '..' in the middle", () => {
      expect(() =>
        assertNoPathTraversal("/safe/../escape", "--path"),
      ).toThrow("Path traversal detected");
    });

    it("should throw for null byte in path", () => {
      expect(() =>
        assertNoPathTraversal("/safe/path\0/inject", "--path"),
      ).toThrow("Null byte detected");
    });

    it("should not throw for paths with single dots", () => {
      expect(() =>
        assertNoPathTraversal("file.name.ext", "--file"),
      ).not.toThrow();
    });
  });

  // ── validateRunTestInputs ───────────────────────────────────────────────

  describe("validateRunTestInputs()", () => {
    it("should accept valid run-test parameters", () => {
      expect(() =>
        validateRunTestInputs({
          client: "my-team",
          scenario: "auth/login",
          profile: "smoke",
          env: "staging",
        }),
      ).not.toThrow();
    });

    it("should accept parameters with optional reportsDir", () => {
      expect(() =>
        validateRunTestInputs({
          client: "my-team",
          scenario: "auth/login",
          profile: "smoke",
          env: "staging",
          reportsDir: "reports/output",
        }),
      ).not.toThrow();
    });

    it("should throw for invalid client name", () => {
      expect(() =>
        validateRunTestInputs({
          client: "$(evil)",
          scenario: "auth/login",
          profile: "smoke",
          env: "staging",
        }),
      ).toThrow();
    });

    it("should throw for path traversal in scenario", () => {
      expect(() =>
        validateRunTestInputs({
          client: "my-team",
          scenario: "../../etc/passwd",
          profile: "smoke",
          env: "staging",
        }),
      ).toThrow("Path traversal");
    });

    it("should throw for empty profile", () => {
      expect(() =>
        validateRunTestInputs({
          client: "my-team",
          scenario: "auth/login",
          profile: "",
          env: "staging",
        }),
      ).toThrow("cannot be empty");
    });

    it("should throw for path traversal in reportsDir", () => {
      expect(() =>
        validateRunTestInputs({
          client: "my-team",
          scenario: "auth/login",
          profile: "smoke",
          env: "staging",
          reportsDir: "../../../tmp/evil",
        }),
      ).toThrow("Path traversal");
    });

    it("should skip reportsDir validation when undefined", () => {
      expect(() =>
        validateRunTestInputs({
          client: "my-team",
          scenario: "auth/login",
          profile: "smoke",
          env: "staging",
          reportsDir: undefined,
        }),
      ).not.toThrow();
    });

    it("should skip reportsDir validation when empty string", () => {
      expect(() =>
        validateRunTestInputs({
          client: "my-team",
          scenario: "auth/login",
          profile: "smoke",
          env: "staging",
          reportsDir: "",
        }),
      ).not.toThrow();
    });
  });
});
