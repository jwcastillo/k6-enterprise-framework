/** Phase 5 / AI-06 / D-24: assert .env.example documents every AI env var. */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ENV_EXAMPLE = fs.readFileSync(path.join(process.cwd(), ".env.example"), "utf8");
const LINES = ENV_EXAMPLE.split("\n");

const AI_VARS = [
  "ANTHROPIC_API_KEY",
  "LLM_API_KEY",
  "CHROMA_HOST",
  "CHROMA_PORT",
  "K6_AI_REQUIRE_RAG",
  "K6_AI_AUTO_APPLY",
  "LLM_INPUT_USD_PER_1K",
  "LLM_OUTPUT_USD_PER_1K",
];

describe(".env.example AI section (Phase 5 / AI-06 / D-23, D-24)", () => {
  it("contains the '# === AI Module ===' header", () => {
    expect(ENV_EXAMPLE).toContain("# === AI Module ===");
  });

  for (const v of AI_VARS) {
    it(`documents ${v} as a key=value line`, () => {
      const re = new RegExp(`^${v}=`, "m");
      expect(re.test(ENV_EXAMPLE)).toBe(true);
    });

    it(`has at least one comment line within 5 lines preceding ${v}`, () => {
      const idx = LINES.findIndex((l) => l.startsWith(`${v}=`));
      expect(idx).toBeGreaterThan(-1);
      const window = LINES.slice(Math.max(0, idx - 5), idx);
      expect(window.some((l) => l.trimStart().startsWith("#"))).toBe(true);
    });
  }
});
