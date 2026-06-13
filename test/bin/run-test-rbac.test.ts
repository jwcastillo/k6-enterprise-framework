/**
 * E2E tests for SEC-01/SEC-02 wiring — Phase 1 Plan 05
 *
 * Validates that bin/run-test.sh Step 2a (CLI auth) and Step 2b (RBAC)
 * correctly enforce gates and preserve bypass invariants for --dry-run
 * and --list-profiles.
 *
 * Uses spawnSync to spawn real scripts with controlled env vars and
 * RBAC fixture files (rbac-allow.json, rbac-deny.json).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const RUN_TEST = path.join(ROOT, "bin/run-test.sh");
const CHECK_RBAC = path.join(ROOT, "bin/check-rbac.js");
const CHECK_CLI_AUTH = path.join(ROOT, "bin/check-cli-auth.js");
const FIXTURES = path.join(ROOT, "test/fixtures");

// ── Temp client management ────────────────────────────────────────────────────

let tempClientDir: string;

beforeAll(() => {
  // Create a temp client under clients/ so run-test.sh and check-rbac.js can
  // resolve it. Uses a prefix that afterAll cleans up.
  tempClientDir = fs.mkdtempSync(path.join(ROOT, "clients/_test-phase01-"));
  fs.mkdirSync(path.join(tempClientDir, "config"), { recursive: true });
  fs.mkdirSync(path.join(tempClientDir, "scenarios", "api"), { recursive: true });
  // Minimal scenario stub (only needed for --dry-run paths that check file existence)
  fs.writeFileSync(
    path.join(tempClientDir, "scenarios", "api", "smoke.ts"),
    "export const options = { vus: 1, duration: '1s' };\nexport default function() {}\n"
  );
});

afterAll(() => {
  if (tempClientDir && fs.existsSync(tempClientDir)) {
    fs.rmSync(tempClientDir, { recursive: true, force: true });
  }
});

function clientId(): string {
  return path.basename(tempClientDir);
}

function setRbac(fixture: "rbac-allow.json" | "rbac-deny.json" | null): void {
  const target = path.join(tempClientDir, "config", "rbac.json");
  if (fixture === null) {
    if (fs.existsSync(target)) fs.unlinkSync(target);
  } else {
    fs.copyFileSync(path.join(FIXTURES, fixture), target);
  }
}

// ── bin/check-rbac.js (SEC-01) ────────────────────────────────────────────────

describe("bin/check-rbac.js (SEC-01)", () => {
  it("denies bob (developer) on breakpoint profile via rbac-deny fixture", () => {
    setRbac("rbac-deny.json");
    const res = spawnSync(
      "node",
      [
        CHECK_RBAC,
        `--client=${clientId()}`,
        "--profile=breakpoint",
        "--user=bob",
        `--root=${ROOT}`,
      ],
      { encoding: "utf-8" }
    );
    expect(res.status).toBe(1);
    const out = (res.stderr ?? "") + (res.stdout ?? "");
    expect(out).toMatch(/breakpoint|developer|Access denied|Permission/i);
  });

  it("allows alice (admin) on breakpoint profile via rbac-allow fixture", () => {
    setRbac("rbac-allow.json");
    const res = spawnSync(
      "node",
      [
        CHECK_RBAC,
        `--client=${clientId()}`,
        "--profile=breakpoint",
        "--user=alice",
        `--root=${ROOT}`,
      ],
      { encoding: "utf-8" }
    );
    expect(res.status).toBe(0);
  });

  it("allows bob (lead) on load profile via rbac-allow fixture", () => {
    setRbac("rbac-allow.json");
    const res = spawnSync(
      "node",
      [CHECK_RBAC, `--client=${clientId()}`, "--profile=load", "--user=bob", `--root=${ROOT}`],
      { encoding: "utf-8" }
    );
    expect(res.status).toBe(0);
  });

  it("fails closed when rbac.json missing and no override", () => {
    setRbac(null);
    const env = { ...process.env };
    delete env["K6_RBAC_PERMISSIVE"];
    const res = spawnSync(
      "node",
      [CHECK_RBAC, `--client=${clientId()}`, "--profile=smoke", "--user=alice", `--root=${ROOT}`],
      { encoding: "utf-8", env }
    );
    expect(res.status).toBe(1);
    const out = (res.stderr ?? "") + (res.stdout ?? "");
    expect(out).toMatch(/fail-closed|K6_RBAC_PERMISSIVE|rbac\.json/i);
  });

  it("allows with K6_RBAC_PERMISSIVE=true override when rbac.json missing", () => {
    setRbac(null);
    const res = spawnSync(
      "node",
      [CHECK_RBAC, `--client=${clientId()}`, "--profile=smoke", "--user=alice", `--root=${ROOT}`],
      {
        encoding: "utf-8",
        env: { ...process.env, K6_RBAC_PERMISSIVE: "true" },
      }
    );
    expect(res.status).toBe(0);
  });
});

// ── bin/check-cli-auth.js (SEC-02) ───────────────────────────────────────────

describe("bin/check-cli-auth.js (SEC-02)", () => {
  it("exits 0 when K6_AUTH_TOKEN unset (permissive mode)", () => {
    const env = { ...process.env };
    delete env["K6_AUTH_TOKEN"];
    delete env["K6_AUTH_TOKEN_PROVIDED"];
    const res = spawnSync("node", [CHECK_CLI_AUTH], { encoding: "utf-8", env });
    expect(res.status).toBe(0);
  });

  it("exits 1 when K6_AUTH_TOKEN set but no token provided", () => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      K6_AUTH_TOKEN: "k6tok_secret_" + "a".repeat(32),
    };
    delete env["K6_AUTH_TOKEN_PROVIDED"];
    const res = spawnSync("node", [CHECK_CLI_AUTH], { encoding: "utf-8", env });
    expect(res.status).toBe(1);
    const out = res.stderr ?? "";
    expect(out).toMatch(/K6_AUTH_TOKEN|Auth/i);
  });

  it("exits 0 when token provided matches K6_AUTH_TOKEN", () => {
    const tok = "k6tok_secret_" + "a".repeat(32);
    const res = spawnSync("node", [CHECK_CLI_AUTH, `--token=${tok}`], {
      encoding: "utf-8",
      env: { ...process.env, K6_AUTH_TOKEN: tok },
    });
    expect(res.status).toBe(0);
  });

  it("exits 1 when provided token mismatches K6_AUTH_TOKEN", () => {
    const tok = "k6tok_secret_" + "a".repeat(32);
    const wrong = "k6tok_secret_" + "b".repeat(32);
    const res = spawnSync("node", [CHECK_CLI_AUTH, `--token=${wrong}`], {
      encoding: "utf-8",
      env: { ...process.env, K6_AUTH_TOKEN: tok },
    });
    expect(res.status).toBe(1);
  });

  it("exits 0 when token provided via K6_AUTH_TOKEN_PROVIDED env", () => {
    const tok = "k6tok_secret_" + "c".repeat(32);
    const res = spawnSync("node", [CHECK_CLI_AUTH], {
      encoding: "utf-8",
      env: { ...process.env, K6_AUTH_TOKEN: tok, K6_AUTH_TOKEN_PROVIDED: tok },
    });
    expect(res.status).toBe(0);
  });
});

// ── bin/run-test.sh Step 2a/2b wiring (bypass invariants) ────────────────────

describe("bin/run-test.sh Step 2a/2b wiring", () => {
  it("--dry-run skips Step 2a/6 and Step 2b/6 (existing short-circuit preserved)", () => {
    // No rbac.json — would fail-closed if checks ran
    setRbac(null);
    const res = spawnSync(
      "bash",
      [
        RUN_TEST,
        `--client=${clientId()}`,
        "--scenario=api/smoke", // no .ts extension — run-test.sh adds it
        "--profile=smoke",
        "--dry-run",
      ],
      {
        encoding: "utf-8",
        env: { ...process.env },
      }
    );
    // --dry-run exits at line ~715 before any STEP — should be exit 0
    expect(res.status).toBe(0);
    const out = (res.stdout ?? "") + (res.stderr ?? "");
    expect(out).not.toMatch(/Step 2a\/6/);
    expect(out).not.toMatch(/Step 2b\/6/);
  });

  it("--list-profiles skips Step 2a/6 and Step 2b/6", () => {
    const res = spawnSync("bash", [RUN_TEST, "--list-profiles"], { encoding: "utf-8" });
    expect(res.status).toBe(0);
    const out = (res.stdout ?? "") + (res.stderr ?? "");
    expect(out).not.toMatch(/Step 2a\/6/);
    expect(out).not.toMatch(/Step 2b\/6/);
  });

  it("--help shows --auth-token flag", () => {
    const res = spawnSync("bash", [RUN_TEST, "--help"], { encoding: "utf-8" });
    expect(res.status).toBe(0);
    const out = (res.stdout ?? "") + (res.stderr ?? "");
    expect(out).toMatch(/auth-token/);
  });
});
