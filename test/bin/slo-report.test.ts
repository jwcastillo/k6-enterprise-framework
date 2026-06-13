/**
 * COV-04 — bin/slo-report.js spawn-based tests (D-08, D-09, D-10).
 *
 * The script reads clients/<client>/config/slos.json and reports/<client>/<test>/<date>/summary.json,
 * then evaluates compliance and emits a report (default HTML, --format=json).
 *
 * Tests stage a fixture client under clients/_test-slo-* during the run and
 * tear it down in afterAll. Per I3 from plan-check iter1, defensive cleanup
 * of any leftover *_test-slo-* dirs runs before staging.
 *
 * CR-03 (Phase 07 / 07-08): in-process DI tests exercise the PDF code path
 * via main(argv, deps) — see the nested "CR-03: PDF mode early-return + DI"
 * describe block at the bottom of this file. The DI seam intercepts fs
 * writes, console output, exit codes, and the playwright factory so no
 * real chromium launches and no files land on disk.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
// CR-03: import the DI seam. bin/slo-report.js is a CommonJS module — the
// require keeps the import side-effect-free (no module init runs because the
// CLI bootstrap only fires when require.main === module). main() accepts an
// untyped deps object (any) so the test can pass a richly-typed FakeDeps
// without TypeScript variance warnings.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { main } = require("../../bin/slo-report.js") as {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  main: (argv: string[], deps: any) => Promise<number | undefined>;
};

const ROOT = path.resolve(__dirname, "../..");
const SCRIPT = path.join(ROOT, "bin/slo-report.js");

const CLIENT = "_test-slo";
const STAGED_CLIENT = path.join(ROOT, "clients", CLIENT);
const STAGED_REPORTS = path.join(ROOT, "reports", CLIENT);

function run(args: string[]): { code: number | null; stdout: string; stderr: string } {
  const r = spawnSync("node", [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: "utf-8",
    timeout: 20000,
  });
  return { code: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function rmIfExists(p: string): void {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

describe("bin/slo-report.js (COV-04)", () => {
  beforeAll(() => {
    // Defensive cleanup of any leftover test fixtures (I3 from plan-check iter1)
    for (const d of fs
      .readdirSync(path.join(ROOT, "clients"))
      .filter((n) => n.startsWith("_test-slo"))) {
      rmIfExists(path.join(ROOT, "clients", d));
    }
    if (fs.existsSync(path.join(ROOT, "reports"))) {
      for (const d of fs
        .readdirSync(path.join(ROOT, "reports"))
        .filter((n) => n.startsWith("_test-slo"))) {
        rmIfExists(path.join(ROOT, "reports", d));
      }
    }

    // Stage clients/_test-slo/config/slos.json
    fs.mkdirSync(path.join(STAGED_CLIENT, "config"), { recursive: true });
    fs.writeFileSync(
      path.join(STAGED_CLIENT, "config", "slos.json"),
      JSON.stringify(
        {
          services: [
            {
              serviceName: "search-api",
              metrics: [
                { name: "http_req_duration_p95", target: 500, unit: "ms" },
                { name: "error_rate", target: 0.01, unit: "rate" },
              ],
            },
          ],
        },
        null,
        2
      )
    );

    // Stage reports/_test-slo/search-api/2026-05-15/summary.json (passing) —
    // CR-02: canonical k6 metric shape (was: legacy `httpDuration.p95` which
    // never existed in framework summaries; extractMetric silently returned
    // null for every percentile, masking real SLO violations).
    const passDir = path.join(STAGED_REPORTS, "search-api", "2026-05-15");
    fs.mkdirSync(passDir, { recursive: true });
    fs.writeFileSync(
      path.join(passDir, "summary.json"),
      JSON.stringify({
        testName: "search-api",
        metrics: {
          http_req_duration: {
            values: { "p(95)": 300, "p(99)": 450, avg: 100, count: 1000 },
          },
          http_req_failed: {
            values: { rate: 0.005, fails: 5, passes: 995 },
          },
        },
        startTime: "2026-05-15T10:00:00Z",
      })
    );

    // Stage a SECOND summary on a different date with p95=800 — CR-02
    // regression: target=500 must produce a violation. (Both dates fall
    // inside the same --month=2026-05 window so they aggregate into one
    // service report.)
    const violateDir = path.join(STAGED_REPORTS, "search-api", "2026-05-16");
    fs.mkdirSync(violateDir, { recursive: true });
    fs.writeFileSync(
      path.join(violateDir, "summary.json"),
      JSON.stringify({
        testName: "search-api",
        metrics: {
          http_req_duration: {
            values: { "p(95)": 800, "p(99)": 1200, avg: 250, count: 1000 },
          },
          http_req_failed: {
            values: { rate: 0.002, fails: 2, passes: 998 },
          },
        },
        startTime: "2026-05-16T10:00:00Z",
      })
    );
  });

  afterAll(() => {
    rmIfExists(STAGED_CLIENT);
    rmIfExists(STAGED_REPORTS);
  });

  it("--help exits 0 with usage text", () => {
    const { code, stdout } = run(["--help"]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/SLO Compliance/i);
    expect(stdout).toMatch(/--client/);
    expect(stdout).toMatch(/--month/);
  });

  it("exits 1 when --client is missing", () => {
    const { code, stderr } = run(["--month", "2026-05"]);
    expect(code).toBe(1);
    expect(stderr).toMatch(/client/i);
  });

  it("exits 1 when --month is missing", () => {
    const { code, stderr } = run(["--client", CLIENT]);
    expect(code).toBe(1);
    expect(stderr).toMatch(/month/i);
  });

  it("exits 1 when --month is not in YYYY-MM format", () => {
    const { code, stderr } = run(["--client", CLIENT, "--month", "2026-5"]);
    expect(code).toBe(1);
    expect(stderr).toMatch(/YYYY-MM/);
  });

  it("exits 1 when client does not exist", () => {
    const { code, stderr } = run(["--client", "_test-does-not-exist-xyz", "--month", "2026-05"]);
    expect(code).toBe(1);
    expect(stderr).toMatch(/not found/i);
  });

  it("exits 1 when slos.json is missing", () => {
    // Stage a client without config/slos.json
    const noSlo = path.join(ROOT, "clients", "_test-slo-no-config");
    fs.mkdirSync(noSlo, { recursive: true });
    try {
      const { code, stderr } = run(["--client", "_test-slo-no-config", "--month", "2026-05"]);
      expect(code).toBe(1);
      expect(stderr).toMatch(/slo/i);
    } finally {
      rmIfExists(noSlo);
    }
  });

  it("exits 0 with informational message when no execution data exists for the month", () => {
    // Use a month with no reports
    const { code, stdout } = run(["--client", CLIENT, "--month", "2099-12"]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/No execution data/i);
  });

  it("exits 0 and processes summaries for a month with execution data (JSON output)", () => {
    const { code, stdout } = run(["--client", CLIENT, "--month", "2026-05", "--format", "json"]);
    expect(code).toBe(0);
    expect(stdout.length).toBeGreaterThan(0);
  });

  // ── CR-02 regression: extractMetric reads canonical k6 shape ──────────────
  //
  // Pre-fix: extractMetric read summary.httpDuration?.p95, which is undefined
  // for every framework summary. Strict `=== null` check at the call site
  // failed for undefined, so every percentile fell through to `undefined <=
  // target` (always false) → every check appeared violated, OR after a
  // partial patch to `== null` every check was skipped (silently passing).
  //
  // Post-fix: extractMetric reads summary.metrics.http_req_duration.values["p(95)"]
  // (canonical k6 shape) with a fallback to the enriched shape; call site
  // uses `actual == null` so both null and undefined skip cleanly.

  it("CR-02: violation direction — p95=800 vs target=500 produces compliancePercent<100 and a violation row", () => {
    const { code } = run(["--client", CLIENT, "--month", "2026-05", "--format", "json"]);
    expect(code).toBe(0);
    // The script always writes the canonical JSON file to:
    //   reports/<client>/slo-compliance/slo-<month>.json
    const reportPath = path.join(ROOT, "reports", CLIENT, "slo-compliance", "slo-2026-05.json");
    expect(fs.existsSync(reportPath)).toBe(true);
    const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
    expect(report.services).toBeDefined();
    expect(report.services.length).toBe(1);

    const searchApi = report.services[0];
    expect(searchApi.serviceName).toBe("search-api");
    const p95 = searchApi.metrics.find(
      (m: { metric: string }) => m.metric === "http_req_duration_p95"
    );
    expect(p95).toBeDefined();

    // Two summaries staged: 2026-05-15 with p95=300 (pass against target=500)
    // and 2026-05-16 with p95=800 (violate against target=500).
    expect(p95.totalExecutions).toBe(2);
    expect(p95.passingExecutions).toBe(1);
    expect(p95.compliancePercent).toBeLessThan(100);
    expect(p95.violations.length).toBeGreaterThanOrEqual(1);
    // The violation should record the actual value (800).
    const v = p95.violations[0];
    expect(v.actualValue).toBe(800);
  });

  it("CR-02: pass direction — both p95=300 and p95=800 pass against target=1000", () => {
    // Stage a slos.json with a generous target to confirm the fix doesn't
    // produce false-positives. Use a separate scratch client to avoid
    // disturbing the main fixture.
    const SCRATCH = "_test-slo-cr02-pass";
    const scratchClient = path.join(ROOT, "clients", SCRATCH);
    const scratchReports = path.join(ROOT, "reports", SCRATCH);
    try {
      fs.mkdirSync(path.join(scratchClient, "config"), { recursive: true });
      fs.writeFileSync(
        path.join(scratchClient, "config", "slos.json"),
        JSON.stringify({
          services: [
            {
              serviceName: "search-api",
              metrics: [{ name: "http_req_duration_p95", target: 1000, unit: "ms" }],
            },
          ],
        })
      );
      const d1 = path.join(scratchReports, "search-api", "2026-05-15");
      fs.mkdirSync(d1, { recursive: true });
      fs.writeFileSync(
        path.join(d1, "summary.json"),
        JSON.stringify({
          testName: "search-api",
          metrics: { http_req_duration: { values: { "p(95)": 300 } } },
        })
      );
      const d2 = path.join(scratchReports, "search-api", "2026-05-16");
      fs.mkdirSync(d2, { recursive: true });
      fs.writeFileSync(
        path.join(d2, "summary.json"),
        JSON.stringify({
          testName: "search-api",
          metrics: { http_req_duration: { values: { "p(95)": 800 } } },
        })
      );

      const { code } = run(["--client", SCRATCH, "--month", "2026-05", "--format", "json"]);
      expect(code).toBe(0);

      const reportPath = path.join(scratchReports, "slo-compliance", "slo-2026-05.json");
      const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
      const p95 = report.services[0].metrics.find(
        (m: { metric: string }) => m.metric === "http_req_duration_p95"
      );
      expect(p95.compliancePercent).toBe(100);
      expect(p95.violations.length).toBe(0);
      expect(p95.passingExecutions).toBe(2);
    } finally {
      rmIfExists(scratchClient);
      rmIfExists(scratchReports);
    }
  });

  it("CR-02: missing http_req_duration is treated as no-data (skipped, no false-pass/false-fail)", () => {
    const SCRATCH = "_test-slo-cr02-nodata";
    const scratchClient = path.join(ROOT, "clients", SCRATCH);
    const scratchReports = path.join(ROOT, "reports", SCRATCH);
    try {
      fs.mkdirSync(path.join(scratchClient, "config"), { recursive: true });
      fs.writeFileSync(
        path.join(scratchClient, "config", "slos.json"),
        JSON.stringify({
          services: [
            {
              serviceName: "search-api",
              metrics: [{ name: "http_req_duration_p95", target: 500, unit: "ms" }],
            },
          ],
        })
      );
      const d = path.join(scratchReports, "search-api", "2026-05-15");
      fs.mkdirSync(d, { recursive: true });
      // Summary missing http_req_duration entirely.
      fs.writeFileSync(
        path.join(d, "summary.json"),
        JSON.stringify({
          testName: "search-api",
          metrics: { http_req_failed: { values: { rate: 0.001 } } },
        })
      );

      const { code } = run(["--client", SCRATCH, "--month", "2026-05", "--format", "json"]);
      expect(code).toBe(0);
      const reportPath = path.join(scratchReports, "slo-compliance", "slo-2026-05.json");
      const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
      const p95 = report.services[0].metrics.find(
        (m: { metric: string }) => m.metric === "http_req_duration_p95"
      );
      // No executions counted, no violations recorded — skipped cleanly.
      expect(p95.passingExecutions).toBe(0);
      expect(p95.violations.length).toBe(0);
    } finally {
      rmIfExists(scratchClient);
      rmIfExists(scratchReports);
    }
  });

  it("CR-02: error_rate reads metrics.http_req_failed.values.rate (canonical k6 shape)", () => {
    const SCRATCH = "_test-slo-cr02-error";
    const scratchClient = path.join(ROOT, "clients", SCRATCH);
    const scratchReports = path.join(ROOT, "reports", SCRATCH);
    try {
      fs.mkdirSync(path.join(scratchClient, "config"), { recursive: true });
      fs.writeFileSync(
        path.join(scratchClient, "config", "slos.json"),
        JSON.stringify({
          services: [
            {
              serviceName: "search-api",
              metrics: [{ name: "error_rate", target: 0.01, unit: "rate" }],
            },
          ],
        })
      );
      const d = path.join(scratchReports, "search-api", "2026-05-15");
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(
        path.join(d, "summary.json"),
        JSON.stringify({
          testName: "search-api",
          metrics: {
            http_req_failed: { values: { rate: 0.05, fails: 50, passes: 950 } },
          },
        })
      );

      const { code } = run(["--client", SCRATCH, "--month", "2026-05", "--format", "json"]);
      expect(code).toBe(0);
      const reportPath = path.join(scratchReports, "slo-compliance", "slo-2026-05.json");
      const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
      const er = report.services[0].metrics.find(
        (m: { metric: string }) => m.metric === "error_rate"
      );
      // rate=0.05 > target=0.01 → violation.
      expect(er.violations.length).toBe(1);
      expect(er.violations[0].actualValue).toBeCloseTo(0.05, 5);
    } finally {
      rmIfExists(scratchClient);
      rmIfExists(scratchReports);
    }
  });

  // ── CR-03: PDF mode early-return + DI ───────────────────────────────────
  //
  // Pre-fix: bin/slo-report.js kicked off an async IIFE for --format=pdf
  // WITHOUT returning. Execution fell through to the HTML/JSON branches and
  // the trailing "always also write JSON" block. The result was: JSON was
  // written twice (once at the JSON branch / HTML branch + once at the
  // trailing unconditional sidecar write), and on rejection chromium could
  // be left as an orphan process because the script's exit code never saw
  // the rejection.
  //
  // Post-fix: main(argv, deps) early-returns per format. The PDF branch
  // awaits browser.close() before writing the canonical JSON sidecar
  // exactly ONCE and returning 0. The HTML/JSON branches each write the
  // sidecar exactly ONCE too.
  //
  // These tests inject a fake `playwright` and a write-tracking fake `fs`
  // via the DI seam — no real chromium launches and no files land on disk.

  describe("CR-03: PDF mode early-return + DI", () => {
    interface FsWrite {
      path: string;
      size: number;
    }
    interface BrowserCalls {
      launchCount: number;
      newPageCount: number;
      pdfWrites: Array<{ path: string; format: string; printBackground: boolean }>;
      gotos: Array<{ url: string }>;
      closed: boolean;
    }
    interface FakeDeps {
      fs: {
        writes: FsWrite[];
        existsSync: (p: string) => boolean;
        mkdirSync: (p: string, opts?: unknown) => void;
        mkdirCalls: string[];
        readFileSync: (p: string, enc?: BufferEncoding) => string;
        readdirSync: (p: string) => string[];
        statSync: (p: string) => fs.Stats;
        writeFileSync: (p: string, data: string | Buffer) => void;
      };
      path: typeof path;
      console: {
        logs: string[];
        errors: string[];
        warns: string[];
        log: (...args: unknown[]) => void;
        error: (...args: unknown[]) => void;
        warn: (...args: unknown[]) => void;
      };
      exitCode: number | null;
      exit: (code: number) => number;
      playwrightFactory: () => unknown;
      browserCalls: BrowserCalls;
    }

    function makeFakePlaywright(browserCalls: BrowserCalls): unknown {
      return {
        chromium: {
          launch: async () => {
            browserCalls.launchCount++;
            return {
              newPage: async () => {
                browserCalls.newPageCount++;
                return {
                  goto: async (url: string) => {
                    browserCalls.gotos.push({ url });
                  },
                  pdf: async (opts: { path: string; format: string; printBackground: boolean }) => {
                    browserCalls.pdfWrites.push({
                      path: opts.path,
                      format: opts.format,
                      printBackground: opts.printBackground,
                    });
                  },
                };
              },
              close: async () => {
                browserCalls.closed = true;
              },
            };
          },
        },
      };
    }

    function makeFakeDeps(overrides: Partial<{ playwrightFactory: () => unknown }> = {}): FakeDeps {
      const writes: FsWrite[] = [];
      const mkdirCalls: string[] = [];
      const browserCalls: BrowserCalls = {
        launchCount: 0,
        newPageCount: 0,
        pdfWrites: [],
        gotos: [],
        closed: false,
      };

      // Whitelist of read paths we delegate to the real fs (the staged fixture).
      const FIXTURE_PREFIXES = [STAGED_CLIENT, STAGED_REPORTS];
      const isFixturePath = (p: string): boolean =>
        FIXTURE_PREFIXES.some((prefix) => p === prefix || p.startsWith(prefix + path.sep));

      // In-memory record of what writeFileSync calls have created — used to
      // satisfy subsequent existsSync checks in the same main() invocation.
      const writtenPaths = new Set<string>();
      // In-memory record of mkdirSync calls — used so existsSync sees the
      // directory after we "create" it.
      const createdDirs = new Set<string>();

      const fakeFs: FakeDeps["fs"] = {
        writes,
        mkdirCalls,
        existsSync: (p: string): boolean => {
          if (writtenPaths.has(p)) return true;
          if (createdDirs.has(p)) return true;
          if (isFixturePath(p)) return fs.existsSync(p);
          // Output dir under reports/<client>/slo-compliance/ does NOT exist
          // initially in the fake fs — main() will mkdirSync it.
          return false;
        },
        mkdirSync: (p: string): void => {
          mkdirCalls.push(p);
          createdDirs.add(p);
        },
        readFileSync: (p: string, enc?: BufferEncoding): string => {
          if (isFixturePath(p)) return fs.readFileSync(p, enc ?? "utf-8") as string;
          throw new Error(`unexpected fake fs.readFileSync: ${p}`);
        },
        readdirSync: (p: string): string[] => {
          if (isFixturePath(p)) return fs.readdirSync(p) as string[];
          throw new Error(`unexpected fake fs.readdirSync: ${p}`);
        },
        statSync: (p: string): fs.Stats => {
          if (isFixturePath(p)) return fs.statSync(p);
          throw new Error(`unexpected fake fs.statSync: ${p}`);
        },
        writeFileSync: (p: string, data: string | Buffer): void => {
          const size = typeof data === "string" ? Buffer.byteLength(data) : data.length;
          writes.push({ path: p, size });
          writtenPaths.add(p);
        },
      };

      const logs: string[] = [];
      const errors: string[] = [];
      const warns: string[] = [];

      const deps: FakeDeps = {
        fs: fakeFs,
        path,
        console: {
          logs,
          errors,
          warns,
          log: (...args) => logs.push(args.map(String).join(" ")),
          error: (...args) => errors.push(args.map(String).join(" ")),
          warn: (...args) => warns.push(args.map(String).join(" ")),
        },
        exitCode: null,
        exit: (code: number): number => {
          // Record the FIRST exit call (which is the real one — the rest of
          // main has already returned by then since every branch `return
          // deps.exit(N)`s).
          if (deps.exitCode === null) deps.exitCode = code;
          return code;
        },
        playwrightFactory: overrides.playwrightFactory ?? (() => makeFakePlaywright(browserCalls)),
        browserCalls,
      };
      return deps;
    }

    it("CR-03: writes JSON sidecar exactly once when --format=pdf", async () => {
      const deps = makeFakeDeps();
      await main(["--client", CLIENT, "--month", "2026-05", "--format", "pdf"], deps);
      expect(deps.exitCode).toBe(0);
      const jsonWrites = deps.fs.writes.filter((w) => w.path.endsWith(".json"));
      expect(jsonWrites.length).toBe(1);
      // The single JSON write should target the canonical sidecar path.
      expect(jsonWrites[0].path.endsWith(`slo-2026-05.json`)).toBe(true);
    });

    it("CR-03: writes PDF exactly once and closes browser when --format=pdf", async () => {
      const deps = makeFakeDeps();
      await main(["--client", CLIENT, "--month", "2026-05", "--format", "pdf"], deps);
      expect(deps.exitCode).toBe(0);
      expect(deps.browserCalls.launchCount).toBe(1);
      expect(deps.browserCalls.newPageCount).toBe(1);
      expect(deps.browserCalls.pdfWrites.length).toBe(1);
      expect(deps.browserCalls.closed).toBe(true);
      expect(deps.browserCalls.pdfWrites[0].path.endsWith("slo-2026-05.pdf")).toBe(true);
      expect(deps.browserCalls.pdfWrites[0].format).toBe("A4");
      expect(deps.browserCalls.pdfWrites[0].printBackground).toBe(true);
    });

    it("CR-03: falls back to HTML when playwrightFactory returns null and writes JSON once", async () => {
      const deps = makeFakeDeps({ playwrightFactory: () => null });
      await main(["--client", CLIENT, "--month", "2026-05", "--format", "pdf"], deps);
      expect(deps.exitCode).toBe(0);
      // Fallback path: HTML written once + JSON sidecar written once. No PDF.
      const htmlWrites = deps.fs.writes.filter((w) => w.path.endsWith(".html"));
      const jsonWrites = deps.fs.writes.filter((w) => w.path.endsWith(".json"));
      expect(htmlWrites.length).toBe(1);
      expect(jsonWrites.length).toBe(1);
      expect(deps.browserCalls.pdfWrites.length).toBe(0);
      expect(deps.browserCalls.launchCount).toBe(0);
      // The user is warned via console.error per main()'s fallback messaging.
      expect(deps.console.errors.some((m) => /playwright/i.test(m))).toBe(true);
    });

    it("CR-03: PDF mode writes intermediate HTML BEFORE the PDF (not as standalone primary output)", async () => {
      const deps = makeFakeDeps();
      await main(["--client", CLIENT, "--month", "2026-05", "--format", "pdf"], deps);
      expect(deps.exitCode).toBe(0);
      // Exactly one HTML write (the intermediate render input for playwright).
      const htmlWrites = deps.fs.writes.filter((w) => w.path.endsWith(".html"));
      expect(htmlWrites.length).toBe(1);
      // The PDF write is recorded against browserCalls.pdfWrites (not fs.writes
      // — the fake page.pdf doesn't touch our fake fs). What we assert here is
      // that the HTML write came BEFORE the PDF generation: the HTML write
      // index in fs.writes must be lower than the JSON sidecar's index (the
      // JSON sidecar is the last write in the pdf branch).
      const htmlIdx = deps.fs.writes.findIndex((w) => w.path.endsWith(".html"));
      const jsonIdx = deps.fs.writes.findIndex((w) => w.path.endsWith(".json"));
      expect(htmlIdx).toBeGreaterThanOrEqual(0);
      expect(jsonIdx).toBeGreaterThan(htmlIdx);
      // And the PDF rendering happened AFTER the HTML was written (intermediate
      // file is the page.goto target).
      expect(deps.browserCalls.gotos.length).toBe(1);
      expect(deps.browserCalls.gotos[0].url.startsWith("file://")).toBe(true);
      expect(deps.browserCalls.gotos[0].url.endsWith(".html")).toBe(true);
    });

    it("CR-03: --format=json behavior is unchanged (CR-02 invariants hold via DI)", async () => {
      const deps = makeFakeDeps();
      await main(["--client", CLIENT, "--month", "2026-05", "--format", "json"], deps);
      expect(deps.exitCode).toBe(0);
      const jsonWrites = deps.fs.writes.filter((w) => w.path.endsWith(".json"));
      const htmlWrites = deps.fs.writes.filter((w) => w.path.endsWith(".html"));
      expect(jsonWrites.length).toBe(1);
      expect(htmlWrites.length).toBe(0);
      expect(deps.browserCalls.pdfWrites.length).toBe(0);
      expect(deps.browserCalls.launchCount).toBe(0);
    });
  });
});
