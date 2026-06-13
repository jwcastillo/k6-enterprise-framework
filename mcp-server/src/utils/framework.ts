/**
 * Utility helpers for accessing k6 framework filesystem and CLI.
 * Shared by resources and tools.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve, join, relative } from "path";
import { execSync } from "child_process";

// ── Framework root resolution ─────────────────────────────────────────────────

export const FRAMEWORK_ROOT = resolve(new URL("../../..", import.meta.url).pathname);
export const CLIENTS_DIR    = join(FRAMEWORK_ROOT, "clients");
export const REPORTS_DIR    = join(FRAMEWORK_ROOT, "reports");
export const BIN_DIR        = join(FRAMEWORK_ROOT, "bin");

// ── Validation ────────────────────────────────────────────────────────────────

const CLIENT_NAME_RE = /^[a-zA-Z0-9_-]+$/;

export function validateClientName(name: string): void {
  if (!CLIENT_NAME_RE.test(name)) {
    throw mcpError("INVALID_PARAMS", `Invalid client name: '${name}'. Only letters, numbers, hyphens and underscores allowed.`);
  }
}

export function validateClientExists(name: string): string {
  validateClientName(name);
  const dir = join(CLIENTS_DIR, name);
  if (!existsSync(dir)) {
    throw mcpError("NOT_FOUND", `Client '${name}' not found.`);
  }
  return dir;
}

// ── Structured MCP error ──────────────────────────────────────────────────────

export interface McpError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export function mcpError(code: string, message: string, details?: Record<string, unknown>): Error {
  const err = new Error(JSON.stringify({ code, message, details }));
  err.name = "McpError";
  return err;
}

export function formatError(err: unknown): McpError {
  if (err instanceof Error && err.name === "McpError") {
    return JSON.parse(err.message) as McpError;
  }
  return { code: "INTERNAL_ERROR", message: String(err) };
}

// ── Filesystem helpers ────────────────────────────────────────────────────────

export function readJsonFile(filePath: string): unknown {
  if (!existsSync(filePath)) {
    throw mcpError("NOT_FOUND", `File not found: ${relative(FRAMEWORK_ROOT, filePath)}`);
  }
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (e) {
    throw mcpError("PARSE_ERROR", `Failed to parse JSON: ${(e as Error).message}`);
  }
}

export function globTs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];

  function walk(d: string) {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry.endsWith(".ts")) {
        results.push(relative(dir, full));
      }
    }
  }

  walk(dir);
  return results.sort();
}

// ── CLI command execution ─────────────────────────────────────────────────────

export function runCliCommand(cmd: string, cwd = FRAMEWORK_ROOT): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(cmd, { cwd, encoding: "utf-8", timeout: 300_000 });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? String(err),
      exitCode: e.status ?? 1,
    };
  }
}

// ── Input sanitization ────────────────────────────────────────────────────────

/** Prevent shell injection: only allow safe characters in client/test names */
export function sanitizeArg(value: string): string {
  if (!/^[a-zA-Z0-9/_.\-]+$/.test(value)) {
    throw mcpError("INVALID_PARAMS", `Argument contains unsafe characters: '${value}'`);
  }
  return value;
}
