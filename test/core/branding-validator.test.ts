import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import {
  validateBrandingAsset,
  pruneOldReports,
} from "../../src/core/branding-validator";

let tmpDir: string;

describe("branding-validator", () => {
  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "k6-branding-test-"));
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("validateBrandingAsset()", () => {
    it("should reject disallowed file extensions", () => {
      const filePath = path.join(tmpDir, "logo.gif");
      fs.writeFileSync(filePath, "data");

      const result = validateBrandingAsset(filePath);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("not allowed");
    });

    it("should reject .exe extension", () => {
      const filePath = path.join(tmpDir, "malware.exe");
      fs.writeFileSync(filePath, "data");

      const result = validateBrandingAsset(filePath);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("not allowed");
    });

    it("should accept .png extension", () => {
      // Create a minimal valid PNG
      const pngHeader = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG magic
        0x00, 0x00, 0x00, 0x0d, // IHDR chunk length
        0x49, 0x48, 0x44, 0x52, // "IHDR"
        0x00, 0x00, 0x00, 0x10, // width: 16
        0x00, 0x00, 0x00, 0x10, // height: 16
        0x08, 0x02, 0x00, 0x00, 0x00,
      ]);
      const filePath = path.join(tmpDir, "logo.png");
      fs.writeFileSync(filePath, pngHeader);

      const result = validateBrandingAsset(filePath);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should accept .jpg extension", () => {
      // Create a minimal JPEG header
      const jpgHeader = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, // JPEG SOI + APP0 marker
        0x00, 0x10, // segment length
        0x4a, 0x46, 0x49, 0x46, 0x00, // "JFIF\0"
        0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
      ]);
      const filePath = path.join(tmpDir, "photo.jpg");
      fs.writeFileSync(filePath, jpgHeader);

      const result = validateBrandingAsset(filePath);

      expect(result.valid).toBe(true);
    });

    it("should accept .jpeg extension", () => {
      const jpgHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      const filePath = path.join(tmpDir, "photo.jpeg");
      fs.writeFileSync(filePath, Buffer.concat([jpgHeader, Buffer.alloc(100)]));

      const result = validateBrandingAsset(filePath);

      expect(result.valid).toBe(true);
    });

    it("should accept clean SVG files", () => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100"/></svg>';
      const filePath = path.join(tmpDir, "logo.svg");
      fs.writeFileSync(filePath, svg);

      const result = validateBrandingAsset(filePath);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should reject SVG with script tag", () => {
      const svg = '<svg><script>alert("xss")</script></svg>';
      const filePath = path.join(tmpDir, "evil-script.svg");
      fs.writeFileSync(filePath, svg);

      const result = validateBrandingAsset(filePath);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("dangerous content");
    });

    it("should reject SVG with event handlers", () => {
      const svg = '<svg><rect onclick="alert(1)" width="100" height="100"/></svg>';
      const filePath = path.join(tmpDir, "evil-onclick.svg");
      fs.writeFileSync(filePath, svg);

      const result = validateBrandingAsset(filePath);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("dangerous content");
    });

    it("should reject SVG with javascript: URI", () => {
      const svg = '<svg><a href="javascript: alert(1)"><text>Click</text></a></svg>';
      const filePath = path.join(tmpDir, "evil-js-uri.svg");
      fs.writeFileSync(filePath, svg);

      const result = validateBrandingAsset(filePath);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("dangerous content");
    });

    it("should reject SVG with foreignObject", () => {
      const svg = '<svg><foreignObject width="100" height="100"><body>html</body></foreignObject></svg>';
      const filePath = path.join(tmpDir, "evil-foreign.svg");
      fs.writeFileSync(filePath, svg);

      const result = validateBrandingAsset(filePath);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("dangerous content");
    });

    it("should reject files exceeding max size (500 KB)", () => {
      const filePath = path.join(tmpDir, "huge.png");
      // Write > 500KB
      const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const largeData = Buffer.alloc(510 * 1024);
      pngMagic.copy(largeData, 0);
      fs.writeFileSync(filePath, largeData);

      const result = validateBrandingAsset(filePath);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("exceeds maximum");
    });

    it("should warn for oversized PNG dimensions", () => {
      // Create PNG with 500x300 dimensions (exceeds 400x200)
      const pngHeader = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d,
        0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x01, 0xf4, // width: 500
        0x00, 0x00, 0x01, 0x2c, // height: 300
        0x08, 0x02, 0x00, 0x00, 0x00,
      ]);
      const filePath = path.join(tmpDir, "big-dims.png");
      fs.writeFileSync(filePath, pngHeader);

      const result = validateBrandingAsset(filePath);

      expect(result.valid).toBe(true); // Dimensions are warnings, not errors
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain("exceed recommended maximum");
    });

    it("should warn when PNG dimensions cannot be read", () => {
      const filePath = path.join(tmpDir, "corrupt.png");
      // Too short to be valid PNG
      fs.writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

      const result = validateBrandingAsset(filePath);

      expect(result.valid).toBe(true); // Still valid (no error), just a warning
      expect(result.warnings[0]).toContain("Could not read PNG dimensions");
    });

    it("should return error for non-existent file", () => {
      const result = validateBrandingAsset("/nonexistent/logo.png");

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("Cannot read file");
    });
  });

  describe("pruneOldReports()", () => {
    it("should return 0 when reports dir does not exist", () => {
      const result = pruneOldReports("/nonexistent/reports", 30);

      expect(result).toBe(0);
    });

    it("should return 0 when retentionDays is 0 or negative", () => {
      const result = pruneOldReports(tmpDir, 0);

      expect(result).toBe(0);
    });

    it("should remove old report directories", () => {
      const reportsDir = path.join(tmpDir, "reports-prune");
      const testDir = path.join(reportsDir, "api-test");

      // Create an old report
      const oldRunDir = path.join(testDir, "2020-01-01_00-00-00");
      fs.mkdirSync(oldRunDir, { recursive: true });
      fs.writeFileSync(path.join(oldRunDir, "report.json"), "{}");

      // Create a recent report
      const recentRunDir = path.join(testDir, "recent-run");
      fs.mkdirSync(recentRunDir, { recursive: true });
      fs.writeFileSync(path.join(recentRunDir, "report.json"), "{}");

      // Set the old dir's mtime to very old (using utimes)
      const oldTime = new Date("2020-01-01");
      fs.utimesSync(oldRunDir, oldTime, oldTime);

      const removed = pruneOldReports(reportsDir, 30);

      expect(removed).toBeGreaterThanOrEqual(1);
      expect(fs.existsSync(oldRunDir)).toBe(false);
      expect(fs.existsSync(recentRunDir)).toBe(true);
    });

    it("should not remove recent reports", () => {
      const reportsDir = path.join(tmpDir, "reports-keep");
      const testDir = path.join(reportsDir, "test");
      const runDir = path.join(testDir, "recent");
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(path.join(runDir, "data.json"), "{}");

      const removed = pruneOldReports(reportsDir, 30);

      expect(removed).toBe(0);
      expect(fs.existsSync(runDir)).toBe(true);
    });
  });
});
