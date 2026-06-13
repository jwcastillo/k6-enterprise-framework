---
id: agents
title: AI Agents
sidebar_position: 1
---

# AI Agents

The k6 Enterprise Framework ships a four-agent AI pipeline (Planner, Builder, Analyst, Reporter) plus cross-cutting helpers (BudgetManager, AnomalyDetector, SelfHealing). All agents route LLM completions through a vendor-neutral `LLMProvider` abstraction shipped in Phase 5 / AI-01.

## Overview

Use the AI module when you want the framework to:

- **Plan** a test from a free-form spec (`PlannerAgent`).
- **Build** the resulting k6 scenario from the plan (`BuilderAgent`).
- **Analyze** an executed run for anomalies and root-cause correlations (`AnalystAgent`).
- **Report** results to humans in plain prose, with executive summaries (`ReporterAgent`).

Skip the AI module when you can write the scenario directly — most enterprise teams operate fine without it. The AI path adds LLM cost ($, latency) and dependency on an external provider. The framework runs perfectly fine with the AI module disabled.

`BudgetManager` and `AnomalyDetector` are cross-cutting: every agent enforces a per-agent USD/token budget through `BudgetManager`, and the Analyst uses `AnomalyDetector` (z-score + IQR + CUSUM + percentile) to surface outliers without relying on LLM judgement.

All four agents accept an injectable `provider: LLMProvider` (see [Provider abstraction](#provider-abstraction)). When omitted, they default to `AnthropicProvider` constructed via the `LLM_API_KEY → ANTHROPIC_API_KEY` env fallback chain.

## Agent contracts

### PlannerAgent

**Purpose.** Convert a natural-language spec + parsed OpenAPI/curl examples into a structured `TestPlan` (scenarios, profiles, expected thresholds).

**Inputs.** `PlannerInput` — see `src/types/ai.d.ts`. Minimum fields: `spec` (string), optional `openApi`, `examples`, `constraints`. Construct via:

```typescript
import { PlannerAgent } from "../../src/ai";
const planner = new PlannerAgent({ apiKey: process.env.LLM_API_KEY });
const result = await planner.plan({ spec: "..." });
```

**Outputs.** `PlannerOutput` containing a `TestPlan`, `tokensUsed`, and a confidence score. The plan is the input to `BuilderAgent`.

**Safety guarantees.** Spec is treated as untrusted; secrets cannot be embedded in the prompt — `K6_AI_PROMPT_REDACT` masks tokens before sending. Confidence below the configured threshold causes the pipeline to halt instead of building a low-quality scenario.

**Cost expectations.** Typical plan call: ~1–5K input tokens + ~2–4K output. At Sonnet rates (`0.003 / 0.015 USD per 1K`), that's ~$0.03–0.10 per planning call.

### BuilderAgent

**Purpose.** Generate the `GeneratedScript` (k6 scenario TypeScript file + supporting files) from a `TestPlan`.

**Inputs.** `BuilderInput` containing the `TestPlan` + optional `errorFeedback` (used by `SelfHealingEngine` to re-attempt after a validation failure).

**Outputs.** `GeneratedScript` — a struct with `files: GeneratedFile[]`, validation result, and metadata (agent version, confidence, source plan id).

**Safety guarantees.** Outputs are validated against `ScriptSchema` before being returned to the caller. Hardcoded credentials are rejected; the generator MUST use `__ENV.VARIABLE` for all secrets (`CHK-SEC-112`).

**Cost expectations.** Typical build call: ~2–6K input + ~3–8K output. At Sonnet rates, ~$0.05–0.13 per call. Higher when `errorFeedback` includes substantial prior output.

### AnalystAgent

**Purpose.** Read k6 summary + observability data (Prometheus, Tempo, Loki, Pyroscope) and produce structured anomaly correlations plus an executive summary.

**Inputs.** `AnalystInput` — k6 summary, regression detection results, observability query bundle.

**Outputs.** `AnalystOutput` with `anomalies[]`, `correlations[]`, `executiveSummary`, and `recommendations[]`. Each correlation carries a `confidence ∈ [0,1]` field.

**Safety guarantees.** Sensitive log/trace data is masked before being sent to the LLM (`CHK-SEC-113`). LLM is constrained to JSON-only responses; non-JSON output is rejected.

**Cost expectations.** Largest input footprint of all agents. Typical: ~5–20K input + ~2–4K output → $0.05–0.20 per analysis call.

### ReporterAgent

**Purpose.** Render an `AnalystOutput` into human-readable executive and technical summaries suitable for Slack/email distribution.

**Inputs.** `ReporterInput` — the analyst result + audience flag (`executive` | `technical`).

**Outputs.** `ReporterOutput` with `executiveSummary` (≤150 words) and `technicalSummary` (≤300 words). Both pass through `maskSensitive()` before return.

**Safety guarantees.** No raw tokens, passwords, or trace IDs in the output (`CHK-SEC-114`, `CHK-SEC-117`). Output is JSON-only.

**Cost expectations.** Smallest: ~2–4K input + ~1–2K output → $0.02–0.05 per report call.

## BudgetManager

`BudgetManager` (`src/ai/core/budget-manager.ts`) enforces per-agent spending limits via a circuit breaker. Defaults:

| Limit | Default | Env knob |
| --- | --- | --- |
| USD per pipeline run | `5.0` | `K6_AI_BUDGET_USD` |
| Requests per minute | `60` | `K6_AI_BUDGET_RPM` |
| Tokens per minute | `100000` | `K6_AI_BUDGET_TPM` |

When any limit is exceeded, the breaker trips and subsequent agent calls throw `BudgetExceededError`. The breaker is per-agent (Planner, Builder, Analyst, Reporter) so a runaway agent cannot starve siblings within the same pipeline.

## AnomalyDetector

`AnomalyDetector` (`src/ai/analysis/anomaly-detector.ts`) is the multi-algorithm anomaly engine used by `AnalystAgent` and by standalone callers. It never invokes an LLM — it operates purely on numeric time series.

### Z-score

Fires when a sample deviates more than `sensitivity` standard deviations from the rolling mean (default 3.0; `sensitivity: "medium"` → 2.5, `"high"` → 2.0).

### IQR (Interquartile Range)

Fires when a sample falls outside `[Q1 − 1.5·IQR, Q3 + 1.5·IQR]`. Robust against heavy-tailed distributions.

### CUSUM (Cumulative Sum)

Detects sustained shifts in the mean by accumulating signed deviations and comparing to a threshold. Best for slow drifts that z-score misses.

### Percentile bound

Fires when the observed p95/p99 exceeds a configured ceiling. Useful for SLO-derived bounds (e.g. "p95 must be < 800 ms").

Override defaults via `new AnomalyDetector({ sensitivity, p95Ceiling, cusumThreshold, ... })` or by editing the `anomalyDetectorConfig` option passed into `AnalystAgent`.

## SelfHealing safeguards

`SelfHealingEngine` (`src/ai/adaptive/self-healing.ts`) auto-repairs failing k6 scripts by re-invoking `BuilderAgent` with the error trace as context. The Phase 5 / AI-03 hardening makes this safe by default:

- **Sandbox.** Fixes land in `path.join(os.tmpdir(), "k6-self-healing", crypto.randomUUID())/<basename>.fixed.ts`. Source paths under `clients/` are never written directly.
- **Diff emission.** A unified diff between the original and the candidate is `console.warn`'d BEFORE the gate check, so operators see the proposed change even when the gate denies it.
- **Apply gate (strict precedence).**
  1. `K6_AI_AUTO_APPLY=true` → silent apply.
  2. Interactive TTY → 30 s prompt, default no (any non-`y` answer or timeout = skip).
  3. Neither → log `[self-healing] fix proposed at <tmp> — not applied` and return.
- **Test-pass gate.** The configured `testCommand` (default `["pnpm", "vitest", "run", "--passWithNoTests"]`) runs with `K6_AI_HEAL_TARGET=<tmp>` injected. Only on exit code 0 does the engine `copyFile(tmp, originalPath)`.
- **Retry cap.** `MAX_RETRIES = 3` per failing test in a single run (`EC-AI-007`).

| Gate | Purpose | Env var |
| --- | --- | --- |
| Apply gate (env) | CI-friendly silent promotion | `K6_AI_AUTO_APPLY` |
| Apply gate (interactive) | Human-in-the-loop review | (TTY detection) |
| Test-pass gate | Empirical safety net before copy | (none — derived from `testCommand` exit) |

Promotion uses `fs.promises.copyFile(tmpPath, originalPath)`. The tmp dir is preserved even on success so operators can inspect the diff after the fact.

## ChromaDB outage behavior

The Knowledge Base RAG layer (`src/ai/knowledge-base/knowledge-base.ts`) ships with explicit warn-vs-throw behavior when ChromaDB is unreachable:

| Condition | Behavior |
| --- | --- |
| `useKnowledgeBase: false` | No ChromaDB call, no warning. |
| `useKnowledgeBase: true` + reachable | RAG active. |
| `useKnowledgeBase: true` + unreachable + `K6_AI_REQUIRE_RAG` unset/false | `console.warn(...)` + degrade (queries return `null`). |
| `useKnowledgeBase: true` + unreachable + `K6_AI_REQUIRE_RAG=true` | Throw `Error("RAG required ... unreachable")`. |

Callers can branch on `KnowledgeBaseManager.isDegraded(): boolean` to detect the degraded state programmatically without parsing log strings. The `@ts-ignore` previously sitting on the chromadb import was removed in Phase 5 / AI-04 — types now resolve via the local `src/types/chromadb.d.ts` shim so the import compiles even when the optional peer dep is not installed.

The ChromaDB connection is configured via env: `CHROMA_HOST` (default `localhost`) and `CHROMA_PORT` (default `8000`). Leave unset to skip RAG entirely.

## Provider abstraction

`LLMProvider` (`src/ai/core/llm-provider.ts`) is the vendor-neutral contract every agent consumes. Three methods:

```typescript
interface LLMProvider {
  readonly name: string;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;
  embed(text: string): Promise<number[]>;
  estimateCost(usage: TokenUsage, model?: string): EstimateCostResult;
}
```

Shipped implementations:

- **`AnthropicProvider`** (`src/ai/core/providers/anthropic-provider.ts`) — wraps `@anthropic-ai/sdk`. The ONE production file allowed to import the SDK (enforced by ESLint `no-restricted-imports` and `test/ai/sdk-boundary.test.ts`).
- **`OpenAIProvider`** (stub) — interface compatibility only; throws `Error("OpenAIProvider not implemented for v0.3.0; use AnthropicProvider")`. Demonstrates that the interface compiles cleanly with a second provider.

### Adding a new provider

1. Implement `LLMProvider` in `src/ai/core/providers/<vendor>-provider.ts`.
2. Re-export it from `src/ai/core/providers/index.ts`.
3. Pass at the agent boundary: `new PlannerAgent({ provider: new MyProvider({ ... }) })`.
4. Update the `EXPECTED_SDK_IMPORTERS` allow-list in `test/ai/sdk-boundary.test.ts` if your provider imports a new vendor SDK.

### Pricing config

Costs are read from `src/ai/core/pricing.json` (D-06 schema):

```json
{
  "default": "claude-sonnet-4-6",
  "models": {
    "claude-sonnet-4-6": { "input_usd_per_1k": 0.003, "output_usd_per_1k": 0.015 },
    "claude-opus-4-7":   { "input_usd_per_1k": 0.015, "output_usd_per_1k": 0.075 }
  }
}
```

Env overrides apply to the DEFAULT model only (Phase 5 / AI-02 / D-07):

```bash
LLM_INPUT_USD_PER_1K=0.002 LLM_OUTPUT_USD_PER_1K=0.010 ./bin/run-test.sh ...
```

To add a model: append it to `pricing.json` and pass its id via `chat({ model: "..." })` or via the agent's `config.model`. Unknown models fall back to the default rate AND default model name (D-08, no throw) — `estimateCost()` returns the model that was actually billed.

## Cross-references

- `framework/ai/ai-config.md` — full env-var catalogue and bootstrap walkthrough.
- `framework/ai/mcp-server.md` — MCP integration for AI-assisted scaffold generation.
