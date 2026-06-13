/**
 * T-133: Branding asset validation and sanitization
 *
 * Node.js context only (bin/) — DO NOT import from k6 scripts.
 *
 * Validates logo/image files uploaded for report branding:
 * - Allowed formats: PNG, JPG/JPEG, SVG (allowlist)
 * - Maximum size: 500 KB
 * - Maximum dimensions: 400×200 px (PNG/JPG verified via magic bytes header)
 * - SVG sanitization: rejects files containing <script> tags or event handlers
 *
 * CHK-SEC-026 / CHK-SEC-027 / CHK-SEC-028 / CHK-SEC-030 (T-133)
 */

const fs = require("fs") as typeof import("fs");
const path = require("path") as typeof import("path");

// ── Limits ────────────────────────────────────────────────────────────────────

/** Maximum branding image size in bytes (500 KB) */
const MAX_BRANDING_BYTES = 500 * 1024;

/** Maximum image dimensions in pixels */
const MAX_WIDTH_PX = 400;
const MAX_HEIGHT_PX = 200;

/** Allowed file extensions for branding assets */
const ALLOWED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".svg"]);

// ── SVG injection patterns ────────────────────────────────────────────────────

/** Patterns that indicate executable content in SVG */
const SVG_DANGEROUS_PATTERNS = [
  /<script[\s>]/i,                  // <script> tag
  /on\w+\s*=/i,                     // event handlers: onclick=, onload=, onerror=, etc.
  /javascript\s*:/i,                 // javascript: URI
  /<use\s+[^>]*href\s*=/i,          // <use href="..."> can load external content
  /xlink:href\s*=\s*["'][^#]/i,     // xlink:href to external resource
  /<foreignObject/i,                 // <foreignObject> embeds arbitrary HTML
  /<iframe/i,                        // <iframe> embed
  /data:\s*text\/html/i,             // data:text/html URI
  /vbscript\s*:/i,                   // VBScript URI
];

// ── PNG/JPG dimension reading ─────────────────────────────────────────────────

/**
 * Read PNG image dimensions from the IHDR chunk (bytes 16–24).
 * Returns null if the file is not a valid PNG.
 */
function readPngDimensions(buf: Buffer): { width: number; height: number } | null {
  // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf.length < 24 ||
    buf[0] !== 0x89 ||
    buf[1] !== 0x50 ||
    buf[2] !== 0x4e ||
    buf[3] !== 0x47
  ) {
    return null;
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

/**
 * Read JPEG image dimensions by scanning for SOF markers.
 * Returns null if no SOF marker is found within the first 64 KB.
 */
function readJpegDimensions(buf: Buffer): { width: number; height: number } | null {
  // JPEG starts with FF D8
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    return null;
  }
  let offset = 2;
  const limit = Math.min(buf.length - 8, 65536);
  while (offset < limit) {
    if (buf[offset] !== 0xff) break;
    const marker = buf[offset + 1];
    const segLen = buf.readUInt16BE(offset + 2);
    // SOF markers: C0–C3, C5–C7, C9–CB, CD–CF
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      const height = buf.readUInt16BE(offset + 5);
      const width = buf.readUInt16BE(offset + 7);
      return { width, height };
    }
    offset += 2 + segLen;
  }
  return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface BrandingValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate a branding asset file (logo for reports).
 *
 * @param filePath - Absolute path to the image file
 * @returns Validation result with errors and warnings
 */
export function validateBrandingAsset(filePath: string): BrandingValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ext = path.extname(filePath).toLowerCase();

  // 1. Extension allowlist
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    errors.push(
      `File extension '${ext}' is not allowed. Allowed: ${[...ALLOWED_EXTENSIONS].join(", ")}`,
    );
    return { valid: false, errors, warnings };
  }

  // 2. File existence and size
  let stat: import("fs").Stats;
  try {
    stat = fs.statSync(filePath);
  } catch (err) {
    errors.push(`Cannot read file: ${(err as Error).message}`);
    return { valid: false, errors, warnings };
  }

  if (stat.size > MAX_BRANDING_BYTES) {
    errors.push(
      `File size ${(stat.size / 1024).toFixed(1)} KB exceeds maximum ${MAX_BRANDING_BYTES / 1024} KB`,
    );
  }

  const buf = fs.readFileSync(filePath);

  // 3. SVG-specific: sanitize for script injection
  if (ext === ".svg") {
    const content = buf.toString("utf-8");
    for (const pattern of SVG_DANGEROUS_PATTERNS) {
      if (pattern.test(content)) {
        errors.push(
          `SVG contains potentially dangerous content (pattern: ${pattern.source.slice(0, 40)}). ` +
            `Remove all <script> tags, event handlers, and external references.`,
        );
        break; // Report once — multiple patterns could fire on the same exploit
      }
    }
  }

  // 4. Dimension check for PNG/JPG
  if (ext === ".png") {
    const dims = readPngDimensions(buf);
    if (dims) {
      if (dims.width > MAX_WIDTH_PX || dims.height > MAX_HEIGHT_PX) {
        warnings.push(
          `PNG dimensions ${dims.width}×${dims.height}px exceed recommended maximum ` +
            `${MAX_WIDTH_PX}×${MAX_HEIGHT_PX}px. Consider resizing for optimal report layout.`,
        );
      }
    } else {
      warnings.push("Could not read PNG dimensions — file may be corrupt or non-standard.");
    }
  } else if (ext === ".jpg" || ext === ".jpeg") {
    const dims = readJpegDimensions(buf);
    if (dims) {
      if (dims.width > MAX_WIDTH_PX || dims.height > MAX_HEIGHT_PX) {
        warnings.push(
          `JPEG dimensions ${dims.width}×${dims.height}px exceed recommended maximum ` +
            `${MAX_WIDTH_PX}×${MAX_HEIGHT_PX}px. Consider resizing for optimal report layout.`,
        );
      }
    } else {
      warnings.push("Could not read JPEG dimensions — file may be corrupt or non-standard.");
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ── Data retention ────────────────────────────────────────────────────────────

/**
 * Remove report directories older than `retentionDays` for a client.
 * Reads `dataRetentionDays` from the client config if available.
 *
 * @param reportsDir - Root reports directory for the client
 * @param retentionDays - Reports older than this many days are deleted
 * @returns Number of directories removed
 */
export function pruneOldReports(reportsDir: string, retentionDays: number): number {
  if (!fs.existsSync(reportsDir)) return 0;
  if (retentionDays <= 0) return 0;

  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let removed = 0;

  // Recurse two levels: reportsDir/{test}/{timestamp}/
  const testDirs = fs.readdirSync(reportsDir, { withFileTypes: true });
  for (const testEntry of testDirs) {
    if (!testEntry.isDirectory()) continue;
    const testPath = path.join(reportsDir, testEntry.name);
    const runDirs = fs.readdirSync(testPath, { withFileTypes: true });
    for (const runEntry of runDirs) {
      if (!runEntry.isDirectory()) continue;
      const runPath = path.join(testPath, runEntry.name);
      const stat = fs.statSync(runPath);
      if (stat.mtimeMs < cutoffMs) {
        fs.rmSync(runPath, { recursive: true, force: true });
        removed++;
      }
    }
  }

  return removed;
}
