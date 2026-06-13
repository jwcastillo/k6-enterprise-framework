/**
 * Phase 5 / AI-03 (D-11): healing-diff unit tests.
 *
 * Covers all six behaviors from the plan with small (≤5-line) fixtures.
 */

import { describe, it, expect } from "vitest";
import { computeUnifiedDiff } from "../../../src/ai/adaptive/healing-diff";

describe("computeUnifiedDiff (AI-03 D-11)", () => {
  it("identical inputs return an empty string", () => {
    expect(computeUnifiedDiff("a\nb\nc", "a\nb\nc", "x.ts", "x.fixed.ts")).toBe("");
    expect(computeUnifiedDiff("", "", "x.ts", "x.fixed.ts")).toBe("");
  });

  it("emits the git-style header with both paths", () => {
    const out = computeUnifiedDiff("a", "b", "src/a.ts", "tmp/a.fixed.ts");
    expect(out.startsWith("diff --git a/src/a.ts b/tmp/a.fixed.ts\n")).toBe(true);
    expect(out).toContain("--- a/src/a.ts\n");
    expect(out).toContain("+++ b/tmp/a.fixed.ts\n");
  });

  it("single-line change produces context, removed, and added lines", () => {
    const out = computeUnifiedDiff("a\nb\nc", "a\nB\nc", "x.ts", "x.fixed.ts");
    expect(out).toContain("@@");
    expect(out).toContain(" a");
    expect(out).toContain("-b");
    expect(out).toContain("+B");
    expect(out).toContain(" c");
  });

  it("added line at end produces a '+' entry", () => {
    const out = computeUnifiedDiff("a", "a\nnew", "x.ts", "x.fixed.ts");
    expect(out).toContain(" a");
    expect(out).toContain("+new");
    // No removal lines in the body (excluding the --- header)
    const removals = out.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"));
    expect(removals.length).toBe(0);
  });

  it("removed line produces a '-' entry", () => {
    const out = computeUnifiedDiff("a\nb", "a", "x.ts", "x.fixed.ts");
    expect(out).toContain(" a");
    expect(out).toContain("-b");
    // No '+' lines should appear (other than the +++ header)
    const additions = out.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));
    expect(additions.length).toBe(0);
  });

  it("trailing newline on input does NOT emit a spurious blank-line diff", () => {
    const out = computeUnifiedDiff("a\nb\n", "a\nB\n", "x.ts", "x.fixed.ts");
    // The diff should NOT contain a stray ' ' (context for empty trailing line)
    // followed by '-' or '+' for empty strings.
    expect(out).not.toContain(" \n");
    expect(out).toContain("-b");
    expect(out).toContain("+B");
  });

  it("is deterministic — same input yields same output", () => {
    const a = computeUnifiedDiff("foo\nbar", "foo\nBAR", "p.ts", "p.fixed.ts");
    const b = computeUnifiedDiff("foo\nbar", "foo\nBAR", "p.ts", "p.fixed.ts");
    expect(a).toBe(b);
  });

  it("hunk header reflects accurate old/new line counts", () => {
    // 2 old (a, b), 3 new (a, B, c) → @@ -1,2 +1,3 @@
    const out = computeUnifiedDiff("a\nb", "a\nB\nc", "x.ts", "x.fixed.ts");
    expect(out).toContain("@@ -1,2 +1,3 @@");
  });
});
