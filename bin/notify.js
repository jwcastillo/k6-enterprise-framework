#!/usr/bin/env node
/**
 * T-151: Post-run notification sender
 *
 * Sends test result notifications to a webhook (Slack-compatible incoming webhook,
 * Microsoft Teams, or generic HTTP POST).
 *
 * Usage:
 *   node bin/notify.js --result=reports/summary.json --webhook=https://...
 *   node bin/notify.js --result=reports/summary.json --webhook=https://... --platform=teams
 *   node bin/notify.js --help
 *
 * Supported platforms:
 *   slack  — Slack incoming webhook (default)
 *   teams  — Microsoft Teams incoming webhook
 *   generic — plain JSON POST
 *
 * Exit codes:
 *   0  — notification sent (or dry-run)
 *   1  — error sending notification
 */

"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const { URL } = require("url");

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(name) {
  const prefix = `--${name}=`;
  const match = args.find((a) => a.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function hasFlag(name) {
  return args.includes(`--${name}`);
}

if (hasFlag("help") || args.includes("-h")) {
  require("./_help").printHelp({
    name: "notify",
    description: "Send test result notifications to a webhook — slack | teams | generic (T-151)",
    usage: "node bin/notify.js --result=<file> --webhook=<url> [options]",
    flags: [
      { flag: "--result=<file>", description: "Path to k6 summary JSON or summary.txt (required)" },
      {
        flag: "--webhook=<url>",
        description: "Webhook URL to POST results to (required unless --dry-run)",
      },
      { flag: "--platform=<name>", description: "slack | teams | generic (default: slack)" },
      { flag: "--title=<text>", description: "Custom notification title" },
      { flag: "--dry-run", description: "Print payload without sending" },
      { flag: "--help, -h", description: "Show this help and exit" },
    ],
    examples: [
      "node bin/notify.js --result=reports/summary.json --webhook=https://hooks.slack.com/services/...",
      "node bin/notify.js --result=reports/summary.json --webhook=https://... --platform=teams --title='Nightly run'",
    ],
  });
  process.exit(0);
}

const resultFile = getArg("result");
const webhookUrl = getArg("webhook");
const platform = (getArg("platform") || "slack").toLowerCase();
const customTitle = getArg("title");
const dryRun = hasFlag("dry-run");

if (!resultFile) {
  console.error("[notify] --result is required.");
  process.exit(1);
}

if (!webhookUrl && !dryRun) {
  console.error("[notify] --webhook is required (or use --dry-run).");
  process.exit(1);
}

// ── Load result ───────────────────────────────────────────────────────────────

let resultData = {};
let resultText = "";

if (resultFile.endsWith(".txt")) {
  try {
    resultText = fs.readFileSync(resultFile, "utf-8");
  } catch (err) {
    console.error(`[notify] Cannot read ${resultFile}: ${err.message}`);
    process.exit(1);
  }
} else {
  try {
    resultData = JSON.parse(fs.readFileSync(resultFile, "utf-8"));
  } catch (err) {
    console.error(`[notify] Cannot parse ${resultFile}: ${err.message}`);
    process.exit(1);
  }
}

// Extract key metrics
const metrics = resultData.metrics || resultData.summary?.metrics || {};
const dur = (metrics.http_req_duration || {}).values || {};
const reqs = (metrics.http_reqs || {}).values || {};
const failed = (metrics.http_req_failed || {}).values || {};
const checks = (metrics.checks || {}).values || {};

// Detect result status from filename or data
const runId = path.basename(resultFile, path.extname(resultFile));
const title = customTitle || `k6 Load Test — ${runId}`;

const p95 = dur["p(95)"] !== undefined ? `${dur["p(95)"].toFixed(0)}ms` : "N/A";
const errorRate = failed.rate !== undefined ? `${(failed.rate * 100).toFixed(2)}%` : "N/A";
const checkRate = checks.rate !== undefined ? `${(checks.rate * 100).toFixed(2)}%` : "N/A";
const reqCount = reqs.count !== undefined ? reqs.count : "N/A";
const reqRate = reqs.rate !== undefined ? `${reqs.rate.toFixed(1)} req/s` : "N/A";

// Determine pass/fail color
const isError = failed.rate !== undefined && failed.rate > 0.05;
const color = isError ? "danger" : "good";
const icon = isError ? "❌" : "✅";
const statusText = isError ? "ISSUES DETECTED" : "PASSED";

// ── Build payload ─────────────────────────────────────────────────────────────

function buildSlackPayload() {
  return {
    text: `${icon} *${title}*`,
    attachments: [
      {
        color,
        fields: [
          { title: "Status", value: statusText, short: true },
          { title: "p95 Response", value: p95, short: true },
          { title: "Error Rate", value: errorRate, short: true },
          { title: "Check Pass Rate", value: checkRate, short: true },
          { title: "Total Requests", value: String(reqCount), short: true },
          { title: "Request Rate", value: reqRate, short: true },
        ],
        footer: `k6 Enterprise Framework • ${new Date().toISOString()}`,
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  };
}

function buildTeamsPayload() {
  return {
    "@type": "MessageCard",
    "@context": "http://schema.org/extensions",
    themeColor: isError ? "FF0000" : "00B050",
    summary: title,
    sections: [
      {
        activityTitle: `${icon} ${title}`,
        activitySubtitle: `Status: **${statusText}**`,
        facts: [
          { name: "p95 Response", value: p95 },
          { name: "Error Rate", value: errorRate },
          { name: "Check Pass Rate", value: checkRate },
          { name: "Total Requests", value: String(reqCount) },
          { name: "Request Rate", value: reqRate },
        ],
        markdown: true,
      },
    ],
  };
}

function buildGenericPayload() {
  return {
    title,
    status: statusText,
    timestamp: new Date().toISOString(),
    metrics: { p95, errorRate, checkRate, reqCount, reqRate },
    raw: resultText || undefined,
  };
}

let payload;
if (platform === "teams") payload = buildTeamsPayload();
else if (platform === "generic") payload = buildGenericPayload();
else payload = buildSlackPayload();

const body = JSON.stringify(payload);

// ── Send ──────────────────────────────────────────────────────────────────────

if (dryRun) {
  console.log("[notify] Dry-run — payload that would be sent:");
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

function postWebhook(urlStr, bodyStr) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(urlStr);
    } catch (err) {
      reject(new Error(`Invalid webhook URL: ${err.message}`));
      return;
    }

    const lib = parsedUrl.protocol === "https:" ? https : http;
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(bodyStr),
        "User-Agent": "k6-enterprise-framework/0.1.0",
      },
      timeout: 10000,
    };

    const req = lib.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, body: data });
        } else {
          reject(new Error(`Webhook returned HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Webhook request timed out"));
    });
    req.write(bodyStr);
    req.end();
  });
}

(async () => {
  try {
    const result = await postWebhook(webhookUrl, body);
    console.log(`[notify] ✓ Notification sent (HTTP ${result.status})`);
    process.exit(0);
  } catch (err) {
    console.error(`[notify] ✗ Failed to send notification: ${err.message}`);
    process.exit(1);
  }
})();
