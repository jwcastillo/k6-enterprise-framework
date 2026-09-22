#!/usr/bin/env node
// bin/junit.js — JUnit XML export for a k6 --summary-export JSON file.
//
// One <testcase> per threshold expression and one per check, so GitLab
// (artifacts:reports:junit) and GitHub test reporters show failed thresholds natively.
//
// Usage:
//   node bin/junit.js --summary=<summary.json> [--out=<junit.xml>] [--suite=<name>]
//
// Exit codes: 0 = XML written (even when thresholds failed — gating is bin/slo-report.js's
// job, not this one's), 2 = usage or I/O error.

"use strict";

const fs = require("fs");
const path = require("path");

/** Escape a value for XML text or attributes; drop characters XML 1.0 forbids outright. */
function escapeXml(value) {
  return String(value)
    .replace(/[^\x09\x0A\x0D\x20-퟿-�\u{10000}-\u{10FFFF}]/gu, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Did this threshold fail?
 * k6 writes `true` when the threshold was crossed (i.e. failed). Some versions write
 * `{ ok: false }` instead, so both shapes are accepted.
 */
function thresholdFailed(value) {
  if (value && typeof value === "object") return value.ok === false;
  return value === true;
}

/**
 * Collect the checks of a k6 group and all its nested groups.
 * `groups`/`checks` are objects in recent k6 versions and arrays in older ones —
 * Object.values() handles both.
 */
function collectChecks(group) {
  if (!group) return [];
  const own = Object.values(group.checks || {}).map((check) => ({
    classname: `checks${group.path || ""}`,
    name: check.name,
    passes: check.passes || 0,
    fails: check.fails || 0,
  }));
  return own.concat(...Object.values(group.groups || {}).map(collectChecks));
}

/** Build the JUnit XML document for a parsed k6 summary. */
function buildJUnit(summary, suiteName) {
  const cases = [];

  for (const [metricName, metric] of Object.entries(summary.metrics || {})) {
    for (const [expression, result] of Object.entries((metric && metric.thresholds) || {})) {
      const actual = Object.entries(metric)
        .filter(([, value]) => typeof value === "number")
        .map(([key, value]) => `${key}=${value}`)
        .join(", ");
      cases.push({
        classname: metricName,
        name: expression,
        failure: thresholdFailed(result)
          ? `Threshold '${expression}' failed for ${metricName}: ${actual}`
          : null,
      });
    }
  }

  for (const check of collectChecks(summary.root_group)) {
    cases.push({
      classname: check.classname,
      name: check.name,
      failure:
        check.fails > 0
          ? `Check failed ${check.fails} of ${check.passes + check.fails} times (${check.passes} passed)`
          : null,
    });
  }

  const failures = cases.filter((testCase) => testCase.failure).length;
  const body = cases.map((testCase) => {
    const open = `    <testcase classname="${escapeXml(testCase.classname)}" name="${escapeXml(testCase.name)}"`;
    return testCase.failure
      ? `${open}>\n      <failure message="${escapeXml(testCase.failure)}"/>\n    </testcase>`
      : `${open}/>`;
  });

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<testsuites>",
    `  <testsuite name="${escapeXml(suiteName)}" tests="${cases.length}" failures="${failures}" errors="0" skipped="0">`,
    ...body,
    "  </testsuite>",
    "</testsuites>",
    "",
  ].join("\n");

  return { xml, tests: cases.length, failures };
}

module.exports = { escapeXml, collectChecks, buildJUnit, thresholdFailed };

if (require.main === module) {
  const args = process.argv.slice(2);
  const getArg = (name) => {
    const hit = args.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : undefined;
  };

  const summaryArg = getArg("summary");
  if (!summaryArg) {
    console.error("[junit] --summary is required.");
    console.error("  Usage: node bin/junit.js --summary=<summary.json> [--out=<junit.xml>] [--suite=<name>]");
    process.exit(2);
  }

  try {
    const summaryPath = path.resolve(summaryArg);
    const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
    const outPath = getArg("out") || `${summaryPath.replace(/\.json$/, "")}.junit.xml`;
    // Default suite name: the directory holding the summary — reports/<client>/<test>/.
    const suiteName = getArg("suite") || `k6 ${path.basename(path.dirname(summaryPath))}`;

    const { xml, tests, failures } = buildJUnit(summary, suiteName);
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(outPath, xml);
    console.log(`[junit] Written: ${outPath} (${tests} tests, ${failures} failures)`);
  } catch (error) {
    console.error(`[junit] Failed to generate JUnit report: ${error.message}`);
    process.exit(2);
  }
}
