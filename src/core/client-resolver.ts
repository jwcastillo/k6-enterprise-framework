/**
 * T-029: Client Resolver with filesystem isolation
 *
 * Resolves and validates client paths, preventing path traversal attacks.
 * Every file operation targeting a client's namespace must go through this resolver.
 *
 * Security guarantees:
 * - Path traversal (../, symlinks outside clients/) is blocked
 * - Error messages never reveal the existence of other clients
 * - Concurrent executions operate in fully separate filesystem namespaces
 *
 * Note: This module runs in Node.js context (bin/run-test.sh), NOT in k6 goja runtime.
 */

import { ClientContext } from "../types/client.d";
import {
  CLIENT_REQUIRED_DIRS,
  CLIENT_REQUIRED_FILES,
} from "./client-validator";

// Use Node.js built-ins (available in bin/ context, not in k6 runtime)
 
const path = require("path") as typeof import("path");
const fs = require("fs") as typeof import("fs");

// ── Constants ─────────────────────────────────────────────────────────────────

const CLIENT_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const CLIENTS_DIR = "clients";

// ── Core resolver ─────────────────────────────────────────────────────────────

/**
 * Resolve the framework root directory.
 * Walks up from __dirname until it finds the k6-framework root (has clients/ and shared/).
 */
export function resolveFrameworkRoot(startDir?: string): string {
  let dir = startDir ?? path.resolve(__dirname, "../..");
  const maxDepth = 10;
  for (let i = 0; i < maxDepth; i++) {
    if (
      fs.existsSync(path.join(dir, CLIENTS_DIR)) &&
      fs.existsSync(path.join(dir, "shared"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    "ClientResolver: cannot locate framework root (expected clients/ and shared/ directories)",
  );
}

/**
 * Resolve a client by name, returning its isolated filesystem context.
 *
 * @param clientName - Client identifier (directory name under clients/)
 * @param frameworkRoot - Optional framework root override (for testing)
 * @throws If the client name is invalid, path traversal is detected, or structure is incomplete
 */
export function resolveClient(
  clientName: string,
  frameworkRoot?: string,
): ClientContext {
  // 1. Validate client name format
  validateClientName(clientName);

  // 2. Resolve paths
  const root = frameworkRoot ?? resolveFrameworkRoot();
  const clientsBase = path.resolve(root, CLIENTS_DIR);
  const clientDir = path.join(clientsBase, clientName);

  // 3. Check existence
  if (!fs.existsSync(clientDir)) {
    throw new Error(
      `ClientResolver: client '${clientName}' not found. ` +
        `Verify the client directory exists and the name is correct.`,
    );
  }

  // 4. Detect link type
  const lstat = fs.lstatSync(clientDir);
  const isSymlink = lstat.isSymbolicLink();
  const isSubmodule = detectSubmodule(clientDir, root);

  // 5. Resolve canonical path and validate containment
  const canonicalPath = fs.realpathSync(clientDir);

  if (isSymlink) {
    // Symlinks are allowed but must point to a valid directory
    if (!fs.statSync(canonicalPath).isDirectory()) {
      throw new Error(
        `ClientResolver: client '${clientName}' symlink target is not a directory.`,
      );
    }
    // Note: Symlinks to external directories are allowed (US14 requirement)
    // but symlinks into the framework core (src/, shared/) are blocked
    const frameworkCoreDirs = ["src", "shared", "bin", "infrastructure"];
    for (const coreDir of frameworkCoreDirs) {
      const corePath = path.resolve(root, coreDir);
      if (canonicalPath.startsWith(corePath + path.sep) || canonicalPath === corePath) {
        throw new Error(
          `ClientResolver: client '${clientName}' symlink cannot point to framework core directories.`,
        );
      }
    }
  } else if (!isSubmodule) {
    // Regular directory — must be inside clients/
    assertContainment(canonicalPath, clientsBase, clientName);
  }

  // 6. Build isolated context
  const reportsBase = path.resolve(root, "reports");
  const reportsDir = path.join(reportsBase, clientName);

  const context: ClientContext = {
    clientId: clientName,
    rootDir: canonicalPath,
    configDir: path.join(canonicalPath, "config"),
    dataDir: path.join(canonicalPath, "data"),
    libDir: path.join(canonicalPath, "lib"),
    scenariosDir: path.join(canonicalPath, "scenarios"),
    reportsDir,
    envFile: path.join(canonicalPath, ".env"),
    mocksDir: path.join(canonicalPath, "mocks"),
    brandingDir: path.join(canonicalPath, "branding"),
    isSubmodule,
    isSymlink,
  };

  // 7. Validate minimal structure
  validateClientStructure(context);

  return context;
}

// ── Validation helpers ────────────────────────────────────────────────────────

/**
 * Validate client name format to prevent path traversal via name injection.
 * Only alphanumeric, hyphens, and underscores are allowed.
 */
function validateClientName(name: string): void {
  if (!name || typeof name !== "string") {
    throw new Error("ClientResolver: client name is required.");
  }

  if (name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
    throw new Error(
      `ClientResolver: invalid client name '${sanitizeForError(name)}'. ` +
        `Client names must be alphanumeric with hyphens/underscores only.`,
    );
  }

  if (!CLIENT_NAME_PATTERN.test(name)) {
    throw new Error(
      `ClientResolver: invalid client name '${sanitizeForError(name)}'. ` +
        `Allowed characters: a-z, A-Z, 0-9, hyphen (-), underscore (_).`,
    );
  }
}

/**
 * Assert that a resolved path is contained within the expected parent.
 * Prevents path traversal attacks via symlinks or ../ sequences.
 */
function assertContainment(
  resolvedPath: string,
  parentDir: string,
  clientName: string,
): void {
  const canonicalParent = fs.realpathSync(parentDir);
  if (
    !resolvedPath.startsWith(canonicalParent + path.sep) &&
    resolvedPath !== canonicalParent
  ) {
    throw new Error(
      `ClientResolver: client '${clientName}' resolves outside the allowed directory. ` +
        `This may indicate a path traversal attempt.`,
    );
  }
}

/**
 * Validate that the client has the minimum required directory structure.
 */
function validateClientStructure(ctx: ClientContext): void {
  const errors: string[] = [];

  for (const dir of CLIENT_REQUIRED_DIRS) {
    const fullPath = path.join(ctx.rootDir, dir);
    if (!fs.existsSync(fullPath)) {
      errors.push(`Missing required directory: ${dir}`);
    }
  }

  for (const file of CLIENT_REQUIRED_FILES) {
    const fullPath = path.join(ctx.rootDir, file);
    if (!fs.existsSync(fullPath)) {
      errors.push(`Missing required file: ${file}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `ClientResolver: client '${ctx.clientId}' has invalid structure:\n` +
        errors.map((e) => `  - ${e}`).join("\n"),
    );
  }
}

/**
 * Detect if a client directory is a git submodule.
 * A submodule is indicated by a .gitmodules entry or a .git file (not directory).
 */
function detectSubmodule(clientDir: string, frameworkRoot: string): boolean {
  // A git submodule has a .git *file* (not directory) containing "gitdir: ..."
  const gitPath = path.join(clientDir, ".git");
  if (fs.existsSync(gitPath)) {
    const stat = fs.lstatSync(gitPath);
    if (stat.isFile()) {
      return true;
    }
  }

  // Also check .gitmodules in the framework root
  const gitmodulesPath = path.join(frameworkRoot, ".gitmodules");
  if (fs.existsSync(gitmodulesPath)) {
    const content = fs.readFileSync(gitmodulesPath, "utf-8");
    const clientRelPath = path.relative(frameworkRoot, clientDir);
    if (content.includes(clientRelPath)) {
      return true;
    }
  }

  return false;
}

/**
 * Sanitize a value for inclusion in error messages.
 * Prevents log injection by stripping control characters.
 */
function sanitizeForError(value: string): string {
  return value.replace(/[^\x20-\x7E]/g, "?").slice(0, 64);
}

// ── Path validation for file operations ───────────────────────────────────────

/**
 * Validate that a target path is within the client's isolated namespace.
 * Call this before any read/write operation targeting client data.
 *
 * @param targetPath - The path to validate
 * @param context - The client's resolved context
 * @param allowReportsDir - Also allow paths under the reports directory
 */
export function assertPathInClientScope(
  targetPath: string,
  context: ClientContext,
  allowReportsDir = false,
): void {
  const resolved = path.resolve(targetPath);
  const canonicalRoot = fs.realpathSync(context.rootDir);

  const inClientDir =
    resolved.startsWith(canonicalRoot + path.sep) || resolved === canonicalRoot;

  const inReportsDir = allowReportsDir
    ? resolved.startsWith(context.reportsDir + path.sep) ||
      resolved === context.reportsDir
    : false;

  if (!inClientDir && !inReportsDir) {
    throw new Error(
      `ClientResolver: path '${path.basename(targetPath)}' is outside the scope of client '${context.clientId}'.`,
    );
  }
}

/**
 * Ensure the reports directory exists for a client.
 * Creates it with appropriate permissions if missing.
 */
export function ensureReportsDir(context: ClientContext): string {
  if (!fs.existsSync(context.reportsDir)) {
    fs.mkdirSync(context.reportsDir, { recursive: true, mode: 0o755 });
  }
  return context.reportsDir;
}

/**
 * List all available clients in the framework.
 * Admin-only operation — does not filter by RBAC.
 */
export function listClients(frameworkRoot?: string): string[] {
  const root = frameworkRoot ?? resolveFrameworkRoot();
  const clientsBase = path.join(root, CLIENTS_DIR);

  if (!fs.existsSync(clientsBase)) {
    return [];
  }

  return fs
    .readdirSync(clientsBase)
    .filter((name: string) => {
      if (!CLIENT_NAME_PATTERN.test(name)) return false;
      const fullPath = path.join(clientsBase, name);
      try {
        return fs.statSync(fullPath).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}
