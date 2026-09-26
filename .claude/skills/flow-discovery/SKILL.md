---
name: flow-discovery
description: Discover and record a user flow on a web target with the framework's discover-flow.js tool (Playwright plus a Claude or Jev decider) inside an authorized scope, then hand the outputs (flow.har, flow.json, flow.md, flow-plan.md) to test planning. Use when asked to "discover the checkout flow on <staging url>", "map the steps of <journey> for a load test", or "record a HAR of <flow> with discover-flow". Not for writing the k6 scenario (k6-scenario-authoring) or for generic Playwright scripting (playwright-automation).
---

# Flow discovery

`<repo>` means the repository root.

## Availability

The tool is `<repo>/bin/discover-flow.js`, run with `node`. If the file is missing,
this branch does not have it yet: say so and fall back to a manual capture
(har-to-k6 or playwright-automation). Check `node <repo>/bin/discover-flow.js --help`
before the first run; the flags below are the contract.

## Scope first (mandatory)

Before any run, write down and get the human to confirm:

- Start URL and environment. Production requires explicit human confirmation of scope
  in the current conversation, every time.
- `--allow-hosts` (only hosts you may touch) and `--block-hosts` (analytics, payment
  processors, third parties).
- `--stop-at` (the step where the flow must stop, e.g. before paying or submitting
  real orders) and `--deny-text` (button texts never to click, e.g. "Pay", "Delete").
- `--data` file with synthetic test inputs only.
- `--max-steps` bound.

## Run

```bash
node <repo>/bin/discover-flow.js --url=<start-url> --goal="<plain goal>" \
  --decider=claude|jev --data=<synthetic.json> \
  --allow-hosts=<h1,h2> --block-hosts=<h3> \
  --stop-at="<text or step>" --deny-text="<t1,t2>" --max-steps=<n> \
  --out=reports/discovery/<flow-name>
```

- `--out` must be under `reports/` (gitignored). Never write discovery output inside a
  tracked directory.
- `--decider=jev` needs `TYPESAFE_API_KEY` (see jev-typesafe); `--decider=claude`
  needs an Anthropic key. Keys come from the environment, never from arguments.

Exit codes: `0` done, `3` stopped for safety (a stop/deny rule fired — report which,
do not loosen it on your own), `1` error.

## Outputs

`<out>` is the `--out` directory.

| File | Use |
|------|-----|
| `<out>/flow.har` | Raw traffic. Contains cookies, tokens and PII until sanitized. Never commit, never paste into chat. |
| `<out>/flow.json` | Machine-readable steps. |
| `<out>/flow.md` | Human-readable narrative of the steps. |
| `<out>/flow-plan.md` | Endpoints, correlation candidates (values from one response reused later), data needs. Input for the test architect. |

## Validate

Run the generation gate on the outputs when it exists:
`node <repo>/bin/validate-generated.js --kind=flow reports/discovery/<flow-name>`
(see guardrails-gate). Hand-off only after it passes.

## Hand-off

Give the architect: the outputs directory path, the confirmed scope, the stop reason
(if exit 3), and the list of correlation candidates from `<out>/flow-plan.md`. For a recorder
based alternative or HAR conversion, see har-to-k6.
