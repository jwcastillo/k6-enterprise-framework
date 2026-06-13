---
title: "k6 Enterprise Framework — Roadmap v2.0: Intelligent Quality Platform"
sidebar_position: 3
---
# k6 Enterprise Framework — Roadmap v2.0: Intelligent Quality Platform

**Date**: 2026-02-18
**Version**: 2.0-alpha
**Spec**: 001-service-perf-resilience

---

## General Vision

Version 2.0 transforms the k6 Enterprise Framework from an "Enterprise Test Runner" to an **Intelligent Quality Platform** through an ecosystem of 4 specialized AI agents that collaborate in a pipeline to plan, build, execute, and analyze performance tests autonomously.

```
Specification
   | (OpenAPI / text / natural language)
   v
+--------------+    TestPlan    +--------------+   Scripts .ts  +---------------+
|  Planner     | ------------> |  Builder     | -------------> |   k6 via MCP  |
|    Agent     |               |    Agent     |                |  (run_test)   |
+--------------+               +--------------+                +------+--------+
                                                                      | JSON results
                                                                      v
                                                            +------------------+
+--------------+  AnalysisReport  +--------------+          |   Observability  |
|  Reporter    | <--------------- |  Analyst     | <------- | Prometheus/Tempo |
|    Agent     |                  |    Agent     |          |  Loki/Pyroscope  |
+--------------+                  +--------------+          +------------------+
       |
       +-- Slack / Teams (enriched alerts)
       +-- Jira (automatic tickets)
       +-- HTML reports (executive + technical)
```

---

## Roadmap Sub-phases

### v2.0-alpha (T-106 to T-114) — Extended MCP + Builder Agent + Knowledge Base

**Functional deliverables**:
- ChromaDB vector database with RAG over framework scripts, docs, and helpers
- Planner Agent: generates TestPlan from OpenAPI / text / natural language
- Builder Agent: generates executable TypeScript k6 scripts from TestPlan (success rate >=95%)
- Budget Manager: token and cost control per agent
- Extended MCP with 5 new AI tools
- Builder validation suite (12 TestPlan fixtures)

**Standalone usage** (without full pipeline):
```bash
# Generate TestPlan from natural language description
npx ts-node src/ai/agents/planner-agent.ts \
  --format=natural-language \
  --spec="E-commerce API with checkout flow, 1000 concurrent users"

# Generate k6 script from TestPlan
npx ts-node src/ai/agents/builder-agent.ts \
  --plan=./test-plan.json

# Index knowledge base
node bin/ai/index-knowledge-base.js --full
```

---

### v2.0-beta (T-115 to T-118) — Analyst Agent + Deep Observability

**Functional deliverables**:
- Programmatic clients for Prometheus, Tempo, Loki, Pyroscope
- Anomaly Detector: z-score, IQR, CUSUM, percentile (no LLM, deterministic)
- Analyst Agent: root cause correlation crossing k6 + observability
- Analyst validation suite (8 datasets with ground truth)

**Standalone usage**:
```bash
# Analyze results from an execution
npx ts-node src/ai/agents/analyst-agent.ts \
  --results=./reports/client/test/2026-02-18/summary.json \
  --from=-1h

# Anomaly detector (no LLM)
npx ts-node src/ai/analysis/anomaly-detector.ts \
  --metrics=./reports/client/test/2026-02-18/summary.json \
  --baseline-runs=10
```

---

### v2.0-GA (T-119 to T-121) — Reporter Agent + Full Pipeline + Adaptive Engine

**Functional deliverables**:
- Reporter Agent: executive + technical summary + automatic Slack/Teams/Jira
- Pipeline orchestrator (Planner -> Builder -> run_test -> Analyst -> Reporter)
- Self-healing: auto-repairable scripts on API schema changes (repair rate >=70%)
- Full pipeline CLI e2e

**Full pipeline usage**:
```bash
# Full pipeline from description to report
node cmd/ai-pipeline.js \
  --client=acme-corp \
  --spec="Payment API with POST /charge and GET /status endpoints" \
  --format=natural-language \
  --notify=slack,jira

# Full pipeline from OpenAPI
node cmd/ai-pipeline.js \
  --client=acme-corp \
  --spec=./openapi.json \
  --format=openapi \
  --start-from=planner

# Start from a specific step
node cmd/ai-pipeline.js \
  --start-from=analyst \
  --input=./reports/run-results.json

# Dry-run mode (no LLM or real execution)
node cmd/ai-pipeline.js --dry-run --spec=./openapi.json
```

---

## Agent Descriptions

### Planner Agent (`src/ai/agents/planner-agent.ts`)

| Dimension | Detail |
|-----------|--------|
| **Input** | OpenAPI spec (JSON/YAML), functional requirements (text), natural language |
| **Output** | `TestPlan` (editable JSON, human-readable) |
| **Capabilities** | Endpoint extraction from OpenAPI, test type selection, realistic traffic models, architecture RAG query |
| **LLM** | claude-sonnet-4-6, temperature=0.3 |
| **Tokens/invocation** | ~8K input + ~2K output |
| **Estimated cost** | ~$0.054 USD/invocation |
| **Handled errors** | EC-AI-003 (Incomplete OpenAPI: partial plan with warnings) |

### Builder Agent (`src/ai/agents/builder-agent.ts`)

| Dimension | Detail |
|-----------|--------|
| **Input** | Validated `TestPlan` |
| **Output** | `GeneratedScript` (executable .ts files + data CSVs) |
| **Capabilities** | Few-shot via RAG, mandatory framework helper usage, auto-correction up to 3 cycles, data CSV generation |
| **LLM** | claude-sonnet-4-6, temperature=0.1 (deterministic) |
| **Tokens/invocation** | ~15K input + ~4K output |
| **Estimated cost** | ~$0.105 USD/invocation |
| **Handled errors** | EC-AI-004 (unsupported pattern), EC-AI-007 (max retries) |
| **SLA** | Success rate >= 95% (SC-100) |

### Analyst Agent (`src/ai/agents/analyst-agent.ts`)

| Dimension | Detail |
|-----------|--------|
| **Input** | k6 JSON output + observability data |
| **Output** | `AnalysisReport` (anomalies + correlations + regressions + recommendations) |
| **Capabilities** | Statistical anomaly detection (z-score, IQR, CUSUM), root cause correlation, comparison with historical best |
| **LLM** | claude-sonnet-4-6, temperature=0.2 |
| **Tokens/invocation** | ~12K input + ~3K output |
| **Estimated cost** | ~$0.081 USD/invocation |
| **Handled errors** | EC-AI-005 (observability unavailable: partial analysis) |
| **SLA** | Precision >= 90%, recall >= 80% (SC-101) |

### Reporter Agent (`src/ai/agents/reporter-agent.ts`)

| Dimension | Detail |
|-----------|--------|
| **Input** | `AnalysisReport` + execution metrics |
| **Output** | Executive + technical summary + Slack/Teams alerts + Jira tickets |
| **Capabilities** | Audience adaptation (executive vs technical), multi-channel publishing, automatic ticket creation |
| **LLM** | claude-sonnet-4-6, temperature=0.4 |
| **Tokens/invocation** | ~8K input + ~3K output |
| **Estimated cost** | ~$0.069 USD/invocation |
| **Handled errors** | EC-AI-009 (Jira unreachable: finding persisted locally) |
| **SLA** | Clarity >= 4/5 (SC-102) |

---

## Infrastructure Requirements

### Minimum (v2.0-alpha)

| Component | Requirement |
|-----------|-------------|
| **Node.js** | >= 18.0 (ESM, native fetch) |
| **npm packages** | `@anthropic-ai/sdk`, `chromadb` |
| **Docker** | ChromaDB: `docker compose --profile ai up chromadb` |
| **API Key** | `ANTHROPIC_API_KEY=sk-ant-...` in `.env` |
| **RAM** | +512 MB for ChromaDB |
| **Disk** | +1 GB for embeddings (initial knowledge base) |

### Full Stack (v2.0-GA)

| Component | Requirement |
|-----------|-------------|
| **Observability** | `./bin/observability.sh up --full` (Prometheus, Loki, Tempo, Pyroscope) |
| **Redis** | `docker compose --profile redis up` (for data patterns) |
| **Jira** | `JIRA_URL`, `JIRA_USER`, `JIRA_API_TOKEN` in `.env` (optional) |
| **Slack** | `NOTIFY_SLACK_WEBHOOK` in `.env` (optional) |

---

## Cost Estimation per Operation

| Operation | Approx Tokens | Cost USD | Typical Frequency |
|-----------|--------------|----------|-------------------|
| Planner (simple spec) | 10K | $0.054 | 1x per test suite |
| Planner (large OpenAPI) | 25K | $0.135 | 1x per test suite |
| Builder (simple test) | 19K | $0.105 | 1x per test |
| Builder (multi-step e-commerce) | 45K | $0.250 | 1x per test |
| Analyst (simple execution) | 15K | $0.081 | 1x per run |
| Analyst (with observability) | 30K | $0.162 | 1x per run |
| Reporter (executive summary) | 11K | $0.069 | 1x per run |
| **Full pipeline (simple)** | **~55K** | **~$0.30** | **1x per cycle** |
| **Full pipeline (complex)** | **~125K** | **~$0.70** | **1x per cycle** |

> **Default limits**: Budget manager blocks at $3 USD/pipeline.
> Configurable via `AI_TOKEN_BUDGET` and `AI_COST_BUDGET_USD` in `.env`.

---

## Incremental Adoption Guide (CHK-UX-172)

### Step 1: MCP Only (no AI)

The MCP server with base tools is already useful without agents:

```bash
# Execute test via MCP
mcp call run_test '{"client": "acme", "test": "api/smoke"}'

# Validate config
mcp call validate_schema '{"file": "clients/acme/config.json"}'
```

### Step 2: Standalone Builder Agent

Generate a k6 script from a manual TestPlan:

```bash
# 1. Create TestPlan manually (or edit one generated by Planner)
cat > my-plan.json << 'EOF'
{ "id": "my-test", "endpoints": [...], ... }
EOF

# 2. Generate script
DRY_RUN=true npx ts-node src/ai/agents/builder-agent.ts --plan=my-plan.json

# 3. Review and execute the generated script
k6 run clients/_generated/my-test.ts
```

### Step 3: Planner + Builder

```bash
node cmd/ai-pipeline.js \
  --start-from=planner \
  --end-at=builder \
  --spec=./openapi.json \
  --client=acme-corp
```

### Step 4: Standalone Analyst

```bash
# Analyze results from an existing execution
node cmd/ai-pipeline.js \
  --start-from=analyst \
  --input=./reports/acme/my-test/2026-02-18_100000/summary.json
```

### Step 5: Full Pipeline

```bash
node cmd/ai-pipeline.js \
  --client=acme-corp \
  --spec=./openapi.json \
  --notify=slack
```

---

## FAQ and Troubleshooting

**Q: The Builder Agent fails with EC-AI-007 (max retries)**
A: The TestPlan may have endpoints with unsupported patterns (MQTT, WebSocket, gRPC). Check plan warnings. You can edit the plan and pass it to Builder directly with `--start-from=builder`.

**Q: ChromaDB doesn't start**
A: `docker compose --profile ai up chromadb`. Verify that port 8000 is not in use on your host (only needed if you expose ChromaDB with override.yml).

**Q: RAG search returns 0 documents**
A: The knowledge base is not indexed. Run: `node bin/ai/index-knowledge-base.js --full`

**Q: Error ANTHROPIC_API_KEY not set**
A: Add `ANTHROPIC_API_KEY=sk-ant-...` in `infrastructure/.env` or export in your shell.

**Q: The Analyst Agent reports partial analysis**
A: The observability stack is not active. Start with: `./bin/observability.sh up --full`. Partial analysis uses only k6 JSON data.

**Q: Jira ticket is not created (EC-AI-009)**
A: The finding was persisted locally in `reports/_jira-pending/`. Configure `JIRA_URL`, `JIRA_USER`, `JIRA_API_TOKEN` in `.env` to enable it.

**Q: LLM cost is higher than expected**
A: Check the Budget Manager: `BudgetManager.getPipelineStatus()`. You can reduce `maxOutputTokens` per agent in `ai-config.json` or use `--dry-run` to validate flows without cost.

**Q: How to index only a specific client's scripts?**
A: `node bin/ai/index-knowledge-base.js --full --client=acme-corp`. This creates an isolated collection that the Builder uses when `clientId` is configured.
