#!/usr/bin/env node
// bin/triage-failures.js — who owns the failures of a run: the system under test,
// the test itself, or the environment.
//
// Groups the error/warning lines of a k6-execution-*.log into redacted signatures, asks
// TypeSafe (System One) for the most likely cause of each one in a single batched request,
// and prints the share of failures per owner.
//
// Runs after the test, never inside the k6 runtime. Opt-in: without TYPESAFE_API_KEY it
// does nothing, and run-test.sh only calls it when K6_TRIAGE=true.
//
// Usage:
//   TYPESAFE_API_KEY=... node bin/triage-failures.js <k6-execution.log>
//
// Env knobs:
//   TYPESAFE_API_KEY  — required; no key, no call
//   TYPESAFE_MODEL    — model id (default jev-latest)
//   TRIAGE_REDACT     — extra literal terms to hide, comma separated (client or service names)
//
// Nothing leaves the machine unredacted: JWTs, URLs, hosts, IPs, emails, ids, timestamps and
// query strings are replaced before the request is built.

"use strict";

const fs = require("fs");

const API_URL = "https://api.typesafe.ai/v1/systemone";
const MODEL = process.env.TYPESAFE_MODEL || "jev-latest";
const MAX_SIGNATURES = 25;
const MAX_MESSAGE_LENGTH = 400;
// ponytail: threshold taken from the TypeSafe docs example, tune it on real runs
const MIN_CONFIDENCE = 0.5;
const EXTRA_REDACT = (process.env.TRIAGE_REDACT || "").split(",").filter(Boolean);

/**
 * Possible causes. `what` is sent to the model as the option description;
 * `side` is policy kept in code: who owns the fix.
 */
const CAUSES = {
  waf_block: {
    side: "environment",
    what: 'Rejected by a WAF, CDN or bot protection before reaching the application, e.g. an HTML "Access Denied" page or an edge-generated 403.',
  },
  auth: {
    side: "test",
    what: "Credentials, token or permission problem answered by the application or gateway: 401, JSON 403 Forbidden, expired or missing token.",
  },
  test_data: {
    side: "test",
    what: "The application rejected the specific input: 400/404/422 tied to a particular record, order, id, path or payload used by the test.",
  },
  script_bug: {
    side: "test",
    what: "Exception raised by the test script itself, e.g. parsing a null body, reading an undefined property, a JS or Go runtime error.",
  },
  network: {
    side: "environment",
    what: "No HTTP response was received because of DNS lookup failure, connection refused or reset, TLS error or unreachable host.",
  },
  saturation: {
    side: "sut",
    what: "The system under test is slow or overloaded: request timeouts, 429, 502/503/504, HTTP/2 stream resets or internal errors under load.",
  },
  server_error: {
    side: "sut",
    what: "Application 5xx error or stack trace that is not obviously a capacity problem.",
  },
  other: {
    side: "unknown",
    what: "None of the other causes fit, or the message is not a failure.",
  },
};

/**
 * Redact identifiers and collapse variable parts so equal failures group together
 * and no tokens, ids or emails leave the machine.
 */
function normalize(text) {
  const redacted = text
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "<jwt>")
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})?/g, "<ts>")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "<email>")
    .replace(/https?:\/\/[^\s"'<>\\]+/g, "<url>")
    .replace(/\b[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*\.[a-z]{2,}\b/gi, "<host>")
    .replace(/\?[^\s"'<>]+/g, "?<query>")
    .replace(/\b\d{1,3}(\.\d{1,3}){3}(:\d+)?\b/g, "<ip>")
    .replace(/\b(?=\w*\d)(?=\w*[A-Za-z])\w{6,}\b/g, "<id>")
    .replace(/\d{4,}/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH);
  // Literal terms go last so they cannot break the URL/host patterns above
  return EXTRA_REDACT.reduce((t, term) => t.split(term).join("<redacted>"), redacted);
}

/** Extract failure signatures from a k6 execution log (logfmt lines), most frequent first. */
function extractSignatures(log) {
  const line = /level=(?:error|warning) msg="((?:[^"\\]|\\.)*)"(?: error="((?:[^"\\]|\\.)*)")?/;
  const unescape = (s) => s.replace(/\\n|\\t/g, " ").replace(/\\(.)/g, "$1");
  const counts = new Map();

  for (const raw of log.split("\n")) {
    const match = line.exec(raw);
    // k6's own threshold notice is a known rule, not a failure to classify
    if (!match || match[1].startsWith("thresholds on metrics")) continue;
    const text = unescape(match[1]) + (match[2] ? `: ${unescape(match[2])}` : "");
    const key = normalize(text);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return [...counts.entries()]
    .map(([message, occurrences]) => ({ message, occurrences }))
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, MAX_SIGNATURES);
}

/** Ask TypeSafe for the cause of every signature in one batched request. */
async function classify(failures, apiKey) {
  const criteria = Object.fromEntries(
    Object.entries(CAUSES).map(([name, cause]) => [name, cause.what])
  );
  const questions = Object.fromEntries(
    failures.map((_, i) => [
      `f${i}`,
      {
        type: "choice",
        instructions: `This is a log message from a k6 load test. What is the most likely cause of the failure in \`failures[${i}].message\`?`,
        criteria,
      },
    ])
  );
  const body = JSON.stringify({ model: MODEL, state: { failures }, questions });

  for (let attempt = 1; ; attempt++) {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(60000),
    });
    if (response.ok) return (await response.json()).answers;
    if (![429, 529].includes(response.status) || attempt === 3) {
      throw new Error(`TypeSafe API ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
  }
}

/**
 * Combine model answers with the code-owned policy.
 * @returns {{lines: string[], bySide: object, verdict: string}} Report ready to print
 */
function buildReport(failures, answers) {
  const bySide = { sut: 0, test: 0, environment: 0, unknown: 0 };
  const lines = [];
  let total = 0;

  failures.forEach((failure, i) => {
    const answer = answers[`f${i}`];
    const confident = !!answer && answer.confidence >= MIN_CONFIDENCE;
    const cause = (answer && CAUSES[answer.choice]) || CAUSES.other;
    const side = confident ? cause.side : "unknown";
    bySide[side] += failure.occurrences;
    total += failure.occurrences;
    lines.push(
      `${String(failure.occurrences).padStart(6)}x  ${String(answer ? answer.choice : "other").padEnd(12)} ` +
        `${side.padEnd(11)} conf=${answer ? answer.confidence.toFixed(2) : "0.00"}${confident ? "" : "  (review)"}`
    );
    lines.push(`         ${failure.message.slice(0, 140)}`);
  });

  lines.push("", "Share of failures by owner:");
  for (const [side, count] of Object.entries(bySide)) {
    lines.push(`  ${side.padEnd(11)} ${((count / total) * 100).toFixed(1)}%`);
  }

  let verdict;
  if ((bySide.test + bySide.environment) / total > 0.5) {
    verdict = "Most failures come from the test or the environment: fix them before trusting these results.";
  } else if (bySide.sut / total > 0.5) {
    verdict = "Most failures point at the system under test.";
  } else {
    verdict = "Inconclusive: review the signatures marked (review).";
  }
  lines.push("", verdict);

  return { lines, bySide, verdict };
}

module.exports = { normalize, extractSignatures, buildReport, CAUSES, MIN_CONFIDENCE };

if (require.main === module) {
  const logPath = process.argv[2];

  const main = async () => {
    if (!logPath) {
      console.error("[triage] Usage: node bin/triage-failures.js <k6-execution.log>");
      process.exit(1);
    }
    const apiKey = process.env.TYPESAFE_API_KEY;
    if (!apiKey) {
      console.error("[triage] TYPESAFE_API_KEY is not set — skipping triage.");
      process.exit(1);
    }

    const failures = extractSignatures(fs.readFileSync(logPath, "utf8"));
    if (failures.length === 0) {
      console.log("[triage] No error or warning lines found in the log.");
      return;
    }

    const { lines } = buildReport(failures, await classify(failures, apiKey));
    console.log("\n[triage] Failure triage\n");
    console.log(lines.join("\n"));
  };

  main().catch((error) => {
    console.error(`[triage] Failed: ${error.message}`);
    process.exit(1);
  });
}
