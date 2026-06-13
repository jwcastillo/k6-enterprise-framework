#!/usr/bin/env node
/**
 * Phase 6 / DX-01 (D-01..D-03): Shared --help renderer for bin/*.js scripts.
 *
 * Pure Node stdlib — no chalk, no commander. Caller controls process.exit.
 *
 * Layout:
 *   <name> — <description>
 *
 *   Usage:
 *     <usage>
 *
 *   Options:
 *     --flag-a              description aligned to longest flag
 *     --flag-b              ...
 *
 *   Examples:
 *     1. node bin/<name>.js --flag-a value
 *     2. node bin/<name>.js --flag-a value --flag-b other
 */

"use strict";

/**
 * @typedef {Object} HelpSpec
 * @property {string} name        Script name (e.g. "generate-report")
 * @property {string} description One-line summary shown after the banner
 * @property {string} usage       Usage line (e.g. "node bin/generate-report.js [options]")
 * @property {Array<{flag: string, description: string}>} flags
 * @property {Array<string>} examples
 */

/**
 * Renders the standard --help banner to stdout.
 *
 * The caller is responsible for `process.exit(0)` after invoking this — the
 * helper never exits the process itself.
 *
 * @param {HelpSpec} spec
 * @returns {void}
 */
function printHelp(spec) {
  if (!spec || typeof spec !== "object") {
    throw new TypeError("printHelp: spec object is required");
  }
  const { name, description, usage, flags, examples } = spec;
  if (typeof name !== "string" || !name) throw new TypeError("printHelp: name is required");
  if (typeof description !== "string") throw new TypeError("printHelp: description must be a string");
  if (typeof usage !== "string" || !usage) throw new TypeError("printHelp: usage is required");
  if (!Array.isArray(flags)) throw new TypeError("printHelp: flags must be an array");
  if (!Array.isArray(examples)) throw new TypeError("printHelp: examples must be an array");

  const lines = [];
  lines.push(`${name} — ${description}`);
  lines.push("");
  lines.push("Usage:");
  lines.push(`  ${usage}`);

  if (flags.length > 0) {
    lines.push("");
    lines.push("Options:");
    const longest = flags.reduce((acc, f) => Math.max(acc, (f.flag || "").length), 0);
    for (const f of flags) {
      const flagText = String(f.flag || "");
      const desc = String(f.description || "");
      lines.push(`  ${flagText.padEnd(longest, " ")}    ${desc}`);
    }
  }

  if (examples.length > 0) {
    lines.push("");
    lines.push("Examples:");
    examples.forEach((ex, i) => {
      lines.push(`  ${i + 1}. ${ex}`);
    });
  }

  process.stdout.write(lines.join("\n") + "\n");
}

module.exports = { printHelp };
