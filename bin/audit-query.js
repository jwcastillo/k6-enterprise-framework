#!/usr/bin/env node
/**
 * T-043: Audit log query and export CLI
 *
 * Usage:
 *   node bin/audit-query.js --client myapp --from 2026-01-01 --to 2026-02-28
 *   node bin/audit-query.js --client myapp --type execution --user john --format csv
 *
 * Formats: table (default), json, csv
 */

"use strict";

const path = require("path");
const fs = require("fs");

// ── Argument parsing ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const opts = {
  client: null,
  from: null,
  to: null,
  type: null,
  user: null,
  service: null,
  result: null,
  format: "table",
  limit: 0,
};

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case "--client":
      opts.client = args[++i];
      break;
    case "--from":
      opts.from = args[++i];
      break;
    case "--to":
      opts.to = args[++i];
      break;
    case "--type":
      opts.type = args[++i];
      break;
    case "--user":
      opts.user = args[++i];
      break;
    case "--service":
      opts.service = args[++i];
      break;
    case "--result":
      opts.result = args[++i];
      break;
    case "--format":
      opts.format = args[++i];
      break;
    case "--limit":
      opts.limit = parseInt(args[++i], 10);
      break;
    case "--help":
    case "-h":
      require("./_help").printHelp({
        name: "audit-query",
        description: "Query and export the audit log (T-043)",
        usage: "node bin/audit-query.js --client <name> [options]",
        flags: [
          { flag: "--client <name>", description: "Client to query (required)" },
          { flag: "--from <date>", description: "Start date (ISO 8601, e.g. 2026-01-01)" },
          { flag: "--to <date>", description: "End date (ISO 8601, e.g. 2026-02-28)" },
          {
            flag: "--type <type>",
            description:
              "Filter by event type (execution_start, execution_end, config_change, ...)",
          },
          { flag: "--user <id>", description: "Filter by actor" },
          { flag: "--service <name>", description: "Filter by service" },
          {
            flag: "--result <status>",
            description: "Filter by result (success, failure, warning, denied)",
          },
          { flag: "--format <fmt>", description: "Output format: table (default), json, csv" },
          { flag: "--limit <n>", description: "Maximum entries to return (0 = all)" },
          { flag: "--help, -h", description: "Show this help and exit" },
        ],
        examples: [
          "node bin/audit-query.js --client myapp --from 2026-01-01 --to 2026-02-28",
          "node bin/audit-query.js --client myapp --type execution_start --format csv --limit 100",
        ],
      });
      process.exit(0);
  }
}

if (!opts.client) {
  console.error("Error: --client is required. Use --help for usage.");
  process.exit(1);
}

// ── Query execution ───────────────────────────────────────────────────────────

const ROOT_DIR = path.resolve(__dirname, "..");
const auditDir = path.join(ROOT_DIR, "reports", opts.client, "audit");

if (!fs.existsSync(auditDir)) {
  console.error(`No audit logs found for client '${opts.client}'.`);
  process.exit(1);
}

// Read all matching audit files
const files = fs
  .readdirSync(auditDir)
  .filter((f) => f.startsWith("audit-") && f.endsWith(".jsonl"))
  .sort();

const entries = [];

for (const file of files) {
  // Quick month filter by filename
  if (opts.from || opts.to) {
    const fileMonth = file.replace("audit-", "").replace(".jsonl", "");
    if (opts.from && fileMonth < opts.from.slice(0, 7)) continue;
    if (opts.to && fileMonth > opts.to.slice(0, 7)) continue;
  }

  const content = fs.readFileSync(path.join(auditDir, file), "utf-8").trim();
  if (!content) continue;

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);

      // Apply filters
      if (opts.from && entry.timestamp < opts.from) continue;
      if (opts.to && entry.timestamp > opts.to) continue;
      if (opts.type && entry.event !== opts.type) continue;
      if (opts.user && entry.actor !== opts.user) continue;
      if (opts.service && entry.service !== opts.service) continue;
      if (opts.result && entry.result !== opts.result) continue;

      entries.push(entry);

      if (opts.limit > 0 && entries.length >= opts.limit) break;
    } catch {
      // Skip corrupted lines
    }
  }

  if (opts.limit > 0 && entries.length >= opts.limit) break;
}

// ── Output formatting ─────────────────────────────────────────────────────────

if (entries.length === 0) {
  console.log("No matching audit entries found.");
  process.exit(0);
}

switch (opts.format) {
  case "json":
    console.log(JSON.stringify(entries, null, 2));
    break;

  case "csv": {
    const headers = [
      "timestamp",
      "event",
      "actor",
      "client",
      "service",
      "environment",
      "result",
      "message",
    ];
    console.log(headers.join(","));
    for (const e of entries) {
      const row = headers.map((h) => {
        const val = e[h] ?? "";
        const str = String(val).replace(/"/g, '""');
        return str.includes(",") || str.includes('"') ? `"${str}"` : str;
      });
      console.log(row.join(","));
    }
    break;
  }

  case "table":
  default: {
    // Column widths
    const cols = {
      timestamp: 20,
      event: 18,
      actor: 12,
      result: 8,
      message: 50,
    };

    // Header
    const header = [
      "TIMESTAMP".padEnd(cols.timestamp),
      "EVENT".padEnd(cols.event),
      "ACTOR".padEnd(cols.actor),
      "RESULT".padEnd(cols.result),
      "MESSAGE",
    ].join(" | ");
    console.log(header);
    console.log("-".repeat(header.length));

    for (const e of entries) {
      const row = [
        (e.timestamp || "").slice(0, cols.timestamp).padEnd(cols.timestamp),
        (e.event || "").padEnd(cols.event),
        (e.actor || "").slice(0, cols.actor).padEnd(cols.actor),
        (e.result || "").padEnd(cols.result),
        (e.message || "").slice(0, cols.message),
      ].join(" | ");
      console.log(row);
    }

    console.log(`\n${entries.length} entries found.`);
    break;
  }
}
