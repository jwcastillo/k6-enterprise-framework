// bin/discovery/explore.js — the exploration loop and its artifacts.
//
// observe -> redact -> decide -> guard -> act -> settle -> record, until the goal is reached,
// a --stop-at URL is hit, or a guardrail stops it. Writes flow.har (raw traffic), and the
// redacted flow.json / flow.md / flow-plan.md, all 0600.

"use strict";

const fs = require("fs");
const path = require("path");
const { DEFAULT_DENY, observe, redact, redactObservation, describeCandidate } = require("./observe");
const { hostMatches, endpoints, correlations, k6Extract } = require("./har-analysis");

const SCHEMA_PATH = path.join(__dirname, "..", "..", "shared", "schemas", "discovery-flow.schema.json");
const LOOP_LIMIT = 3;
const SUCCESS = new Set(["goal-reached", "stop-at", "dry-run-complete"]);

// ── Pure helpers (unit tested) ────────────────────────────────────────────────

/** Clearly fake filler for synthetic:<desc> values. Never used for password fields. */
function syntheticValue(desc, candidate) {
  const hint = `${desc} ${candidate.name} ${candidate.type}`.toLowerCase();
  if (/mail/.test(hint)) return "discovery.test@example.com";
  if (/phone|tel|mobile|number|qty|quantity|amount|spinbutton/.test(hint) || candidate.role === "spinbutton") return "5550100";
  if (/date/.test(hint)) return "2030-01-01";
  if (/url|web/.test(hint)) return "https://example.com";
  return "test";
}

/**
 * Resolve the value to type for a fill/select. Returns { value } | { skip } | { error }.
 * Only --data values or declared synthetic filler are typed; password fields only take
 * the --data key "password".
 */
function resolveValue(candidate, valueKey, data) {
  if (candidate.type === "password") {
    return valueKey === "password" && data.password != null
      ? { value: String(data.password) }
      : { skip: 'password field: only filled from the --data key "password"' };
  }
  if (!valueKey) return { error: "fill/select without value_key" };
  if (Object.prototype.hasOwnProperty.call(data, valueKey)) return { value: String(data[valueKey]) };
  if (valueKey.startsWith("synthetic:")) {
    return candidate.tag === "select" ? { firstOption: true } : { value: syntheticValue(valueKey.slice(10), candidate) };
  }
  return { error: `value_key "${valueKey}" is not a --data key nor synthetic:<desc>` };
}

const PII_RULES = [
  ["JWT", /eyJ[\w-]+\.[\w-]+\.[\w-]+/],
  ["email", /[\w.+-]+@[\w-]+\.[a-z]{2,}/i],
  ["cookie", /\b(set-)?cookie\s*[:=]\s*\S+/i],
  ["authorization value", /\bauthorization\s*[:=]\s*\S+/i],
  ["bearer token", /\bbearer\s+[\w.~+/-]{8,}/i],
  ["long digit run", /\d{7,}/],
];

/** Fail closed: throw if a redacted artifact still carries something that looks like PII or a secret. */
function assertNoPii(name, text) {
  const hits = PII_RULES.filter(([, re]) => re.test(text)).map(([rule]) => rule);
  if (hits.length) throw new Error(`PII check failed for ${name}: found ${hits.join(", ")} — nothing was written`);
}

function validateFlow(flow) {
  let Ajv, addFormats;
  try {
    Ajv = require("ajv");
    addFormats = require("ajv-formats");
  } catch {
    throw new Error("ajv and ajv-formats are required to validate flow.json (npm i -D ajv ajv-formats)");
  }
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8")));
  if (!validate(flow)) {
    const errors = validate.errors.map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
    throw new Error(`flow.json does not match shared/schemas/discovery-flow.schema.json: ${errors}`);
  }
}

// ── Rendering ─────────────────────────────────────────────────────────────────

const cell = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");

function renderFlowMd(flow) {
  const lines = [
    `# Flow discovery`,
    "",
    `- **Goal:** ${flow.goal}`,
    `- **Start:** ${flow.startUrl}`,
    `- **Decider:** ${flow.decider.name} (${flow.decider.model})${flow.dryRun ? " — dry run, nothing executed" : ""}`,
    `- **Stopped:** ${flow.stopReason}${flow.stopDetail ? ` — ${flow.stopDetail}` : ""} (${flow.outcome})`,
    `- **Duration:** ${(flow.durationMs / 1000).toFixed(1)} s, ${flow.steps.length} steps, ~${flow.tokensUsed} tokens`,
    `- **Guardrails:** ${flow.guardrails.deniedCandidates} denied elements, ${flow.guardrails.blockedRequests} blocked requests`,
    "",
    "> flow.har holds raw traffic (bodies, cookies, typed values). Treat it as sensitive; do not commit it.",
    "",
    "## Steps",
    "",
    "| # | Action | Target | Value key | URL before → after | ms | req | Rationale |",
    "| - | ------ | ------ | --------- | ------------------ | -- | --- | --------- |",
    ...flow.steps.map(
      (s) =>
        `| ${s.n} | ${s.action}${s.executed ? "" : " (not executed)"} | ${cell(s.locator)} | ${cell(s.valueKey)} | ${cell(s.urlBefore)} → ${cell(s.urlAfter)} | ${s.durationMs} | ${s.requests} | ${cell(s.note || s.rationale)} |`
    ),
    "",
    `**Hosts seen:** ${flow.hostsSeen.join(", ") || "none"}`,
    "",
    "See flow-plan.md for the endpoint sequence and correlation candidates.",
    "",
  ];
  return lines.join("\n");
}

function renderPlanMd(flow) {
  const lines = [
    "# k6 plan",
    "",
    `Goal: ${flow.goal}`,
    "",
    "## Endpoint sequence (first-party, static assets excluded)",
    "",
    "| # | Method | Path | Status | Type |",
    "| - | ------ | ---- | ------ | ---- |",
    ...flow.endpoints.map((e, i) => `| ${i + 1} | ${e.method} | ${cell(e.path)} | ${e.status} | ${cell(e.mimeType)} |`),
    "",
    "## Correlation candidates",
    "",
  ];
  if (!flow.correlations.length) {
    lines.push("None detected: no response value was reused by a later request.", "");
  } else {
    lines.push(
      "Values that first appear in a response and are sent back later. Extract them in the script instead of replaying the recorded value.",
      "",
      "| Name | From | Used in | Extract (k6) |",
      "| ---- | ---- | ------- | ------------ |",
      ...flow.correlations.map(
        (c) =>
          `| ${cell(c.name)} (${c.valueLength} chars) | ${c.source.method} ${cell(c.source.path)} (${c.source.kind} ${cell(c.source.selector)}) | ${c.usedIn
            .map((u) => `${u.method} ${cell(u.path)} [${u.where.join(", ")}]`)
            .join("<br>")} | \`${cell(k6Extract(c))}\` |`
      ),
      ""
    );
  }
  lines.push(
    "## Next steps",
    "",
    "1. Grafana k6 Studio: File → Import HAR (flow.har) → Generator → enable Autocorrelation; compare with the table above.",
    "2. Or convert: `npx har-to-k6 flow.har -o flow-k6.js`, then replace recorded tokens with the extractions above.",
    "3. Move typed values to a data file (the --data keys in flow.json) and parameterize them per VU.",
    "4. Keep the --stop-at boundary: the recorded flow never crosses it and neither should the load test.",
    ""
  );
  return lines.join("\n");
}

// ── Browser side ──────────────────────────────────────────────────────────────

/** Prefer a role/name locator; fall back to the marker attribute if the name approximation differs. */
async function locate(page, c) {
  const marker = page.locator(`[data-discover-idx="${c.index}"]`);
  if (c.name && c.role !== "generic") {
    const byRole = page.getByRole(c.role, { name: c.name, exact: true });
    const count = Math.min(await byRole.count().catch(() => 0), 10);
    for (let k = 0; k < count; k++) {
      if ((await byRole.nth(k).getAttribute("data-discover-idx").catch(() => null)) === String(c.index)) {
        const nth = count > 1 ? `.nth(${k})` : "";
        return { locator: byRole.nth(k), description: `getByRole("${c.role}", { name: "${c.name}" })${nth}` };
      }
    }
  }
  return { locator: marker, description: `${c.tag} "${c.name || c.text || ""}" (marker)` };
}

/** Wait until no request has been in flight for 500 ms, or the timeout. */
async function settle(page, tracker, timeoutMs) {
  await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs }).catch(() => {});
  const end = Date.now() + timeoutMs;
  let quietSince = Date.now();
  while (Date.now() < end) {
    if (tracker.pending.size > 0) quietSince = Date.now();
    else if (Date.now() - quietSince >= 500) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

/**
 * Run a discovery session.
 * @param {object} opts   parsed CLI options (see bin/discover-flow.js)
 * @param {object} deps   { decider, chromium, log } — injectable for tests
 * @returns {Promise<{ flow: object, files: object, exitCode: number }>}
 */
async function runDiscovery(opts, deps = {}) {
  const log = deps.log || ((msg) => console.log(`[discover] ${msg}`));
  const decider = deps.decider;
  const chromium = deps.chromium || require("playwright").chromium;
  const data = opts.data || {};
  const dataKeys = Object.keys(data);
  const denyRe = opts.denyText || DEFAULT_DENY;
  const stopAt = opts.stopAt || [];
  const startHost = new URL(opts.url).hostname;
  const allowHosts = [startHost, ...(opts.allowHosts || [])];
  const blockHosts = opts.blockHosts || [];
  const maxSteps = opts.maxSteps || 30;
  const out = path.resolve(opts.out);
  const files = {
    har: path.join(out, "flow.har"),
    json: path.join(out, "flow.json"),
    md: path.join(out, "flow.md"),
    plan: path.join(out, "flow-plan.md"),
    trace: opts.trace ? path.join(out, "trace.zip") : null,
  };
  const r = (s) => redact(s, data);

  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  const startedAt = new Date();
  const tracker = { pending: new Set(), total: 0, blocked: 0, hosts: new Set(), offAllowlist: null };
  const steps = [];
  const history = [];
  const seenStates = new Map();
  const planned = new Set();
  const denied = new Set();
  let tokensUsed = 0;
  let stopReason = "max-steps";
  let stopDetail = "";

  const browser = await chromium.launch({ headless: opts.headless !== false });
  try {
    const context = await browser.newContext({
      recordHar: { path: files.har, content: "embed" },
      ...(opts.userAgent ? { userAgent: opts.userAgent } : {}),
      ...(opts.storageState ? { storageState: opts.storageState } : {}),
    });
    if (files.trace) await context.tracing.start({ screenshots: true, snapshots: true });
    const page = await context.newPage();

    await context.route("**/*", (route) => {
      const request = route.request();
      const host = new URL(request.url()).hostname;
      if (blockHosts.length && hostMatches(host, blockHosts)) {
        tracker.blocked++;
        return route.abort("blockedbyclient");
      }
      let mainFrameNav = false;
      try {
        mainFrameNav = request.isNavigationRequest() && request.frame().parentFrame() === null;
      } catch {
        /* service worker requests have no frame */
      }
      if (mainFrameNav && !hostMatches(host, allowHosts)) {
        tracker.blocked++;
        tracker.offAllowlist = tracker.offAllowlist || host;
        return route.abort("blockedbyclient");
      }
      return route.fallback();
    });
    page.on("request", (req) => {
      tracker.pending.add(req);
      tracker.total++;
      tracker.hosts.add(new URL(req.url()).hostname);
    });
    const done = (req) => tracker.pending.delete(req);
    page.on("requestfinished", done);
    page.on("requestfailed", done);
    // Requests of the previous document whose body was never read never "finish"; forget them
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) for (const req of tracker.pending) if (!req.isNavigationRequest()) tracker.pending.delete(req);
    });
    page.on("dialog", (dialog) => dialog.dismiss().catch(() => {})); // never confirm a dialog

    await page.goto(opts.url, { waitUntil: "domcontentloaded", timeout: opts.timeoutMs || 30000 });
    await settle(page, tracker, opts.settleMs || 5000);

    const stopAtHit = (url) => stopAt.find((re) => re.test(url));

    for (let n = 1; n <= maxSteps + 1; n++) {
      const url = page.url();
      const hit = stopAtHit(url);
      if (hit) {
        stopReason = "stop-at";
        stopDetail = `reached ${r(url)} (matches ${hit.source})`;
        break;
      }
      if (tracker.offAllowlist) {
        stopReason = "left-allowlist";
        stopDetail = `navigation to ${r(tracker.offAllowlist)} was blocked`;
        break;
      }
      if (n > maxSteps) break;
      if (opts.maxTokens && tokensUsed >= opts.maxTokens) {
        stopReason = "budget";
        stopDetail = `${tokensUsed} tokens used (limit ${opts.maxTokens})`;
        break;
      }

      const observation = await observe(page, { data, denyRe });
      for (const name of observation.deniedNames || []) denied.add(`${new URL(url).pathname}|${name}`);
      const state = url + "|" + observation.candidates.map((c) => `${c.index}:${c.name}:${c.value ?? ""}:${c.checked ?? ""}`).join(",");
      seenStates.set(state, (seenStates.get(state) || 0) + 1);
      if (!opts.dryRun && seenStates.get(state) >= LOOP_LIMIT) {
        stopReason = "loop";
        stopDetail = `same page state seen ${LOOP_LIMIT} times at ${r(url)}`;
        break;
      }

      const redacted = redactObservation(observation, data);
      const { decision, tokens } = await decider.decide({ goal: opts.goal, observation: redacted, dataKeys, history: history.slice(-10) });
      tokensUsed += tokens || 0;

      if (decision.action === "navigate_done" || decision.action === "stop") {
        stopReason = decision.action === "navigate_done" ? "goal-reached" : "decider-stop";
        stopDetail = r(decision.rationale);
        if (decision.confidence < (opts.minConfidence ?? 0.5) && decision.action === "stop") stopReason = "low-confidence";
        break;
      }
      if (decision.confidence < (opts.minConfidence ?? 0.5)) {
        stopReason = "low-confidence";
        stopDetail = `confidence ${decision.confidence.toFixed(2)} for ${decision.action}: ${r(decision.rationale)} — human review needed`;
        break;
      }
      const candidate = observation.candidates.find((c) => c.index === decision.index);
      if (!candidate) {
        stopReason = "invalid-decision";
        stopDetail = `${decision.action} on index ${decision.index}, which is not an offered (non-denied) candidate`;
        break;
      }

      let value = null;
      let note = "";
      if (decision.action === "fill" || decision.action === "select") {
        const resolved = resolveValue(candidate, decision.valueKey, data);
        if (resolved.error) {
          stopReason = "invalid-decision";
          stopDetail = resolved.error;
          break;
        }
        if (resolved.skip) note = resolved.skip;
        value = resolved;
      }

      const target = await locate(page, candidate);
      const step = {
        n,
        action: note ? "skip" : decision.action,
        executed: false,
        locator: r(target.description),
        ...(decision.valueKey ? { valueKey: r(decision.valueKey) } : {}),
        urlBefore: r(url),
        urlAfter: r(url),
        durationMs: 0,
        requests: 0,
        rationale: r(decision.rationale),
        confidence: decision.confidence,
      };

      if (opts.dryRun) {
        const key = `${decision.action}|${decision.index}|${decision.valueKey}`;
        if (planned.has(key)) {
          stopReason = "dry-run-complete";
          stopDetail = "the decider repeated a planned step; the page does not change in a dry run";
          break;
        }
        planned.add(key);
        step.note = note || "dry run: planned, not executed";
      } else if (note) {
        step.note = note;
      } else {
        const requestsBefore = tracker.total;
        const t0 = Date.now();
        try {
          const timeout = opts.actionTimeoutMs || 10000;
          if (decision.action === "click") await target.locator.click({ timeout });
          else if (decision.action === "fill") await target.locator.fill(value.value, { timeout });
          else if (decision.action === "select") {
            await target.locator.selectOption(value.firstOption ? { index: Math.min(1, (candidate.options || []).length - 1) } : value.value, { timeout });
          } else if (decision.action === "check") {
            if (candidate.tag === "input") await target.locator.check({ timeout });
            else await target.locator.click({ timeout });
          }
          step.executed = true;
        } catch (error) {
          step.note = r(`action failed: ${error.message.split("\n")[0]}`);
        }
        await settle(page, tracker, opts.settleMs || 5000);
        step.durationMs = Date.now() - t0;
        step.requests = tracker.total - requestsBefore;
        step.urlAfter = r(page.url());
      }

      steps.push(step);
      const summary = `step ${n}: ${step.action} ${describeCandidate(redacted.candidates.find((c) => c.index === candidate.index) || candidate)}${step.valueKey ? ` <- ${step.valueKey}` : ""}${step.note ? ` (${step.note})` : ""}`;
      history.push(`${summary} ${step.urlBefore} -> ${step.urlAfter}`);
      log(`${summary} | ${step.urlBefore} -> ${step.urlAfter} | ${step.durationMs} ms, ${step.requests} req`);
    }

    if (files.trace) await context.tracing.stop({ path: files.trace });
    await context.close(); // flushes the HAR
  } finally {
    await browser.close();
  }

  // ── Artifacts ──
  const har = JSON.parse(fs.readFileSync(files.har, "utf8"));
  const flow = {
    schemaVersion: 1,
    goal: r(opts.goal),
    decider: { name: decider.name, model: decider.model || "n/a" },
    startUrl: r(opts.url),
    dryRun: !!opts.dryRun,
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    stopReason,
    ...(stopDetail ? { stopDetail } : {}),
    outcome: SUCCESS.has(stopReason) ? "success" : "safety-stop",
    tokensUsed,
    steps,
    hostsSeen: [...tracker.hosts].sort(),
    endpoints: endpoints(har, allowHosts),
    correlations: correlations(har, allowHosts),
    guardrails: {
      allowHosts,
      blockHosts,
      stopAt: stopAt.map((re) => re.source),
      denyText: denyRe.source,
      maxSteps,
      redaction: true,
      deniedCandidates: denied.size,
      blockedRequests: tracker.blocked,
    },
  };

  validateFlow(flow);
  const texts = { "flow.json": JSON.stringify(flow, null, 2) + "\n", "flow.md": renderFlowMd(flow), "flow-plan.md": renderPlanMd(flow) };
  for (const [name, text] of Object.entries(texts)) assertNoPii(name, text);
  fs.writeFileSync(files.json, texts["flow.json"], { mode: 0o600 });
  fs.writeFileSync(files.md, texts["flow.md"], { mode: 0o600 });
  fs.writeFileSync(files.plan, texts["flow-plan.md"], { mode: 0o600 });
  for (const f of Object.values(files)) if (f && fs.existsSync(f)) fs.chmodSync(f, 0o600);

  log(`stopped: ${stopReason}${stopDetail ? ` — ${stopDetail}` : ""}`);
  return { flow, files, exitCode: flow.outcome === "success" ? 0 : 3 };
}

module.exports = { runDiscovery, resolveValue, syntheticValue, assertNoPii, validateFlow, renderFlowMd, renderPlanMd, SCHEMA_PATH };
