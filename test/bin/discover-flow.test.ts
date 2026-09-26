/**
 * Flow discovery — pure units: deny filtering, redaction, value resolution, HAR analysis,
 * decider request/answer mapping and the output guards. No browser, no network.
 */

import { describe, it, expect } from "vitest";

const { DEFAULT_DENY, isDenied, maskValues, redact, redactObservation } = require("../../bin/discovery/observe.js");
const {
  buildClaudeRequest,
  parseClaudeResponse,
  createClaudeDecider,
  buildJevRequest,
  mapJevAnswers,
  createJevDecider,
} = require("../../bin/discovery/deciders.js");
const { templatePath, endpoints, correlations, hostMatches } = require("../../bin/discovery/har-analysis.js");
const { resolveValue, assertNoPii, validateFlow } = require("../../bin/discovery/explore.js");
const { parseCli } = require("../../bin/discover-flow.js");

const data = { plate: "TEST-001", email: "qa.user@example.com" };

const observation = {
  url: "https://app.example.com/form?session=abcdef1234567890abcdef12",
  title: "Hello qa.user@example.com",
  iframes: 1,
  shadowRoots: 0,
  truncated: false,
  deniedCount: 1,
  deniedNames: ["Pay now"],
  candidates: [
    { index: 0, role: "textbox", name: "Plate", text: "", tag: "input", type: "text", disabled: false, filled: false, value: "" },
    { index: 1, role: "textbox", name: "Email", text: "", tag: "input", type: "email", disabled: false, filled: true, value: "{{email}}" },
    { index: 3, role: "button", name: "Search", text: "Search", tag: "button", type: "", disabled: false },
  ],
};

describe("deny filtering", () => {
  it("denies payment, purchase and destructive elements by default", () => {
    for (const name of ["Pay now", "Buy", "Confirm order", "Delete account", "Pagar", "Eliminar", "Checkout"]) {
      expect(isDenied({ name, text: name }, DEFAULT_DENY), name).toBe(true);
    }
  });

  it("keeps ordinary navigation and checks visible text too", () => {
    expect(isDenied({ name: "Continue", text: "Continue" }, DEFAULT_DENY)).toBe(false);
    expect(isDenied({ name: "Payment options", text: "Payment options" }, DEFAULT_DENY)).toBe(false);
    expect(isDenied({ name: "icon", text: "Buy now" }, DEFAULT_DENY)).toBe(true);
  });
});

describe("redaction", () => {
  it("replaces --data values with their key, then emails, JWTs, tokens and digit runs", () => {
    expect(redact("plate TEST-001 for qa.user@example.com", data)).toBe("plate {{plate}} for {{email}}");
    expect(redact("other@example.org eyJhbGci.eyJzdWIi.sig order 12345", {})).toBe("<email> <jwt> order <n>");
    expect(redact("s=abcdef1234567890abcdef12", {})).toBe("s=<token>");
    expect(redact("http://localhost:8080/orders/12345", {})).toBe("http://localhost:8080/orders/<n>");
  });

  it("masks form values: data keys by name, anything else by length", () => {
    const [a, b, c] = maskValues(
      [{ value: "qa.user@example.com" }, { value: "secret" }, { value: "" }],
      data
    );
    expect(a).toMatchObject({ filled: true, value: "{{email}}" });
    expect(b).toMatchObject({ filled: true, value: "<6 chars>" });
    expect(c).toMatchObject({ filled: false, value: "" });
  });

  it("never passes raw values or the local denied names to a decider", () => {
    const out = JSON.stringify(redactObservation(observation, data));
    expect(out).not.toMatch(/qa\.user@example\.com|abcdef1234567890/);
    expect(out).not.toContain("deniedNames");
    expect(out).toContain("<token>");
  });
});

describe("resolveValue", () => {
  const text = { type: "text", tag: "input", name: "City", role: "textbox" };

  it("types only --data values or declared synthetic filler", () => {
    expect(resolveValue(text, "plate", data)).toEqual({ value: "TEST-001" });
    expect(resolveValue({ ...text, name: "Email" }, "synthetic:email", data)).toEqual({ value: "discovery.test@example.com" });
    expect(resolveValue(text, "creditCard", data).error).toMatch(/not a --data key/);
    expect(resolveValue(text, null, data).error).toBeDefined();
  });

  it("never types into a password field unless --data has a password key", () => {
    const pwd = { ...text, type: "password" };
    expect(resolveValue(pwd, "synthetic:password", data).skip).toMatch(/password/);
    expect(resolveValue(pwd, "email", data).skip).toBeDefined();
    expect(resolveValue(pwd, "password", { password: "p4ss" })).toEqual({ value: "p4ss" });
  });
});

describe("HAR analysis", () => {
  const entry = (method: string, url: string, resBody: unknown, reqBody?: string, headers: object[] = []) => ({
    request: { method, url, headers, postData: reqBody ? { text: reqBody } : undefined },
    response: {
      status: 200,
      content: resBody === undefined ? { mimeType: "text/html" } : { mimeType: "application/json", text: JSON.stringify(resBody) },
    },
  });
  const token = "9f86d081884c7d659a2feaa0c55ad015";
  const har = {
    log: {
      entries: [
        entry("GET", "https://app.example.com/app.js", undefined),
        entry("POST", "https://app.example.com/api/login", { auth: { token }, user: "active" }, '{"email":"qa.user@example.com"}'),
        entry("GET", "https://cdn.other.net/api/pixel", undefined),
        entry("GET", `https://app.example.com/api/orders/123?t=${token}`, { ok: true }, undefined, [
          { name: "X-Session", value: token },
          { name: "Cookie", value: `sid=${token}` },
        ]),
        entry("POST", "https://app.example.com/api/echo", { email: "qa.user@example.com" }, '{"email":"qa.user@example.com"}'),
      ],
    },
  };

  it("templates variable path segments", () => {
    expect(templatePath("/api/orders/123/items/0f8fad5b-d9cb-469f-a165-70867728950e")).toBe("/api/orders/{id}/items/{uuid}");
    expect(templatePath(`/s/${token}/x`)).toBe("/s/{token}/x");
  });

  it("lists first-party, non-static endpoints in order", () => {
    expect(endpoints(har, ["app.example.com"]).map((e: { method: string; path: string }) => `${e.method} ${e.path}`)).toEqual([
      "POST /api/login",
      "GET /api/orders/{id}",
      "POST /api/echo",
    ]);
  });

  it("detects a response value reused later, ignoring values the client sent first and cookies", () => {
    const found = correlations(har, ["app.example.com"]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      name: "token",
      valueLength: 32,
      source: { method: "POST", path: "/api/login", kind: "json", selector: "auth.token" },
      usedIn: [{ method: "GET", path: "/api/orders/{id}", where: ["url", "header x-session"] }],
    });
    expect(JSON.stringify(found)).not.toContain(token);
  });

  it("matches wildcard hosts", () => {
    expect(hostMatches("a.x.com", ["*.x.com"])).toBe(true);
    expect(hostMatches("x.com", ["*.x.com"])).toBe(true);
    expect(hostMatches("evilx.com", ["*.x.com"])).toBe(false);
  });
});

describe("Claude decider", () => {
  const input = { goal: "search", observation: redactObservation(observation, data), dataKeys: Object.keys(data), history: [] };

  it("sends the redacted observation and data keys only, with a JSON schema and no temperature", () => {
    const req = buildClaudeRequest(input, "claude-sonnet-5");
    expect(req.model).toBe("claude-sonnet-5");
    expect(req).not.toHaveProperty("temperature");
    expect(req.output_config.format.type).toBe("json_schema");
    expect(req.messages[0].content).not.toMatch(/TEST-001|qa\.user@example\.com/);
    expect(JSON.parse(req.messages[0].content).dataKeys).toEqual(["plate", "email"]);
  });

  it("parses the JSON decision", () => {
    const decision = parseClaudeResponse({
      stop_reason: "end_turn",
      content: [{ type: "text", text: '{"action":"fill","index":0,"value_key":"plate","rationale":"empty field","confidence":0.9}' }],
    });
    expect(decision).toEqual({ action: "fill", index: 0, valueKey: "plate", rationale: "empty field", confidence: 0.9 });
    expect(parseClaudeResponse({ content: [{ type: "text", text: '{"action":"stop","index":-1,"value_key":"","rationale":"x","confidence":1}' }] }).index).toBeNull();
  });

  it("rejects refusals, bad JSON and unknown actions", () => {
    expect(() => parseClaudeResponse({ stop_reason: "refusal", content: [] })).toThrow(/refused/);
    expect(() => parseClaudeResponse({ content: [{ type: "text", text: "nope" }] })).toThrow(/unparseable/);
    expect(() => parseClaudeResponse({ content: [{ type: "text", text: '{"action":"purchase"}' }] })).toThrow(/unknown action/);
  });

  it("counts tokens through an injected client", async () => {
    const client = {
      messages: {
        create: async () => ({
          usage: { input_tokens: 100, output_tokens: 20 },
          content: [{ type: "text", text: '{"action":"click","index":3,"value_key":"","rationale":"submit","confidence":0.8}' }],
        }),
      },
    };
    const result = await createClaudeDecider({ client, model: "m" }).decide(input);
    expect(result).toMatchObject({ tokens: 120, decision: { action: "click", index: 3 } });
  });
});

describe("Jev decider", () => {
  const input = { goal: "search", observation: redactObservation(observation, data), dataKeys: Object.keys(data), history: [] };

  it("asks status, target and value as choice questions over the same redacted observation", () => {
    const req = buildJevRequest(input);
    expect(req.model).toBe("jev-latest");
    expect(Object.keys(req.questions)).toEqual(["status", "target", "value"]);
    expect(Object.values(req.questions).every((q: { type: string }) => q.type === "choice")).toBe(true);
    expect(Object.keys(req.questions.target.criteria)).toEqual(["c0", "c1", "c3"]);
    expect(req.questions.target.criteria.c1).toContain("{{email}}");
    expect(Object.keys(req.questions.value.criteria)).toEqual(["v0", "v1", "synthetic", "none"]);
    expect(JSON.stringify(req)).not.toMatch(/TEST-001|qa\.user@example\.com/);
  });

  it("maps answers to a decision, deriving the action from the element role", () => {
    const fill = mapJevAnswers(
      { status: { choice: "continue", confidence: 0.9 }, target: { choice: "c0", confidence: 0.8 }, value: { choice: "v0", confidence: 0.7 } },
      input
    );
    expect(fill).toMatchObject({ action: "fill", index: 0, valueKey: "plate", confidence: 0.7 });

    const click = mapJevAnswers(
      { status: { choice: "continue", confidence: 0.9 }, target: { choice: "c3", confidence: 0.6 }, value: { choice: "none", confidence: 0.1 } },
      input
    );
    expect(click).toMatchObject({ action: "click", index: 3, valueKey: null, confidence: 0.6 });

    expect(mapJevAnswers({ status: { choice: "goal_reached", confidence: 0.95 } }, input).action).toBe("navigate_done");
    expect(mapJevAnswers({ status: { choice: "continue", confidence: 0.9 }, target: { choice: "c99", confidence: 1 } }, input).action).toBe("stop");
  });

  it("posts to TypeSafe with the bearer key via an injected fetch", async () => {
    let seen: { url?: string; body?: { questions: object } } = {};
    const fetchImpl = async (url: string, init: { body: string }) => {
      seen = { url, body: JSON.parse(init.body) };
      return { ok: true, json: async () => ({ answers: { status: { choice: "stop", confidence: 0.9 } } }) };
    };
    const { decision } = await createJevDecider({ fetchImpl }).decide(input);
    expect(seen.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(decision.action).toBe("stop");
  });
});

describe("output guards", () => {
  it("fails closed when an artifact carries PII or secrets", () => {
    expect(() => assertNoPii("flow.md", "step to /results")).not.toThrow();
    for (const bad of ["a@b.com", "eyJa.eyJb.c", "Cookie: sid=1", "Authorization: Basic x", "Bearer abcdefghijk", "id 12345678"]) {
      expect(() => assertNoPii("flow.md", bad), bad).toThrow(/PII check failed/);
    }
  });

  it("rejects a flow.json that does not match the published schema", () => {
    expect(() => validateFlow({ schemaVersion: 1 })).toThrow(/discovery-flow.schema.json/);
  });
});

describe("CLI parsing", () => {
  it("parses repeatable stop-at, host lists and defaults", () => {
    const opts = parseCli(["--url=https://app.example.com", "--goal", "g", "--stop-at=/pay", "--stop-at", "/checkout", "--block-hosts=*.ads.net", "--no-headless"]);
    expect(opts.stopAt.map((r: RegExp) => r.source)).toEqual(["\\/pay", "\\/checkout"]);
    expect(opts).toMatchObject({ decider: "claude", maxSteps: 30, headless: false, blockHosts: ["*.ads.net"], dryRun: false });
  });

  it("rejects missing or invalid input", () => {
    expect(() => parseCli(["--goal=g"])).toThrow(/--url and --goal/);
    expect(() => parseCli(["--url=file:///etc/passwd", "--goal=g"])).toThrow(/http/);
    expect(() => parseCli(["--url=https://a.com", "--goal=g", "--max-steps=0"])).toThrow(/positive/);
  });
});
