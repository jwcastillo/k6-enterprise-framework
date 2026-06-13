/**
 * T-031: Reporting isolation per client
 *
 * Ensures all report artifacts (HTML, JSON, logs, comparisons, audit)
 * are stored and retrieved exclusively within a client's namespace.
 *
 * Report path: reports/{client}/{testName}/{timestamp}/
 *
 * Cross-client report access is blocked. The auto-compare engine
 * only searches within the active client's directory.
 *
 * Runs in Node.js context (bin/), NOT in k6 goja runtime.
 */

import { ClientContext } from "../types/client.d";
import { assertPathInClientScope, ensureReportsDir } from "./client-resolver";

const path = require("path") as typeof import("path");
const fs = require("fs") as typeof import("fs");

// ── Report directory management ───────────────────────────────────────────────

/**
 * Build the report output directory for a specific test execution.
 * Creates the directory if it doesn't exist.
 *
 * Pattern: reports/{client}/{testName}/{YYYY-MM-DD_HH-mm-ss}/
 */
export function buildReportDir(
  clientContext: ClientContext,
  testName: string,
  timestamp?: Date
): string {
  ensureReportsDir(clientContext);

  const ts = timestamp ?? new Date();
  const dateStr = ts
    .toISOString()
    .replace(/T/, "_")
    .replace(/:/g, "-")
    .replace(/\.\d{3}Z$/, "");

  const reportDir = path.join(clientContext.reportsDir, sanitizeDirName(testName), dateStr);

  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true, mode: 0o755 });
  }

  return reportDir;
}

/**
 * List all report directories for a client, optionally filtered by test name.
 * Returns paths sorted by date (newest first).
 */
export function listClientReports(clientContext: ClientContext, testName?: string): string[] {
  if (!fs.existsSync(clientContext.reportsDir)) {
    return [];
  }

  const results: string[] = [];

  if (testName) {
    // List reports for a specific test
    const testDir = path.join(clientContext.reportsDir, sanitizeDirName(testName));
    if (fs.existsSync(testDir)) {
      const entries = fs.readdirSync(testDir).sort().reverse();
      for (const entry of entries) {
        const fullPath = path.join(testDir, entry);
        if (fs.statSync(fullPath).isDirectory()) {
          results.push(fullPath);
        }
      }
    }
  } else {
    // List all reports across all tests
    const testDirs = fs.readdirSync(clientContext.reportsDir);
    for (const testDir of testDirs) {
      const testPath = path.join(clientContext.reportsDir, testDir);
      if (!fs.statSync(testPath).isDirectory()) continue;
      if (testDir === "audit") continue; // Skip audit directory
      if (testDir === "slo-compliance") continue; // Skip SLO reports

      const entries = fs.readdirSync(testPath).sort().reverse();
      for (const entry of entries) {
        const fullPath = path.join(testPath, entry);
        if (fs.statSync(fullPath).isDirectory()) {
          results.push(fullPath);
        }
      }
    }
    // Sort by directory name (timestamp) descending
    results.sort().reverse();
  }

  return results;
}

/**
 * Find the most recent report for a client/test combination.
 * Used by the auto-compare engine to find the baseline.
 */
export function findLatestReport(clientContext: ClientContext, testName: string): string | null {
  const reports = listClientReports(clientContext, testName);
  return reports.length > 0 ? reports[0] : null;
}

/**
 * Find the N most recent reports for comparison.
 */
export function findRecentReports(
  clientContext: ClientContext,
  testName: string,
  count: number
): string[] {
  const reports = listClientReports(clientContext, testName);
  return reports.slice(0, count);
}

// ── Access validation ─────────────────────────────────────────────────────────

/**
 * Validate that a report path belongs to the requesting client.
 * Throws if the path is outside the client's report namespace.
 */
export function validateReportAccess(reportPath: string, clientContext: ClientContext): void {
  assertPathInClientScope(reportPath, clientContext, true);
}

/**
 * Write a report artifact to the client's isolated directory.
 * Validates that the target path is within the client's namespace before writing.
 *
 * @param clientContext - Active client context
 * @param reportDir - Report directory (from buildReportDir)
 * @param filename - Artifact filename (e.g., "report.html", "summary.json")
 * @param content - File content
 */
/** Allowed file extensions for report artifacts (T-133) */
const ALLOWED_REPORT_EXTENSIONS = new Set([".html", ".json", ".jsonl", ".csv", ".txt", ".md"]);

export function writeReportArtifact(
  clientContext: ClientContext,
  reportDir: string,
  filename: string,
  content: string
): string {
  // T-133: Validate file extension against allowlist
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_REPORT_EXTENSIONS.has(ext)) {
    throw new Error(
      `[report-isolation] File extension '${ext}' is not allowed for report artifacts. ` +
        `Allowed: ${[...ALLOWED_REPORT_EXTENSIONS].join(", ")}`
    );
  }

  const filePath = path.join(reportDir, filename);

  // Validate path is within client scope
  validateReportAccess(filePath, clientContext);

  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

/**
 * Read a report artifact from the client's isolated directory.
 * Validates access before reading.
 */
export function readReportArtifact(clientContext: ClientContext, filePath: string): string {
  validateReportAccess(filePath, clientContext);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Report artifact not found: ${path.basename(filePath)}`);
  }

  return fs.readFileSync(filePath, "utf-8");
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Sanitize a test name for use as a directory name.
 * Replaces spaces and special characters with hyphens.
 */
function sanitizeDirName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
