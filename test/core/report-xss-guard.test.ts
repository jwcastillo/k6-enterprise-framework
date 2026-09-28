/**
 * Tests for the HTML report XSS guard (CHK-SEC-035, auditHtmlReportForXss).
 *
 * Covers:
 * - The framework's own report (k6 web-dashboard export) is NOT quarantined:
 *   a fresh export from the installed k6 (skipped when k6 is not on PATH).
 *   It is the test that fails after a k6 upgrade that ships a new dashboard
 *   bundle. No real export is committed: the dashboard bundle is AGPL
 *   (xk6-dashboard) and this repo is MIT.
 * - Injected scripts are still quarantined, including the bypasses the old
 *   attribute parsing allowed (data-type / data-src, non-standard JS MIME types).
 */

import { describe, it, expect, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";
import { auditHtmlReportForXss } from "../../src/core/cli-auth";

// Minimal report with the shape of a k6 v2 export (JSON data block, no code).
const BASE_REPORT =
  "<!doctype html><html><head><title>k6</title></head><body>" +
  '<script id="data" type="application/json; charset=utf-8; gzip; base64">H4sIAAAA</script>' +
  "</body></html>";
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "report-xss-"));

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Write the base report with `extra` inserted right before </body>. */
function reportWith(extra: string, name: string): string {
  const html = BASE_REPORT;
  const out = path.join(tmpDir, `${name}.html`);
  fs.writeFileSync(out, html.replace("</body>", `${extra}</body>`));
  return out;
}

function k6Available(): boolean {
  const r = spawnSync("k6", ["version"], { encoding: "utf-8" });
  return r.status === 0;
}

describe("auditHtmlReportForXss — the framework's own report", () => {
  it("accepts a report whose only script is the k6 JSON data block", () => {
    expect(auditHtmlReportForXss(reportWith("", "base"))).toEqual([]);
  });

  it.skipIf(!k6Available())(
    "accepts the report exported by the installed k6 (fails after a dashboard bundle change)",
    () => {
      const script = path.join(tmpDir, "scenario.js");
      const report = path.join(tmpDir, "live-report.html");
      fs.writeFileSync(
        script,
        'import { sleep } from "k6";\n' +
          'export const options = { vus: 1, duration: "2s" };\n' +
          "export default function () { sleep(0.5); }\n"
      );
      const r = spawnSync("k6", ["run", "--quiet", "--no-usage-report", script], {
        encoding: "utf-8",
        timeout: 60_000,
        env: {
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? tmpDir,
          K6_WEB_DASHBOARD: "true",
          K6_WEB_DASHBOARD_EXPORT: report,
          K6_WEB_DASHBOARD_OPEN: "false",
          K6_WEB_DASHBOARD_PERIOD: "1s",
          K6_WEB_DASHBOARD_PORT: "-1",
        },
      });
      expect(r.status, r.stderr).toBe(0);
      expect(fs.existsSync(report)).toBe(true);
      expect(auditHtmlReportForXss(report)).toEqual([]);
    },
    60_000
  );

  it("accepts inert data blocks with any non-JS type", () => {
    const p = reportWith(
      '<script type="application/json">{"a":"<b>"}</script>' +
        '<script type="application/ld+json">{"@type":"Thing"}</script>' +
        '<script type="text/javascript; charset=utf-8">not run by browsers</script>',
      "data-blocks"
    );
    expect(auditHtmlReportForXss(p)).toEqual([]);
  });
});

describe("auditHtmlReportForXss — injected scripts are still quarantined", () => {
  const cases: Array<[string, string]> = [
    ["plain inline script", "<script>alert(document.cookie)</script>"],
    ["type=module", '<script type="module">alert(1)</script>'],
    ["type=text/javascript", '<script type="text/javascript">alert(1)</script>'],
    ["type=text/ecmascript (JS MIME essence)", '<script type="text/ecmascript">alert(1)</script>'],
    ["type=application/x-javascript", "<script type='application/x-javascript'>alert(1)</script>"],
    ["unquoted type", "<script type=text/javascript>alert(1)</script>"],
    ["uppercase tag and type", '<SCRIPT TYPE="TEXT/JAVASCRIPT">alert(1)</SCRIPT>'],
    ["data-type is not type", '<script data-type="application/json">alert(1)</script>'],
    ["data-src is not src", '<script data-src="./chart.js">alert(1)</script>'],
    ["importmap", '<script type="importmap">{"imports":{"a":"https://evil.example/a.js"}}</script>'],
    ["dashboard code tampered", '<script type="module" crossorigin>(function(){fetch("//evil.example")})()</script>'],
  ];

  it.each(cases)("%s", (_name, injected) => {
    const p = reportWith(injected, _name.replace(/[^a-z0-9]+/gi, "-"));
    const violations = auditHtmlReportForXss(p);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/Unauthorized inline script/);
  });

  it("flags an external script from an unknown host", () => {
    const p = reportWith('<script src="https://evil.example/x.js"></script>', "external");
    expect(auditHtmlReportForXss(p)).toEqual([
      "Unauthorized external script src: https://evil.example/x.js",
    ]);
  });
});
