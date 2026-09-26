/**
 * bin/detect-secrets.sh: patterns that start with "-" (the private-key header)
 * used to be parsed by grep as options, so that check silently never ran.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const SCRIPT = path.join(ROOT, "bin/detect-secrets.sh");
const DIR_NAME = ".tmp-detect-secrets-test";
const DIR = path.join(ROOT, DIR_NAME);

// Built by concatenation so this test file itself does not trip secret scanners.
const PEM_HEADER = "-----BEGIN " + "RSA PRIVATE KEY-----";

describe("bin/detect-secrets.sh", () => {
  beforeAll(() => {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, "key.ts"), `const key = \`${PEM_HEADER}\nMIIE...\`;\n`);
  });

  afterAll(() => fs.rmSync(DIR, { recursive: true, force: true }));

  it("detects a private key header (pattern starting with '-')", () => {
    const res = spawnSync("bash", [SCRIPT, DIR_NAME], { encoding: "utf-8", cwd: ROOT });
    expect(res.stdout).toContain("PRIVATE KEY");
    expect(res.status).toBe(1);
  });

  it("parses its password pattern (the script used to abort with 'bad substitution')", () => {
    fs.rmSync(path.join(DIR, "key.ts"));
    fs.writeFileSync(path.join(DIR, "cfg.json"), `{ "pass` + `word": "hunter2hunter2" }\n`);
    const res = spawnSync("bash", [SCRIPT, DIR_NAME], { encoding: "utf-8", cwd: ROOT });
    expect(res.stderr).not.toContain("substitution");
    expect(res.stdout).toContain("cfg.json");
    expect(res.status).toBe(1);
  });
});
