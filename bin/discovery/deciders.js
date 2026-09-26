// bin/discovery/deciders.js — pick the next action from a redacted observation.
//
// A decider is { name, decide(input) -> Promise<{ decision, tokens }> } where input is
// { goal, observation, dataKeys, history } — the SAME redacted object for every decider.
// Deciders only ever see --data KEYS, never the values.
//
// decision = { action, index, valueKey, rationale, confidence }
//   action: click | fill | select | check | navigate_done | stop

"use strict";

const { describeCandidate } = require("./observe");

const ACTIONS = ["click", "fill", "select", "check", "navigate_done", "stop"];
const JEV_URL = "https://api.typesafe.ai/v1/systemone";

const RULES = [
  "You explore a web application one step at a time to reach the goal, for a load-test recording.",
  "Only act on elements listed in page.candidates, by their index.",
  "For fill/select, value_key must be one of dataKeys, or \"synthetic:<short description>\" for clearly fake filler (e.g. synthetic:city name). Never invent credentials, card numbers or personal data.",
  "A password field may only be filled with the dataKeys entry \"password\"; if it is absent, stop.",
  "Use navigate_done when the page shows the goal is reached, and stop when no listed element moves safely toward the goal or a human should decide.",
  "Values shown as {{key}} were typed from that data key; <email>, <n>, <token> and <jwt> are redacted.",
  "iframes and shadowRoots count content you cannot reach; if the goal needs it, stop.",
  "confidence is your probability (0-1) that this step is right.",
].join("\n");

// ── Claude (Anthropic SDK) ────────────────────────────────────────────────────

const DECISION_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ACTIONS },
    index: { type: "integer", description: "candidate index, -1 for navigate_done/stop" },
    value_key: { type: "string", description: "data key or synthetic:<desc>; empty unless fill/select" },
    rationale: { type: "string" },
    confidence: { type: "number" },
  },
  required: ["action", "index", "value_key", "rationale", "confidence"],
  additionalProperties: false,
};

function buildClaudeRequest({ goal, observation, dataKeys, history }, model) {
  return {
    model,
    max_tokens: 4096,
    system: RULES,
    output_config: { format: { type: "json_schema", schema: DECISION_SCHEMA } },
    messages: [
      {
        role: "user",
        content: JSON.stringify({ goal, dataKeys, history, page: observation }),
      },
    ],
  };
}

function parseClaudeResponse(response) {
  if (response.stop_reason === "refusal") throw new Error("model refused the request");
  const text = (response.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  let out;
  try {
    out = JSON.parse(text);
  } catch {
    throw new Error(`unparseable decision (stop_reason=${response.stop_reason}): ${text.slice(0, 200)}`);
  }
  if (!ACTIONS.includes(out.action)) throw new Error(`unknown action "${out.action}"`);
  return {
    action: out.action,
    index: Number.isInteger(out.index) && out.index >= 0 ? out.index : null,
    valueKey: out.value_key || null,
    rationale: String(out.rationale || ""),
    confidence: typeof out.confidence === "number" ? out.confidence : 0,
  };
}

function createClaudeDecider({ model = process.env.DISCOVERY_MODEL || "claude-sonnet-5", client } = {}) {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set (--decider=claude)");
    let Anthropic;
    try {
      Anthropic = require("@anthropic-ai/sdk");
    } catch {
      throw new Error("@anthropic-ai/sdk is not installed: npm i -D @anthropic-ai/sdk");
    }
    client = new (Anthropic.default || Anthropic)();
  }
  return {
    name: "claude",
    model,
    async decide(input) {
      const response = await client.messages.create(buildClaudeRequest(input, model));
      const usage = response.usage || {};
      return { decision: parseClaudeResponse(response), tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0) };
    },
  };
}

// ── Jev (TypeSafe System One) ─────────────────────────────────────────────────

const STATUS = {
  continue: "The goal is not reached yet and one of the listed elements moves toward it.",
  goal_reached: "The current page shows that the goal has been reached.",
  stop: "No listed element moves safely toward the goal; a human should take over.",
};

/** Action implied by an element's role (Jev chooses the element, not the verb). */
function actionFor(candidate) {
  if (["textbox", "searchbox", "spinbutton"].includes(candidate.role)) return "fill";
  if (["combobox", "listbox"].includes(candidate.role) && candidate.tag === "select") return "select";
  if (["checkbox", "radio", "switch"].includes(candidate.role)) return "check";
  return "click";
}

function buildJevRequest({ goal, observation, dataKeys, history }, model = "jev-latest") {
  const state = { goal, dataKeys, history, page: observation };
  const questions = {
    status: {
      type: "choice",
      instructions: "An agent explores a web app toward `goal`. Looking at `page`, what should it do now?",
      criteria: STATUS,
    },
  };
  if (observation.candidates.length) {
    questions.target = {
      type: "choice",
      instructions:
        "Which element of `page.candidates` should the agent use next to move toward `goal`? Prefer empty required fields before submit buttons.",
      criteria: Object.fromEntries(observation.candidates.map((c) => [`c${c.index}`, describeCandidate(c)])),
    };
    const values = Object.fromEntries(dataKeys.map((k, i) => [`v${i}`, `The test value named "${k}".`]));
    values.synthetic = "None of the named values fits; type clearly fake filler.";
    values.none = "The chosen element takes no typed value (button, link, checkbox).";
    questions.value = {
      type: "choice",
      instructions:
        "If the chosen element is a text field or a select, which named test value from `dataKeys` should go into it? A password field only takes the value named \"password\".",
      criteria: values,
    };
  }
  return { model, state, questions };
}

/** Turn Jev answers into a decision; confidence is the lowest of the answers used. */
function mapJevAnswers(answers, { observation, dataKeys }) {
  const status = answers.status || { choice: "stop", confidence: 0 };
  if (status.choice !== "continue") {
    return {
      action: status.choice === "goal_reached" ? "navigate_done" : "stop",
      index: null,
      valueKey: null,
      rationale: `jev status=${status.choice}`,
      confidence: status.confidence,
    };
  }
  const target = answers.target;
  const index = target ? Number(String(target.choice).replace(/^c/, "")) : NaN;
  const candidate = observation.candidates.find((c) => c.index === index);
  if (!candidate) {
    return { action: "stop", index: null, valueKey: null, rationale: "jev chose no valid candidate", confidence: 0 };
  }
  const action = actionFor(candidate);
  let valueKey = null;
  let confidence = Math.min(status.confidence, target.confidence);
  if (action === "fill" || action === "select") {
    const value = answers.value || { choice: "none", confidence: 0 };
    confidence = Math.min(confidence, value.confidence);
    if (/^v\d+$/.test(value.choice)) valueKey = dataKeys[Number(value.choice.slice(1))] || null;
    else if (value.choice === "synthetic") valueKey = `synthetic:${candidate.name || candidate.role}`;
  }
  return { action, index, valueKey, rationale: `jev: ${describeCandidate(candidate)}`, confidence };
}

function createJevDecider({ model = process.env.TYPESAFE_MODEL || "jev-latest", fetchImpl = fetch } = {}) {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey && fetchImpl === fetch) throw new Error("TYPESAFE_API_KEY is not set (--decider=jev)");
  return {
    name: "jev",
    model,
    async decide(input) {
      const body = JSON.stringify(buildJevRequest(input, model));
      for (let attempt = 1; ; attempt++) {
        const response = await fetchImpl(JEV_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(60000),
        });
        if (response.ok) {
          const { answers } = await response.json();
          // ponytail: TypeSafe reports no token usage; chars/4 estimate keeps --max-tokens meaningful
          return { decision: mapJevAnswers(answers || {}, input), tokens: Math.ceil(body.length / 4) };
        }
        if (![429, 529].includes(response.status) || attempt === 3) {
          throw new Error(`TypeSafe API ${response.status}: ${(await response.text()).slice(0, 300)}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
      }
    },
  };
}

function createDecider(name, opts = {}) {
  if (name === "claude") return createClaudeDecider(opts);
  if (name === "jev") return createJevDecider(opts);
  throw new Error(`unknown --decider "${name}" (claude|jev)`);
}

module.exports = {
  ACTIONS,
  RULES,
  buildClaudeRequest,
  parseClaudeResponse,
  createClaudeDecider,
  actionFor,
  buildJevRequest,
  mapJevAnswers,
  createJevDecider,
  createDecider,
};
