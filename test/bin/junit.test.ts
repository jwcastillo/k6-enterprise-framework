/**
 * JUnit XML export for k6 --summary-export JSON.
 *
 * Ported from the LATAM framework (bin/reporting/junit.js).
 * In `thresholds`, `true` means the threshold FAILED.
 */

import { describe, it, expect } from "vitest";

const { buildJUnit, escapeXml, thresholdFailed } = require("../../bin/junit.js");

const summary = {
  metrics: {
    http_req_duration: {
      avg: 120.5,
      "p(95)": 640.2,
      thresholds: { "p(95)<500": true, "avg<200": false },
    },
    'http_req_duration{scenario:"login"}': {
      "p(95)": 90,
      thresholds: { "p(95)<100": false },
    },
    http_reqs: { count: 10, rate: 5 },
  },
  root_group: {
    name: "",
    path: "",
    checks: { "status is 200": { name: "status is 200", passes: 10, fails: 0 } },
    groups: {
      Login: {
        name: "Login",
        path: "::Login",
        checks: {
          'body has <token> & "id"': { name: 'body has <token> & "id"', passes: 7, fails: 3 },
        },
        groups: {},
      },
    },
  },
};

describe("escapeXml", () => {
  it("escapes the five XML special characters", () => {
    expect(escapeXml("a&b<c>d\"e'f")).toBe("a&amp;b&lt;c&gt;d&quot;e&apos;f");
  });

  it("drops characters XML 1.0 forbids", () => {
    expect(escapeXml("bad\u0000char")).toBe("badchar");
  });
});

describe("thresholdFailed", () => {
  it("treats true as failed and false as passed", () => {
    expect(thresholdFailed(true)).toBe(true);
    expect(thresholdFailed(false)).toBe(false);
  });

  it("accepts the { ok } object shape", () => {
    expect(thresholdFailed({ ok: false })).toBe(true);
    expect(thresholdFailed({ ok: true })).toBe(false);
  });
});

describe("buildJUnit", () => {
  it("counts thresholds and checks as test cases", () => {
    const { xml, tests, failures } = buildJUnit(summary, "suite <1>");

    expect(tests).toBe(5); // 3 thresholds + 2 checks
    expect(failures).toBe(2); // p(95)<500 and the Login check
    expect(xml).toMatch(/<testsuite name="suite &lt;1&gt;" tests="5" failures="2"/);
    expect(xml.match(/<testcase /g)).toHaveLength(5);
    expect(xml.match(/<failure /g)).toHaveLength(2);
  });

  it("puts actual values and counts in failure messages", () => {
    const { xml } = buildJUnit(summary, "k6");
    expect(xml).toContain("p(95)=640.2");
    expect(xml).toContain("Check failed 3 of 10 times (7 passed)");
  });

  it("classnames nested checks by group path", () => {
    const { xml } = buildJUnit(summary, "k6");
    expect(xml).toContain('classname="checks::Login"');
    expect(xml).toContain('classname="checks"');
  });

  it("produces a valid empty suite for a summary with no metrics or groups", () => {
    const { xml, tests, failures } = buildJUnit({}, "empty");
    expect(tests).toBe(0);
    expect(failures).toBe(0);
    expect(xml).toContain('<testsuite name="empty" tests="0" failures="0"');
  });
});
