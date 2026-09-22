/**
 * Failure triage — log parsing, redaction and owner policy.
 *
 * Ported from the LATAM framework (bin/reporting/triage-failures.js, --self-test).
 * No network: classify() is not exercised here, only what surrounds it.
 */

import { describe, it, expect } from "vitest";

const { normalize, extractSignatures, buildReport, CAUSES } = require("../../bin/triage-failures.js");

const log = [
  'time="2026-01-20T15:06:50-03:00" level=error msg="Error in sync: 400 - AB1234567WXYZ" source=console',
  'time="2026-01-20T15:06:51-03:00" level=error msg="Error in sync: 400 - AB7654321QRST" source=console',
  'time="2026-01-20T15:06:52-03:00" level=warning msg="Request Failed" error="Get \\"https://api.example.com/v1/items?token=abc\\": dial tcp 203.0.113.10:443: connect"',
  'time="2026-01-20T15:06:53-03:00" level=error msg="thresholds on metrics \'http_req_failed\' have been crossed"',
  'time="2026-01-20T15:06:54-03:00" level=info msg="all good" source=console',
].join("\n");

describe("extractSignatures", () => {
  it("groups equal failures, drops info lines and k6's own threshold notice", () => {
    expect(extractSignatures(log)).toEqual([
      { message: "Error in sync: 400 - <id>", occurrences: 2 },
      { message: 'Request Failed: Get "<url>": dial tcp <ip>: connect', occurrences: 1 },
    ]);
  });

  it("returns nothing for a log with no errors or warnings", () => {
    expect(extractSignatures('time="x" level=info msg="all good"')).toEqual([]);
  });
});

describe("normalize", () => {
  it("redacts JWTs and emails", () => {
    expect(normalize("Bearer eyJhbGci.eyJzdWIi.sig-1 for a.b@example.com")).toBe(
      "Bearer <jwt> for <email>"
    );
  });

  it("collapses timestamps so the same failure groups together", () => {
    expect(normalize('"timestamp":"2026-01-30T15:15:51.123456Z"')).toBe(
      normalize('"timestamp":"2026-01-30T15:15:52.98Z"')
    );
  });

  it("redacts hostnames", () => {
    expect(normalize("lookup www.api.example.com: no such host")).toBe("lookup <host>: no such host");
  });
});

describe("buildReport", () => {
  const failures = [
    { message: "502 Bad Gateway", occurrences: 8 },
    { message: "401 Unauthorized", occurrences: 2 },
  ];

  it("attributes occurrences to the owner of each cause", () => {
    const { bySide, verdict } = buildReport(failures, {
      f0: { choice: "saturation", confidence: 0.9 },
      f1: { choice: "auth", confidence: 0.8 },
    });
    expect(bySide).toEqual({ sut: 8, test: 2, environment: 0, unknown: 0 });
    expect(verdict).toContain("system under test");
  });

  it("calls out a run whose failures are the test's or the environment's fault", () => {
    const { verdict } = buildReport(failures, {
      f0: { choice: "waf_block", confidence: 0.9 },
      f1: { choice: "auth", confidence: 0.9 },
    });
    expect(verdict).toContain("fix them before trusting these results");
  });

  it("parks low-confidence answers under unknown and marks them for review", () => {
    const { bySide, lines } = buildReport(failures, {
      f0: { choice: "saturation", confidence: 0.3 },
      f1: { choice: "auth", confidence: 0.9 },
    });
    expect(bySide.unknown).toBe(8);
    expect(bySide.sut).toBe(0);
    expect(lines.join("\n")).toContain("(review)");
  });

  it("every cause maps to a known owner", () => {
    const owners = Object.values(CAUSES).map((c: { side: string }) => c.side);
    expect(new Set(owners)).toEqual(new Set(["sut", "test", "environment", "unknown"]));
  });
});
