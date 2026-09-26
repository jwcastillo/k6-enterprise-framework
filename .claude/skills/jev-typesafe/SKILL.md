---
name: jev-typesafe
description: Use the TypeSafe Jev "System One" model (jev-latest) for fast typed decisions in this framework — choice/score questions with criteria and confidence thresholds, classification, picking the next browser action in discover-flow (--decider=jev), and failure triage (triage-failures.js with K6_TRIAGE=true) — including redaction, budget and the early-access caveat. Use when asked to "triage the failures of this run with Jev", "use Jev as the discovery decider", "classify these errors by owner", or "should this decision use Jev or an LLM". Not for free-text narrative or report writing.
---

# Jev (TypeSafe System One)

Early-access product: the account may be on a waitlist and the API can change. If
`TYPESAFE_API_KEY` is not set, say so and skip; never ask the human to paste the key
into chat.

## Jev vs an LLM

| Use Jev | Use an LLM |
|---------|------------|
| Pick one of N options (next click, cause category) | Explain, summarise, write prose |
| Score or classify with explicit criteria | Open-ended reasoning over long context |
| Many small decisions where latency and cost matter | Few decisions needing broad knowledge |
| You need a confidence value to gate on | Output is reviewed by a human anyway |

## API shape

`POST /v1/systemone` on the TypeSafe API host, `Authorization: Bearer $TYPESAFE_API_KEY`.

```json
{
  "model": "jev-latest",
  "state": { "failures": [{ "message": "<redacted signature>" }] },
  "questions": {
    "f0": {
      "type": "choice",
      "instructions": "What is the most likely cause of failures[0].message?",
      "criteria": { "sut": "<what it means>", "test": "<...>", "environment": "<...>" }
    }
  }
}
```

The response carries `answers` keyed by question id, each with the choice and a
`confidence`. Decide a minimum confidence in code (the triage tool uses 0.5) and treat
anything below it as "needs review", never as an answer. Retry only on 429/529 with
backoff.

## In this framework

- Triage: `K6_TRIAGE=true` on a run, or
  `node <repo>/bin/triage-failures.js <k6-execution log>` (see results-analysis).
  Override the model with `TYPESAFE_MODEL`; add names to hide with `TRIAGE_REDACT`.
- Discovery: `discover-flow.js --decider=jev` (see flow-discovery).

`<repo>` means the repository root.

## Rules

- Redact before sending: tokens/JWTs, cookies, URLs with query strings, hosts, IPs,
  emails, ids, customer and service names. The triage tool does this; replicate it in
  any new integration.
- Never send secrets, credentials, raw HARs, or personal data.
- Budget: batch questions in one request; cap requests per run; log counts, not payloads.
- The code owns the policy (what a choice triggers); Jev only answers the question.
