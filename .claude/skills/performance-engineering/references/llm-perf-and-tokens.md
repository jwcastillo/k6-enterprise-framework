# LLM performance and token optimization

Performance engineering for LLM-driven workflows: prompt design for token efficiency, Anthropic-specific performance features (prompt caching, Batch API), model tier selection, retrieval optimization, token observability, and external tools (RTK, Caveman) that reduce token consumption at the proxy and response layers.

Use when the engagement involves AI/LLM workflow optimization — agentic coding sessions (Claude Code, Cursor), API integrations, production LLM systems, or any context where token spend and latency matter.

---

## Why this is performance engineering

LLM systems exhibit the same patterns as traditional services — they have latency budgets (p50/p99), throughput limits (RPS, RPM), cost-per-request, tail latency variance, and failure modes (rate limits, context overflow). The discipline transfers directly:

- **Token spend = compute cost** — every prompt and response has a measurable price; same discipline as cloud cost optimization
- **Time-to-first-token (TTFT) = latency** — same UX impact as TTFB on a web service
- **Context window = memory budget** — same OOM patterns apply (eviction, summarization, paging via RAG)
- **Model tier = SKU choice** — same trade-off as Aurora db.r6g.xlarge vs db.r6g.2xlarge

State the LLM SLO sentence the same way you state any other:

> *"Min N completions/sec with ≤ M ms p99 TTFT at ≤ Z $/1k completions on {model tier}."*

---

## Token economy fundamentals

A token is roughly ~4 characters or ~¾ of a word in English (less efficient for code, even less for non-Latin scripts). **Do not bluff exact counts** — use a tokenizer when the count matters.

**Token-counting tools:**

```bash
# Python SDK
from anthropic import Anthropic
client = Anthropic()
count = client.messages.count_tokens(
    model="claude-sonnet-4-6",
    messages=[{"role": "user", "content": "text..."}]
)
```

**The cost equation for a request:**

```
cost = (input_tokens × input_price)
     + (output_tokens × output_price)
     + (cached_input_tokens × cached_price)   # if prompt caching active
     - batch_discount                          # if Batch API
```

Current Anthropic prices live at https://docs.claude.com. Cache reads are typically ~10% the cost of fresh input tokens; cache writes are ~125%. Batch API is ~50% of standard for non-interactive workloads.

**The latency equation:**

```
latency = network_rtt + queue_wait + processing_time + output_token_streaming
        ≈ TTFT + (output_tokens / streaming_rate)
```

Output tokens are the dominant variable cost in most interactive workloads. Reducing output length is the single biggest p99 lever.

---

## Anthropic-specific performance features

### Prompt caching (the highest-ROI optimization)

Cache stable prefixes of your prompts. Re-using a cached prefix is ~90% cheaper and faster than re-sending the same tokens.

```python
# Mark a prefix as cacheable (4 cache breakpoints allowed)
messages = [
    {
        "role": "user",
        "content": [
            {
                "type": "text",
                "text": LARGE_SYSTEM_CONTEXT,
                "cache_control": {"type": "ephemeral"}  # default 5min TTL
            },
            {
                "type": "text",
                "text": user_question  # not cached, varies per call
            }
        ]
    }
]
```

**Cache discipline rules:**

- Put **stable content first** (system prompt, knowledge base, few-shot examples) → varies last (user question)
- Cache breakpoints are anchors — content **before** the breakpoint is cached; content **after** is not
- Default TTL is 5 minutes; pass `"ttl": "1h"` for hour-long caching (paid premium, useful for batch workflows)
- Cache hits log as `cache_read_input_tokens`; track this metric to validate caching is working
- A cache miss + miss reason flag means the prefix changed — usually a whitespace / formatting drift

**When prompt caching wins big:**

- Long system prompts (5k+ tokens) reused across many user calls
- RAG with stable retrieved context per session
- Agentic tools where tool definitions are large and constant
- Few-shot prompts with extensive examples

**When it doesn't help:**

- Single-shot calls (no reuse to amortize the write cost)
- Highly varied prompts (cache misses dominate)
- Very short prompts (< 1024 tokens for `claude-sonnet-4` family — minimum cacheable size; check docs.claude.com for current floor)

### Batch API (50% discount for non-interactive work)

For workloads that don't need real-time response (overnight analytics, evaluation runs, content generation pipelines):

```python
batch = client.messages.batches.create(
    requests=[
        {"custom_id": "task-1", "params": {...message params...}},
        {"custom_id": "task-2", "params": {...}},
        # ... up to thousands
    ]
)
# Returns within 24h, 50% discount on both input + output
```

**Use Batch API for:**

- Backfilling evaluations against a new model
- Generating embeddings or summaries at scale
- Overnight batch jobs (data labeling, content moderation review)
- A/B testing prompts against historical data

**Don't use for:**

- Interactive user-facing requests (24h SLA is too slow)
- Workflows that depend on prior batch results (no chaining within batch)

### Streaming (latency optimization)

```python
with client.messages.stream(model="claude-sonnet-4-6", messages=[...]) as stream:
    for text in stream.text_stream:
        print(text, end="", flush=True)
```

Streaming reduces **TTFT** (Time to First Token) and **perceived latency** dramatically. The user sees output start in ~500ms instead of waiting 5s for the full response.

**Use streaming for:**

- User-facing chat / coding / writing tools
- Any UX where the user is waiting

**Don't stream when:**

- The output is JSON that needs full parse before use (streaming complicates this — use structured outputs instead)
- A background job consuming the result
- You need to validate the full response before showing anything (e.g., compliance-gated content)

### Parallel tool use

When Claude needs to call multiple independent tools, request parallel execution:

```python
# In tool definitions or system prompt
"You can call multiple tools in parallel when the calls are independent.
 Prefer parallel calls over sequential when possible."
```

Claude can issue multiple tool calls in a single turn — they execute in parallel, results return together, the next reasoning step has all of them. Dramatic latency reduction in agentic workflows.

**Anti-pattern**: forcing sequential tool calls when they're independent (e.g., fetching user data and order data in sequence instead of parallel).

### Structured outputs

Force JSON output that's directly parseable, reducing output tokens (no markdown / explanation overhead) and downstream parsing errors:

```python
# Tool use as a structured-output mechanism
response = client.messages.create(
    model="claude-sonnet-4-6",
    tools=[{
        "name": "respond_with_data",
        "input_schema": {
            "type": "object",
            "properties": {
                "summary": {"type": "string"},
                "score": {"type": "number"}
            },
            "required": ["summary", "score"]
        }
    }],
    tool_choice={"type": "tool", "name": "respond_with_data"},
    messages=[...]
)
```

This typically reduces output tokens by 30-60% vs free-form responses with JSON embedded in prose, and eliminates "Claude added apologetic preamble to the JSON" failures.

---

## Model tier selection

Already covered in `agent-team-orchestration.md` for agent-team contexts. Expanded here:

### Tier-based decision

| Tier | When | Trade-off |
|------|------|-----------|
| **Top** (Opus 4.7) | Architecture decisions, ADRs, executive synthesis, novel problems, conflict arbitration between roles | 5-10× cost vs Sonnet; reserve for irreplaceable reasoning |
| **Mid** (Sonnet 4.6) | Default workhorse: code generation, technical analysis, hands-on diagnosis, agentic loops | The right answer ~90% of the time |
| **Light** (Haiku 4.5) | Classification, filtering, extraction at scale, repetitive ceremonies, bulk pre-processing | 5-10× cheaper than Sonnet; sufficient for narrow tasks |

### Two-stage pipeline pattern

For high-volume tasks with most input uninteresting:

```
Light (Haiku) classifies → Mid/Top processes only the relevant subset
```

| Workflow | Light stage | Mid/Top stage |
|----------|-------------|---------------|
| Bug triage from issue tracker | Categorize / label / detect duplicates | Diagnose root cause of selected issues |
| Trace analysis pipeline | Filter to slow/error traces (5% of total) | Build flame-graph narrative for filtered |
| Log alerting | Classify alert as noise / known / new | Run RCA for "new" only |
| Customer support routing | Categorize ticket | Draft full response for AI-handleable subset |
| Code review at scale | Identify perf-relevant changes | Deep review of perf changes only |

**Measure the funnel.** A poorly-tuned filter that lets 80% of input through to the expensive stage destroys the cost savings. Target: light stage passes through <20% of input to mid/top.

### Anti-patterns

- **Using Opus for ceremonies** (standups, formatting, bulk classification) → 10× waste
- **Using Haiku for architecture** (ADRs, design reviews) → plausible prose without rigor
- **Same model for all roles** → defeats role separation
- **No filter stage for high-volume input** → context overflow + bankruptcy
- **Preemptive escalation** ("just in case") → consistent 5× cost without benefit; start at role default, escalate when work demands

---

## Prompt engineering for token efficiency

### System prompt structure — cache the stable, vary the user

```python
# Good: stable system prompt is cacheable
messages = [{
    "role": "user",
    "content": [
        {
            "type": "text",
            "text": SYSTEM_PROMPT + FEW_SHOT_EXAMPLES + TOOL_DEFINITIONS,
            "cache_control": {"type": "ephemeral"}
        },
        {"type": "text", "text": user_query}
    ]
}]

# Bad: dynamic content in system prompt prevents caching
SYSTEM_PROMPT = f"Today is {datetime.now()}. The user's name is {user.name}..."
```

If you need to include dynamic context (timestamps, user IDs), put it in the **user** message after the cached prefix.

### Few-shot example economy

A few-shot example with N tokens that captures the pattern beats one with 5N tokens that captures more nuance — the cost difference compounds across thousands of calls.

**Rules of thumb:**
- 2-3 examples often as good as 5+
- Examples should differ in shape (cover edge cases), not just be variations
- Trim verbose explanations within examples — show, don't tell

### `max_tokens` discipline

```python
client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=500,  # explicit cap
    ...
)
```

Without `max_tokens`, you may pay for output you don't need. Cap based on what the response actually requires:
- JSON response: estimate the largest valid response size + 20% buffer
- Conversational response: 200-500 for short, 1000-2000 for medium, higher only if you've measured need
- Code generation: harder to predict; can use 4000+ but be aware

`stop_sequences` work in conjunction — set a sentinel that ends the response naturally.

### Compress system prompts iteratively

Most teams' first system prompt is 3-5× longer than it needs to be. Iterate:

1. Measure current avg input tokens
2. Cut sections that don't change behavior (test by running the eval set with/without)
3. Replace verbose instructions with compact ones (use Caveman discipline — see below)
4. Re-measure; verify quality doesn't regress

A 50% system prompt reduction is usually achievable on first-iteration prompts and translates directly to 50% input cost reduction.

---

## Input-side token optimization — RTK and the family

### What RTK is

**RTK (Rust Token Killer)** is a CLI proxy that compresses command output before it enters the AI's context window. Reduces token consumption by 60-90% on common dev commands.

Concrete savings (measured, RTK project):
- `cargo test`: 91.8% reduction
- `git status`: 80.8% reduction
- `find`: 78.3% reduction
- `grep`: 49.5% reduction

```bash
# Install
brew install rtk-ai/tap/rtk        # macOS / Linux
cargo install rtk                  # All platforms

# Hook-first install (auto-rewrite in Claude Code)
rtk init -g

# Manual use
rtk cargo test                     # token-optimized test run
rtk ls .                           # compact directory tree
rtk read file.rs                   # smart file reading
rtk read file.rs -l aggressive     # signatures only
rtk grep "pattern" .               # grouped search results
rtk git status                     # filtered git status
```

**How it works**: intercepts the command, runs it, filters ANSI codes / spinner artifacts / progress bars, groups repeated patterns, deduplicates passing tests, truncates verbose success output while preserving errors / warnings / diffs / stack traces.

**Critical scope note**: the auto-rewrite hook only applies to `bash_tool` calls. Claude Code built-in `Read`, `Grep`, `Glob` tools bypass it. For those, use shell commands (`cat`, `head`, `tail`, `rg`, `grep`, `find`) explicitly, or invoke `rtk read` / `rtk grep` / `rtk find` directly.

**When to install**:
- Claude Code sessions hitting context limits frequently
- Cost-conscious workflows running many shell commands
- Long agentic sessions (RTK enables 3× longer sessions on same budget)

**When it doesn't help**:
- Pure-API workflows (no shell command interception)
- Sessions dominated by file reading via built-in tools (use `rtk read` explicitly)
- Windows native (use WSL for full functionality)

### Manual token-optimization for command output (no RTK)

When RTK isn't available, apply the same patterns by hand:

| Anti-pattern | Compact equivalent |
|--------------|--------------------|
| `cat large-file.log` | `head -50 large-file.log` or `grep -A 3 ERROR large-file.log` |
| `find . -name "*.rs"` | `rg --files -g "*.rs" \| head -20` |
| `git log` | `git log --oneline -20` |
| `npm install` (verbose) | `npm install --silent 2>&1 \| tail -20` |
| `pytest -v` | `pytest --tb=short -q` |
| `kubectl describe pod X` (huge) | `kubectl get pod X -o jsonpath='{.status.phase}' && kubectl get events --field-selector involvedObject.name=X` |
| `docker logs <container>` | `docker logs --tail 100 <container>` |
| `cargo test` (verbose) | `cargo test 2>&1 \| grep -E "(test result\|FAILED\|error)"` |

**General principle**: read the **shape and surprises**, not every line. Errors, failures, warnings, and the first/last N lines are usually enough to decide the next action.

### File reading strategies

For files in agentic sessions:

| Strategy | When |
|----------|------|
| Read full file | < 200 lines, all content matters |
| Read header + signatures (`rtk read -l aggressive`) | Large file, understanding structure |
| Grep for specific patterns first | Looking for one thing in a big file |
| Read by section (line ranges) | Targeted edit; know which section |
| Summarize via heuristic (`rtk smart`) | Quick understanding of unknown file |

---

## Output-side token optimization — Caveman and the family

### Caveman mode

**Caveman** (Matt Pocock) is a response-style skill that reduces output tokens ~75% by dropping articles, filler words, and pleasantries while preserving technical accuracy.

**Activation triggers**: "caveman mode", "talk like caveman", "be brief", "less tokens", `/caveman` command.

**Rules:**
- Drop: articles (a/an/the), filler (just/really/basically/actually/simply), pleasantries (sure/certainly/of course/happy to), hedging
- Keep: technical terms exact, code blocks unchanged, error messages quoted verbatim
- Use: fragments OK, abbreviations (DB/auth/config/req/res/fn/impl), arrows for causality (X → Y)
- Pattern: `[thing] [action] [reason]. [next step].`

**Example transformation:**

> **Normal**: "Sure! I'd be happy to help you with that. The issue you're experiencing is likely caused by an inline object being passed as a prop, which creates a new reference on every render and triggers a re-render of the child component."

> **Caveman**: "Inline obj prop → new ref → re-render. `useMemo`."

Same information, ~85% fewer tokens.

### Auto-clarity exception

Caveman should **not** apply when terseness creates risk:

- Security warnings ("about to delete production data")
- Irreversible action confirmations (deploys, deletions, schema migrations)
- Multi-step sequences where fragment order risks misread
- User explicitly asks for clarification

In these cases, **temporarily resume full prose**, then return to caveman after the risk-relevant content.

### Other output reduction techniques

- **Structured outputs** (tool use with `tool_choice`) — eliminate markdown overhead, enforce schema, reduce parse errors
- **JSON without explanation** — request `{...}` and only `{...}`, no preamble
- **`max_tokens`** — hard cap, prevents runaway responses
- **`stop_sequences`** — natural termination, prevents trailing chatter
- **Response length instruction** in system prompt — "Respond in ≤ 200 tokens unless asked for more"

---

## Retrieval and context management

### RAG vs full context

| Strategy | When | Token cost |
|----------|------|------------|
| Full context (paste everything) | Small corpus (< 50k tokens), one-shot queries | High input cost, no retrieval infra |
| Embedding RAG | Large corpus (> 100k tokens), repeated queries | Embedding cost + low per-call cost |
| Hybrid (BM25 + embeddings) | Mixed query types (lexical + semantic) | Higher infra, best recall |
| Tool-based retrieval | Dynamic data (DB rows, API responses) | Pay per tool call |

For most production LLM systems past prototype: **embedding RAG with prompt caching** on the system prompt is the right architecture. Retrieved chunks go in the user message (cache-invalidating, varies per query) after a cached prefix.

### Chunking strategies

- **Chunk size**: 400-1000 tokens typical. Smaller = better precision, more chunks. Larger = better context, harder to retrieve precisely.
- **Overlap**: 10-20% overlap prevents losing context at boundaries
- **Semantic chunking** (split on document structure) > naive token chunking
- **Metadata enrichment**: store chunk's section, doc, version, freshness — use for filtering before embedding search

### Reranking

After embedding retrieval, rerank the top-K results before generation:

```
Embedding retrieval → top 20 → rerank to top 5 → generation
```

A rerank step (using a small cross-encoder model or a Haiku call) typically lifts retrieval quality 10-30%. Pay ~10ms latency for substantially better grounded responses.

### Conversation history compression

Long multi-turn conversations accumulate context. At some point, you must compress:

| Strategy | When |
|----------|------|
| Naive truncation (drop oldest) | Quick fix, OK if early turns are throwaway |
| Summarize old turns into a system message | Better preserves context, cost-aware |
| Hierarchical: summarize summaries | Very long conversations (50+ turns) |
| Persistent memory layer | Conversations across sessions (use a vector store) |

Anthropic's memory feature (when available) automates this for chat surfaces. For API-driven systems, build it.

---

## Observability for LLM workflows

### Track these metrics

Same RED method (Rate / Errors / Duration) applies, with LLM-specific extensions:

| Metric | What it measures | Why it matters |
|--------|------------------|----------------|
| Requests per minute / per second | Volume | Rate limit headroom; capacity planning |
| Input tokens per request (p50/p99) | Prompt size distribution | Detect prompt bloat over time |
| Output tokens per request (p50/p99) | Response size distribution | Cost driver; UX (long responses = long waits) |
| Cache hit rate | % of input tokens served from cache | Validates prompt caching is working |
| Cost per request (p50/p99) | Direct $ cost | Budget tracking; anomaly detection |
| TTFT (p50/p99) | Time to first token (streaming) | User-perceived latency |
| Total latency (p50/p99) | Full response time | End-to-end UX |
| Error rate by type | 429 (rate limit), 5xx (provider), 400 (input invalid) | Reliability |
| Tool call distribution | Which tools called, how often | Workflow shape; identify inefficient agentic loops |
| Tokens used per task / per session | Aggregate across multi-turn | Session-level cost tracking |
| RTK savings (if installed) | Tokens saved by RTK | Quantify token-optimization ROI |

### Tooling stack

| Tool | What it does |
|------|--------------|
| **OpenLLMetry** | OpenTelemetry semantic conventions for LLM ops; emits standard spans |
| **Helicone** | LLM observability platform; cost tracking, prompt versioning, A/B |
| **Langfuse** | Open-source LLM observability; traces, evals, cost analytics |
| **PromptLayer** | LLM logging + prompt management |
| **LangSmith** | (LangChain ecosystem) observability + evals |
| **Anthropic Console** | First-party usage / cost / rate-limit dashboards |
| **`rtk gain --history`** | RTK-specific savings analytics |

For PE engagements involving production LLM systems, **establish baseline metrics first** before optimizing. Without baseline, "we made it faster" is meaningless.

### Production patterns

- **Cache layer (Redis) for identical queries** — orthogonal to Anthropic's prompt caching; deduplicates at request level
- **Embedding cache** — hash the text, cache the embedding; embeddings rarely change for stable text
- **Idempotency keys on tool calls** — prevent duplicate side effects when retrying
- **Retry with exponential backoff + jitter** for 429 / 5xx — but **don't retry on quality failures** (a "wrong but well-formed" response shouldn't be retried; that's an eval / prompt issue)
- **Circuit breakers** when downstream LLM provider is degraded — fail fast to a cheaper fallback model or to cached canned response
- **Rate limiter at the application layer** — respect provider rate limits proactively; queue + smooth bursts

---

## When LLM perf matters most

| Profile | What to optimize |
|---------|------------------|
| **High-volume batch** (millions of completions / day) | Batch API + prompt caching + two-stage pipeline. Cost dominates over latency. |
| **Latency-critical UX** (chat, coding assistants) | Streaming + smaller models + parallel tool calls. TTFT dominates. |
| **Cost-constrained startup** | Two-stage pipelines + aggressive prompt caching + Haiku where possible. Watch cost per active user. |
| **Quality-critical** (legal, medical, safety) | Larger models (Opus) + structured outputs + eval gates. Accept higher cost; quality non-negotiable. |
| **Long-running agentic** (Claude Code, autonomous research) | RTK + Caveman + smart context management. Session length matters more than per-call cost. |

State which profile applies in the engagement brief. Optimizations that win for one fail for another.

---

## Honest scope notes

- **Anthropic-centric** — this reference focuses on Claude API features. Patterns translate to other providers (OpenAI prompt caching, Gemini context caching) but the exact mechanics differ.
- **Rapid feature evolution** — prompt caching, Batch API, parallel tool use, structured outputs all evolved significantly 2024-2026. Verify current behavior at https://docs.claude.com.
- **Not a prompt engineering tutorial** — covered as it intersects with perf. For deep prompt engineering, see Anthropic's prompt engineering guide at https://docs.claude.com.
- **Tools listed (RTK, Caveman, Helicone, Langfuse) are recommendations** — not endorsements. Evaluate against your specific workflow.
