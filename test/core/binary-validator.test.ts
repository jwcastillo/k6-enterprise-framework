import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import {
  validateK6Binary,
  validateJslibImport,
} from "../../src/core/binary-validator";

describe("binary-validator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("validateJslibImport()", () => {
    it("should accept jslib.k6.io imports", () => {
      expect(() =>
        validateJslibImport("https://jslib.k6.io/k6-utils/1.2.0/index.js"),
      ).not.toThrow();
    });

    it("should accept cdn.jsdelivr.net imports", () => {
      expect(() =>
        validateJslibImport("https://cdn.jsdelivr.net/npm/k6-utils@1.0.0/index.js"),
      ).not.toThrow();
    });

    it("should reject untrusted domains", () => {
      expect(() =>
        validateJslibImport("https://evil.example.com/exploit.js"),
      ).toThrow(/untrusted domain.*evil\.example\.com/);
    });

    it("should reject HTTP URLs with untrusted host", () => {
      expect(() =>
        validateJslibImport("http://evil.com/module.js"),
      ).toThrow(/untrusted domain/);
    });

    it("should reject invalid URLs", () => {
      expect(() =>
        validateJslibImport("not-a-valid-url"),
      ).toThrow(/Invalid jslib import URL/);
    });

    it("should accept subdomain of allowed domain", () => {
      expect(() =>
        validateJslibImport("https://sub.jslib.k6.io/module.js"),
      ).not.toThrow();
    });

    it("should reject domain that merely ends with an allowed domain name", () => {
      // "fakejslib.k6.io" is not "jslib.k6.io" or "*.jslib.k6.io"
      expect(() =>
        validateJslibImport("https://fakejslib.k6.io/module.js"),
      ).toThrow(/untrusted domain/);
    });

    it("should accept the exact allowed domain", () => {
      expect(() =>
        validateJslibImport("https://jslib.k6.io/module.js"),
      ).not.toThrow();
      expect(() =>
        validateJslibImport("https://cdn.jsdelivr.net/package.js"),
      ).not.toThrow();
    });

    it("should be case insensitive on hostname", () => {
      expect(() =>
        validateJslibImport("https://JSLIB.K6.IO/module.js"),
      ).not.toThrow();
    });

    it("should reject empty URL string", () => {
      expect(() =>
        validateJslibImport(""),
      ).toThrow(/Invalid jslib import URL/);
    });
  });

  describe("validateK6Binary()", () => {
    it("should throw for non-existent binary path", () => {
      expect(() =>
        validateK6Binary("/nonexistent/path/to/k6"),
      ).toThrow(/Cannot resolve binary path/);
    });

    it("should throw for binary in untrusted directory", () => {
      // Create a temp file that exists but is in /tmp (not trusted)
      const tmpBin = path.join(os.tmpdir(), `fake-k6-binary-${Date.now()}`);
      fs.writeFileSync(tmpBin, "#!/bin/sh\necho k6");
      fs.chmodSync(tmpBin, 0o755);

      try {
        expect(() => validateK6Binary(tmpBin)).toThrow(/not in a trusted directory/);
      } finally {
        fs.unlinkSync(tmpBin);
      }
    });

    it("should include allowed paths in error message", () => {
      const tmpBin = path.join(os.tmpdir(), `fake-k6-untrusted-${Date.now()}`);
      fs.writeFileSync(tmpBin, "#!/bin/sh\necho k6");
      fs.chmodSync(tmpBin, 0o755);

      try {
        expect(() => validateK6Binary(tmpBin)).toThrow(/Allowed paths/);
      } finally {
        fs.unlinkSync(tmpBin);
      }
    });
  });
});
