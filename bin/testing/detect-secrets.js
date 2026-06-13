#!/usr/bin/env node
/**
 * T-070: Secret detection for pre-commit hook
 *
 * Scans staged files for common secret patterns:
 * - Bearer tokens (JWT)
 * - AWS access keys (AKIA...)
 * - Generic API keys / tokens
 * - PEM private keys
 * - Connection strings with passwords
 * - Hard-coded passwords
 *
 * Allowlist: add file paths to .secretsignore to suppress false positives.
 * Per-line: add comment `// secret-allow` to suppress a single line.
 *
 * Usage:
 *   node bin/testing/detect-secrets.js              # scan all files
 *   node bin/testing/detect-secrets.js --files a.ts # lint-staged mode
 */

"use strict";

const fs   = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "../..");

// ── Patterns ──────────────────────────────────────────────────────────────────

const SECRET_PATTERNS = [
  { re: /Bearer\s+eyJ[A-Za-z0-9_\-\.]{20,}/,         label: "JWT Bearer token" },
  { re: /AKIA[0-9A-Z]{16}/,                           label: "AWS Access Key ID" },
  { re: /-----BEGIN\s+(RSA\s+)?PRIVATE KEY-----/,     label: "PEM private key" },
  { re: /['\"]?(?:api[_-]?key|apikey|api_secret)['\"]?\s*[:=]\s*['\"][A-Za-z0-9_\-\.]{16,}['\"]/, label: "API key assignment" },
  { re: /['\"]?(?:password|passwd|secret)['\"]?\s*[:=]\s*['\"][^'"${}\s]{8,}['\"]/i, label: "Hard-coded password" },
  { re: /(?:postgres|mysql|mongodb|redis):\/\/[^:]+:[^@]+@/i, label: "Connection string with credentials" },
  { re: /ghp_[A-Za-z0-9]{36}/,                        label: "GitHub Personal Access Token" },
  { re: /sk-[A-Za-z0-9]{20,}/,                        label: "API secret key (sk- prefix)" },
];

// ── Allowlist (file-level) ────────────────────────────────────────────────────

const SECRETSIGNORE_PATH = path.join(ROOT_DIR, ".secretsignore");
const fileAllowlist = new Set();

if (fs.existsSync(SECRETSIGNORE_PATH)) {
  fs.readFileSync(SECRETSIGNORE_PATH, "utf-8")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#"))
    .forEach(l => fileAllowlist.add(l));
}

// Files that may intentionally contain pattern examples (docs, test fixtures)
const DEFAULT_ALLOWLIST = new Set([
  "docs/SECURITY.md",
  "docs/CLIENT_MANAGEMENT.md",
  "bin/testing/detect-secrets.js",   // this file itself contains the patterns
  "shared/schemas/rbac-config.schema.json",
]);

// ── File collection ───────────────────────────────────────────────────────────

const isFilesMode = process.argv.includes("--files");
let filesToCheck;

if (isFilesMode) {
  const idx = process.argv.indexOf("--files");
  filesToCheck = process.argv.slice(idx + 1);
} else {
  // Default: scan src/, clients/, bin/ but not node_modules or dist
  const { glob } = require("glob");
  filesToCheck = glob.sync("{src,clients,bin,shared}/**/*.{ts,js,json,sh}", { cwd: ROOT_DIR });
}

if (filesToCheck.length === 0) process.exit(0);

// ── Scan ──────────────────────────────────────────────────────────────────────

let violations = 0;

for (const file of filesToCheck) {
  const rel = path.relative(ROOT_DIR, path.isAbsolute(file) ? file : path.join(ROOT_DIR, file));

  if (DEFAULT_ALLOWLIST.has(rel) || fileAllowlist.has(rel)) continue;
  if (!fs.existsSync(path.join(ROOT_DIR, rel))) continue;

  // Skip binary files (check first 512 bytes)
  const buf = fs.readFileSync(path.join(ROOT_DIR, rel));
  if (buf.slice(0, 512).includes(0)) continue;

  const lines = buf.toString("utf-8").split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Per-line allowlist
    if (line.includes("secret-allow") || line.includes("secretsignore")) continue;

    // Skip placeholder/template values
    if (/\$\{__ENV\.|__ENV\[|{{.*}}|<YOUR_|YOUR_API|example|placeholder/i.test(line)) continue;

    for (const { re, label } of SECRET_PATTERNS) {
      if (re.test(line)) {
        console.error(`\x1b[31m[SECRET]\x1b[0m ${rel}:${i + 1} — ${label}`);
        console.error(`  ${line.trim().substring(0, 120)}`);
        console.error(`  → Add to .secretsignore or use \`// secret-allow\` to suppress false positives`);
        violations++;
        break;
      }
    }
  }
}

if (violations > 0) {
  console.error(`\n${violations} potential secret(s) detected. Review before committing.`);
  process.exit(1);
}

process.exit(0);
