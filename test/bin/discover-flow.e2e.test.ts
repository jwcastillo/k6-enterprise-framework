/**
 * Flow discovery — end to end with real Playwright/Chromium against a local fixture site
 * (test/fixtures/discovery-site) and a scripted fake decider. No network beyond localhost,
 * no API keys. Skipped when Playwright's Chromium is not installed.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const { runDiscovery } = require("../../bin/discovery/explore.js");
const site = require("../fixtures/discovery-site/server.js");

let chromium: { executablePath(): string } | undefined;
try {
  chromium = require("playwright").chromium;
} catch {
  chromium = undefined;
}
const hasBrowser = !!chromium && fs.existsSync(chromium.executablePath());

type Candidate = { index: number; name: string; filled?: boolean };
type Observation = { url: string; candidates: Candidate[] };

/** Scripted decider: start -> fill plate/email -> search -> continue. Records what it saw. */
function fakeDecider(seen: Observation[]) {
  return {
    name: "fake",
    model: "scripted",
    async decide({ observation }: { observation: Observation }) {
      seen.push(observation);
      const find = (re: RegExp) => observation.candidates.find((c) => re.test(c.name));
      const click = (c?: Candidate) => ({ action: "click", index: c ? c.index : -1, valueKey: null, rationale: "next", confidence: 0.9 });
      let decision;
      if (/\/form/.test(observation.url)) {
        const plate = find(/^Plate$/);
        const email = find(/^Email$/);
        if (plate && !plate.filled) decision = { action: "fill", index: plate.index, valueKey: "plate", rationale: "plate", confidence: 0.9 };
        else if (email && !email.filled) decision = { action: "fill", index: email.index, valueKey: "email", rationale: "email", confidence: 0.9 };
        else decision = click(find(/^Search$/));
      } else if (/\/results/.test(observation.url)) {
        // Would take the pay button if it were offered — it must not be
        decision = click(find(/pay now/i) || find(/^Continue$/));
      } else {
        decision = click(find(/^Start$/));
      }
      return { decision, tokens: 10 };
    },
  };
}

describe.skipIf(!hasBrowser)("discover-flow end to end", () => {
  let server: { url: string; state: { payCalls: number; tokens: string[]; offersToken: string | null }; close(): Promise<void> };
  let out: string;
  let result: { flow: any; files: Record<string, string>; exitCode: number };
  const seen: Observation[] = [];
  const logs: string[] = [];

  beforeAll(async () => {
    server = await site.start();
    out = fs.mkdtempSync(path.join(os.tmpdir(), "discover-flow-"));
    result = await runDiscovery(
      {
        url: server.url,
        goal: "search offers for a plate and continue",
        data: { plate: "TEST-001", email: "qa.user@example.com" },
        stopAt: [/\/pay/],
        maxSteps: 10,
        out,
        settleMs: 2000,
      },
      { decider: fakeDecider(seen), chromium, log: (m: string) => logs.push(m) }
    );
  }, 60000);

  afterAll(async () => {
    await server?.close();
    fs.rmSync(out, { recursive: true, force: true });
  });

  it("stops at the --stop-at boundary with a success exit code", () => {
    expect(result.flow.stopReason).toBe("stop-at");
    expect(result.exitCode).toBe(0);
  });

  it("records the steps in order", () => {
    expect(result.flow.steps.map((s: { action: string; valueKey?: string }) => `${s.action}${s.valueKey ? ":" + s.valueKey : ""}`)).toEqual([
      "click",
      "fill:plate",
      "fill:email",
      "click",
      "click",
    ]);
    expect(result.flow.steps.every((s: { executed: boolean }) => s.executed)).toBe(true);
    expect(result.flow.steps[0].locator).toBe('getByRole("link", { name: "Start" })');
    expect(result.flow.steps[3].requests).toBeGreaterThanOrEqual(3);
    expect(logs.some((l) => l.startsWith("step 1: click"))).toBe(true);
  });

  it("never offers or clicks the pay button", () => {
    expect(server.state.payCalls).toBe(0);
    const results = seen.find((o) => /\/results/.test(o.url));
    expect(results?.candidates.map((c) => c.name)).toEqual(["Continue"]);
    expect(result.flow.guardrails.deniedCandidates).toBe(1);
  });

  it("sends only redacted observations to the decider", () => {
    const sent = JSON.stringify(seen);
    expect(sent).not.toContain("qa.user@example.com");
    expect(sent).not.toContain("TEST-001");
    expect(sent).toContain("{{email}}");
  });

  it("writes the HAR with bodies and 0600 artifacts", () => {
    const har = JSON.parse(fs.readFileSync(result.files.har, "utf8"));
    const search = har.log.entries.find((e: any) => e.request.url.endsWith("/api/search"));
    expect(search.response.content.text).toContain(server.state.tokens[0]);
    for (const f of [result.files.har, result.files.json, result.files.md, result.files.plan]) {
      expect(fs.statSync(f).mode & 0o777).toBe(0o600);
    }
  });

  it("detects the token correlation and plans it for k6", () => {
    expect(server.state.offersToken).toBe(server.state.tokens[0]);
    expect(result.flow.correlations).toEqual([
      expect.objectContaining({
        name: "token",
        source: expect.objectContaining({ method: "POST", path: "/api/search", selector: "session.token" }),
        usedIn: [expect.objectContaining({ method: "GET", path: "/api/offers", where: ["url"] })],
      }),
    ]);
    const plan = fs.readFileSync(result.files.plan, "utf8");
    expect(plan).toContain('res.json("session.token")');
    expect(plan).not.toContain(server.state.tokens[0]);
    const flowJson = fs.readFileSync(result.files.json, "utf8");
    expect(flowJson).not.toContain(server.state.tokens[0]);
    expect(result.flow.endpoints.map((e: { method: string; path: string }) => `${e.method} ${e.path}`)).toEqual(
      expect.arrayContaining(["POST /api/search", "GET /api/offers", "GET /results", "GET /pay"])
    );
  });
});
