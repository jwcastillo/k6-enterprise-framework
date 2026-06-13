/**
 * T-067: MCP Tools
 *
 * run_test        — execute a k6 test via run-test.sh
 * validate_schema — validate a config file against JSON schema
 * generate_scaffold — create a client/test/service via scaffolder
 */

import { join, resolve, relative } from "path";
import { existsSync, readFileSync, readdirSync } from "fs";
import {
  FRAMEWORK_ROOT,
  BIN_DIR,
  validateClientExists,
  sanitizeArg,
  runCliCommand,
  mcpError,
  formatError,
} from "../utils/framework.js";

// ── Concurrency guard: one test per client+scenario at a time ─────────────────

const runningTests = new Set<string>();

// ── run_test ──────────────────────────────────────────────────────────────────

export interface RunTestParams {
  client: string;
  test: string;
  profile?: string;
  env?: string;
}

export interface RunTestResult {
  status: "pass" | "fail";
  exitCode: number;
  output: string;
  reportPath: string | null;
}

export function runTest(params: RunTestParams): RunTestResult {
  try {
    const { client, test, profile = "smoke", env = "default" } = params;

    // Validate and sanitize — prevent shell injection (CHK-SEC-110)
    validateClientExists(client);
    const safeClient = sanitizeArg(client);
    const safeTest = sanitizeArg(test);
    const safeProfile = sanitizeArg(profile);
    const safeEnv = sanitizeArg(env);

    const lockKey = `${safeClient}:${safeTest}`;
    if (runningTests.has(lockKey)) {
      throw mcpError(
        "ALREADY_RUNNING",
        `Test '${safeTest}' for client '${safeClient}' is already running.`,
        { lockKey }
      );
    }

    runningTests.add(lockKey);
    try {
      const runTestSh = join(BIN_DIR, "run-test.sh");
      const cmd = `bash "${runTestSh}" --client="${safeClient}" --scenario="${safeTest}" --profile="${safeProfile}" --env="${safeEnv}"`;

      const { stdout, stderr, exitCode } = runCliCommand(cmd, FRAMEWORK_ROOT);
      const output = stdout + (stderr ? `\n[stderr]\n${stderr}` : "");

      // Try to find the generated report
      const reportsBase = join(FRAMEWORK_ROOT, "reports", safeClient, safeTest);
      let reportPath: string | null = null;
      if (existsSync(reportsBase)) {
        const dirs = readdirSync(reportsBase).sort().reverse();
        if (dirs[0]) reportPath = join(reportsBase, dirs[0]);
      }

      return {
        status: exitCode === 0 ? "pass" : "fail",
        exitCode,
        output: output.slice(0, 8000), // cap output size
        reportPath,
      };
    } finally {
      runningTests.delete(lockKey);
    }
  } catch (err) {
    throw formatError(err);
  }
}

// ── validate_schema ───────────────────────────────────────────────────────────

export interface ValidateSchemaParams {
  file: string; // absolute or relative-to-framework-root path
}

export interface ValidateSchemaResult {
  valid: boolean;
  errors: Array<{ path: string; message: string }>;
}

export async function validateSchema(params: ValidateSchemaParams): Promise<ValidateSchemaResult> {
  try {
    const { file } = params;

    // Resolve path safely
    const absFile = resolve(FRAMEWORK_ROOT, file);
    if (!absFile.startsWith(FRAMEWORK_ROOT)) {
      throw mcpError("INVALID_PARAMS", "File path must be within the framework directory.");
    }
    if (!existsSync(absFile)) {
      throw mcpError("NOT_FOUND", `File not found: ${relative(FRAMEWORK_ROOT, absFile)}`);
    }

    // Dynamically import Ajv (available in k6-framework/node_modules via relative path)
    const Ajv = (await import("ajv")).default;
    const addFormats = (await import("ajv-formats")).default;
    const ajv = new Ajv({ allErrors: true });
    addFormats(ajv);

    const schemasDir = join(FRAMEWORK_ROOT, "shared", "schemas");
    const content = JSON.parse(readFileSync(absFile, "utf-8"));

    // Try each schema; use the one with fewest errors
    const schemaFiles = readdirSync(schemasDir).filter((f) => f.endsWith(".json"));

    let bestResult: ValidateSchemaResult = {
      valid: false,
      errors: [{ path: "", message: "No matching schema found" }],
    };
    let minErrors = Infinity;

    for (const schemaFile of schemaFiles) {
      const schema = JSON.parse(readFileSync(join(schemasDir, schemaFile), "utf-8"));
      const validate = ajv.compile(schema);
      const valid = validate(content);

      if (valid) {
        return { valid: true, errors: [] };
      }

      const errCount = validate.errors?.length ?? Infinity;
      if (errCount < minErrors) {
        minErrors = errCount;
        bestResult = {
          valid: false,
          errors: (validate.errors ?? []).map((e) => ({
            path: e.instancePath || "/",
            message: e.message ?? "unknown error",
          })),
        };
      }
    }

    return bestResult;
  } catch (err) {
    throw formatError(err);
  }
}

// ── generate_scaffold ─────────────────────────────────────────────────────────

export interface GenerateScaffoldParams {
  name: string;
  type: "client" | "test" | "service" | "factory";
  client?: string; // required for test/service/factory
}

export interface GenerateScaffoldResult {
  created: string[];
}

export function generateScaffold(params: GenerateScaffoldParams): GenerateScaffoldResult {
  try {
    const { name, type, client } = params;

    sanitizeArg(name);
    if (client) sanitizeArg(client);

    let cmd: string;

    if (type === "client") {
      cmd = `bash "${join(BIN_DIR, "create-client.sh")}" "${name}"`;
    } else {
      if (!client) {
        throw mcpError("INVALID_PARAMS", `--client is required for type '${type}'`);
      }
      validateClientExists(client);
      // Use generate.js in non-interactive mode via env vars
      cmd = `node "${join(BIN_DIR, "generate.js")}" --non-interactive --type="${type}" --client="${client}" --name="${name}"`;
    }

    const { stdout, exitCode } = runCliCommand(cmd, FRAMEWORK_ROOT);

    if (exitCode !== 0) {
      throw mcpError(
        "SCAFFOLD_FAILED",
        `Scaffold command failed (exit ${exitCode}): ${stdout.slice(0, 500)}`
      );
    }

    // Extract created file paths from stdout
    const created = stdout
      .split("\n")
      .filter((l) => l.includes("clients/") || l.includes("mcp-server/"))
      .map((l) => l.trim())
      .filter(Boolean);

    return { created };
  } catch (err) {
    throw formatError(err);
  }
}
