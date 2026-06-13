/** Phase 5 / AI-03 (D-11): unified diff for SelfHealing fix candidates. */

type EditOp = " " | "-" | "+";
interface EditLine {
  op: EditOp;
  text: string;
}

/**
 * Compute a unified-diff string between `originalText` and `fixedText`.
 *
 * Returns `""` when inputs are identical. Output starts with
 * `diff --git a/<originalPath> b/<fixedPath>\n--- a/<originalPath>\n+++ b/<fixedPath>\n`
 * followed by one or more hunks. Hand-rolled (no `diff` dependency) per D-11.
 */
export function computeUnifiedDiff(
  originalText: string,
  fixedText: string,
  originalPath: string,
  fixedPath: string
): string {
  if (originalText === fixedText) return "";

  const a = splitLines(originalText);
  const b = splitLines(fixedText);
  const script = buildEditScript(a, b);

  // One-hunk-per-diff format: covers all edits in a single hunk.
  // For small fixes (the SelfHealing use case) this is sufficient and
  // keeps the implementation under the LOC budget.
  let oldLen = 0;
  let newLen = 0;
  for (const e of script) {
    if (e.op !== "+") oldLen++;
    if (e.op !== "-") newLen++;
  }

  const header =
    `diff --git a/${originalPath} b/${fixedPath}\n` +
    `--- a/${originalPath}\n` +
    `+++ b/${fixedPath}\n` +
    `@@ -${oldLen === 0 ? 0 : 1},${oldLen} +${newLen === 0 ? 0 : 1},${newLen} @@\n`;

  const body = script.map((e) => `${e.op}${e.text}`).join("\n");
  return header + body + "\n";
}

// ─── internals ───────────────────────────────────────────────────────────────

function splitLines(text: string): string[] {
  const parts = text.split("\n");
  // Drop the trailing empty token when text ends with "\n" so we don't
  // emit a spurious blank-line diff entry.
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

function buildEditScript(a: string[], b: string[]): EditLine[] {
  // LCS table.
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack to produce the edit script (forward order).
  const reversed: EditLine[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      reversed.push({ op: " ", text: a[i - 1] });
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      reversed.push({ op: "-", text: a[i - 1] });
      i--;
    } else {
      reversed.push({ op: "+", text: b[j - 1] });
      j--;
    }
  }
  while (i > 0) {
    reversed.push({ op: "-", text: a[i - 1] });
    i--;
  }
  while (j > 0) {
    reversed.push({ op: "+", text: b[j - 1] });
    j--;
  }
  return reversed.reverse();
}
