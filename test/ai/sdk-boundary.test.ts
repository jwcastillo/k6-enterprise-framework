/**
 * Phase 5 / AI-01 (D-02): SDK boundary smoke test.
 *
 * Asserts that only the documented set of source files imports @anthropic-ai/sdk.
 * When 05-03 refactors the agents, remove the 4 agent entries.
 * When 05-04 refactors self-healing, remove self-healing.ts.
 * Eventually only anthropic-provider.ts remains.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ── Allow-list ────────────────────────────────────────────────────────────────

// Files currently allowed to import @anthropic-ai/sdk.
// Sorted alphabetically by relative path from src/.
// (The v0.3.0 POC at src/ai/poc/ai-stack-poc.ts was archived to archive/ai-poc/
//  in v0.4.0 Phase 07 LINT-03 and is no longer in src/ scope.)
const EXPECTED_SDK_IMPORTERS = [
  // Permanent — the ONE allowed file. Phase 5 / AI-01 / D-02 contract.
  "src/ai/core/providers/anthropic-provider.ts",
].sort();

// ── File scanner ──────────────────────────────────────────────────────────────

function findTsFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules") continue; // skip deps
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findTsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      results.push(fullPath);
    }
  }
  return results;
}

// ── Test ──────────────────────────────────────────────────────────────────────

describe("SDK boundary: @anthropic-ai/sdk importers", () => {
  it("only the documented allow-list imports @anthropic-ai/sdk", () => {
    // Resolve the src/ directory relative to the test file
    const projectRoot = path.resolve(__dirname, "../../");
    const srcDir = path.join(projectRoot, "src");

    const allFiles = findTsFiles(srcDir);

    // Find files that import @anthropic-ai/sdk
    const importers: string[] = [];
    for (const file of allFiles) {
      const content = fs.readFileSync(file, "utf-8");
      if (content.includes("@anthropic-ai/sdk")) {
        // Record relative path from project root
        importers.push(path.relative(projectRoot, file));
      }
    }

    const sortedImporters = importers.sort();

    expect(sortedImporters).toEqual(EXPECTED_SDK_IMPORTERS);
  });
});
