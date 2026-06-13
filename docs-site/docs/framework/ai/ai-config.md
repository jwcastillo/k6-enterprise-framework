---
title: "AI Features Configuration"
sidebar_position: 1
---
# AI Features Configuration

The framework's AI agents (planner, builder, analyst, reporter, self-healing) require an LLM API key to function. The current implementation uses the `@anthropic-ai/sdk`, but the key resolution is generic.

## API Key Configuration

### Resolution Order

The API key is resolved in this priority (first found wins):

```
1. Constructor param  (highest — programmatic override)
2. si        (recommended — provider-agnostic env var)
3. ANTHROPIC_API_KEY  (legacy — still supported for backward compatibility)
```

### Where to Set the Key

#### Option A: Environment Variable (recommended)

Add to your shell profile (`~/.zshrc`, `~/.bashrc`) or export before running:

```bash
export LLM_API_KEY=sk-ant-...
```

#### Option B: Client `.env` file

Create or edit `envs/<client>.env` (gitignored):

```bash
# envs/my-team.env
LLM_API_KEY=sk-ant-api03-...
```

Then run tests with:

```bash
k6 run --env-file=envs/my-team.env dist/my-team/scenarios/api/users.js
```

#### Option C: Programmatic

Pass the key directly when instantiating an agent:

```typescript
import { PlannerAgent } from "../../src/ai/agents/planner-agent";

const planner = new PlannerAgent({
  apiKey: "sk-ant-...",
});
```

### Template

The reference env template is at:

```
envs/_reference.env.example
```

Copy it for your client and fill in the values:

```bash
cp envs/_reference.env.example envs/my-team.env
```

## MCP Server Configuration

The project includes MCP server configuration at `.mcp.json` (project root). This enables:

1. **k6-framework MCP server** — exposes framework resources and tools to LLM clients
2. **Playwright MCP server** — enables browser automation for PDF/PNG export

### Setup

The MCP servers are configured automatically when Claude Code opens this project. No additional setup is needed beyond having the project checked out.

To use the k6 MCP server standalone:

```bash
cd mcp-server && npm install && npm run build
```

## PDF/PNG Export

PDF export in `bin/slo-report.js` uses **Playwright** (optional dependency):

```bash
npm install playwright  # if not already installed
node bin/slo-report.js --format=pdf --month=2025-01
```

Playwright is listed as an `optionalDependency` in `package.json` — it won't block `npm install` if it fails.

## Files Modified for AI Key Support

| File | Change |
|------|--------|
| `src/ai/agents/planner-agent.ts` | `LLM_API_KEY` → `ANTHROPIC_API_KEY` fallback |
| `src/ai/agents/builder-agent.ts` | Same |
| `src/ai/agents/analyst-agent.ts` | Same |
| `src/ai/agents/reporter-agent.ts` | Same |
| `src/ai/adaptive/self-healing.ts` | Same |
| `src/ai/poc/ai-stack-poc.ts` | Same |
| `envs/_reference.env.example` | Added `LLM_API_KEY` template |
| `bin/slo-report.js` | Migrated from Puppeteer to Playwright |
| `.mcp.json` | Created with k6 + Playwright MCP servers |
