import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseYamlSafe, parseYamlFileSafe } from "../../src/core/yaml-parser";

describe("YamlParser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── parseYamlSafe ────────────────────────────────────────────────────────

  describe("parseYamlSafe()", () => {
    it("should parse valid YAML to an object", () => {
      const yaml = `
client: my-team
version: "1.0.0"
environment: staging
`;
      const result = parseYamlSafe(yaml);
      expect(result).toEqual({
        client: "my-team",
        version: "1.0.0",
        environment: "staging",
      });
    });

    it("should parse nested YAML structures", () => {
      const yaml = `
endpoints:
  api:
    baseUrl: https://api.example.com
    timeout: 30s
  auth:
    baseUrl: https://auth.example.com
`;
      const result = parseYamlSafe(yaml);
      expect(result.endpoints).toBeDefined();
      expect((result.endpoints as Record<string, Record<string, string>>).api.baseUrl).toBe(
        "https://api.example.com",
      );
    });

    it("should parse YAML with arrays", () => {
      const yaml = `
thresholds:
  http_req_duration:
    - "p(95)<500"
    - "p(99)<1000"
`;
      const result = parseYamlSafe(yaml);
      const thresholds = result.thresholds as Record<string, string[]>;
      expect(thresholds.http_req_duration).toEqual(["p(95)<500", "p(99)<1000"]);
    });

    // ── Size limit ──────────────────────────────────────────────────────

    it("should throw if YAML exceeds default size limit (1 MB)", () => {
      const huge = "key: " + "x".repeat(1_048_577);
      expect(() => parseYamlSafe(huge)).toThrow("exceeds size limit");
    });

    it("should respect custom maxBytes option", () => {
      const yaml = "key: " + "x".repeat(100);
      expect(() => parseYamlSafe(yaml, { maxBytes: 50 })).toThrow("exceeds size limit");
    });

    it("should accept YAML within custom maxBytes", () => {
      const yaml = "key: value";
      expect(() => parseYamlSafe(yaml, { maxBytes: 1000 })).not.toThrow();
    });

    // ── Billion laughs detection ────────────────────────────────────────

    it("should detect billion laughs attack pattern", () => {
      // Build a YAML string with many anchors and aliases
      let yaml = "";
      for (let i = 0; i < 6; i++) {
        yaml += `anchor${i}: &a${i} value${i}\n`;
      }
      for (let i = 0; i < 55; i++) {
        yaml += `ref${i}: *a${i % 6}\n`;
      }
      expect(() => parseYamlSafe(yaml)).toThrow(
        "billion laughs attack",
      );
    });

    it("should allow normal YAML with few anchors", () => {
      const yaml = `
base: &base
  timeout: 30s
service:
  <<: *base
  name: api
`;
      expect(() => parseYamlSafe(yaml)).not.toThrow();
    });

    // ── Depth limit ─────────────────────────────────────────────────────

    it("should throw if nesting exceeds default depth limit (10)", () => {
      // Build deeply nested YAML
      let yaml = "a:\n";
      for (let i = 0; i < 12; i++) {
        yaml += "  ".repeat(i + 1) + `b${i}:\n`;
      }
      yaml += "  ".repeat(13) + "value: deep\n";
      expect(() => parseYamlSafe(yaml)).toThrow("Nesting depth exceeds maximum");
    });

    it("should respect custom maxDepth option", () => {
      const yaml = `
a:
  b:
    c:
      value: deep
`;
      expect(() => parseYamlSafe(yaml, { maxDepth: 2 })).toThrow(
        "Nesting depth exceeds maximum",
      );
    });

    it("should allow nesting within depth limit", () => {
      const yaml = `
a:
  b:
    c: value
`;
      const result = parseYamlSafe(yaml, { maxDepth: 5 });
      expect((result.a as Record<string, Record<string, string>>).b.c).toBe("value");
    });

    // ── Parse errors ────────────────────────────────────────────────────

    it("should throw with enriched error for invalid YAML syntax", () => {
      const yaml = `
key: value
  bad_indent: this is wrong
`;
      expect(() => parseYamlSafe(yaml)).toThrow("[yaml-parser]");
    });

    it("should throw if YAML parses to null", () => {
      expect(() => parseYamlSafe("")).toThrow("must parse to an object");
    });

    it("should throw if YAML parses to a scalar", () => {
      expect(() => parseYamlSafe("just a string")).toThrow("must parse to an object");
    });

    it("should throw if YAML parses to an array", () => {
      const yaml = `
- item1
- item2
`;
      expect(() => parseYamlSafe(yaml)).toThrow("must parse to an object");
    });

    // ── Safety: dangerous tags ──────────────────────────────────────────

    it("should reject YAML with !!js/function tag", () => {
      const yaml = `danger: !!js/function 'function() { return 42; }'`;
      expect(() => parseYamlSafe(yaml)).toThrow();
    });
  });

  // ── parseYamlFileSafe ────────────────────────────────────────────────────

  describe("parseYamlFileSafe()", () => {
    it("should throw if file does not exist", () => {
      expect(() => parseYamlFileSafe("/nonexistent/file.yaml")).toThrow(
        "Cannot read file",
      );
    });

    it("should throw if file exceeds size limit", () => {
      // We need to mock fs for this test
      const fs = require("fs");
      const originalStatSync = fs.statSync;
      const originalReadFileSync = fs.readFileSync;

      fs.statSync = vi.fn(() => ({ size: 2_000_000 }));
      fs.readFileSync = vi.fn(() => "key: value");

      try {
        expect(() => parseYamlFileSafe("/some/file.yaml")).toThrow(
          "exceeds size limit",
        );
      } finally {
        fs.statSync = originalStatSync;
        fs.readFileSync = originalReadFileSync;
      }
    });

    it("should parse a valid YAML file", () => {
      const fs = require("fs");
      const originalStatSync = fs.statSync;
      const originalReadFileSync = fs.readFileSync;

      const yamlContent = "client: test-client\nversion: '1.0.0'\n";
      fs.statSync = vi.fn(() => ({ size: yamlContent.length }));
      fs.readFileSync = vi.fn(() => yamlContent);

      try {
        const result = parseYamlFileSafe("/some/config.yaml");
        expect(result.client).toBe("test-client");
        expect(result.version).toBe("1.0.0");
      } finally {
        fs.statSync = originalStatSync;
        fs.readFileSync = originalReadFileSync;
      }
    });

    it("should respect custom maxBytes for file size check", () => {
      const fs = require("fs");
      const originalStatSync = fs.statSync;
      const originalReadFileSync = fs.readFileSync;

      fs.statSync = vi.fn(() => ({ size: 200 }));
      fs.readFileSync = vi.fn(() => "key: value");

      try {
        expect(() => parseYamlFileSafe("/some/file.yaml", { maxBytes: 100 })).toThrow(
          "exceeds size limit",
        );
      } finally {
        fs.statSync = originalStatSync;
        fs.readFileSync = originalReadFileSync;
      }
    });
  });
});
