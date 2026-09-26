---
name: chaos-resilience
description: Design and run resilience scenarios in this framework's chaos bucket — the chaos-injection pattern (deterministic fault rules, chaos vs service error accounting), continuity metrics such as FCI, mock servers for hermetic dependencies, gate markers, and the approval rules for fault injection. Use when asked to "write a chaos scenario for <dependency failure>", "test how <service> degrades when <dependency> times out", "add fault injection to <scenario>", or "measure continuity during a spike". Not for infrastructure-level chaos tooling outside this repo.
---

# Chaos and resilience

`<repo>` means the repository root. Reference:
`<repo>/clients/_reference/scenarios/chaos/fci-spike.ts` (hermetic, simulated faults).
Guide: `<repo>/docs-site/docs/framework/patterns/mocks-chaos.md`.

## Rules

1. Chaos scenarios live in `scenarios/chaos/`.
2. Anything that injects faults into a shared or real dependency declares
   `export const gate = "unsafe";`. Running it needs `--unsafe`, which needs the
   human's confirmation every time (run-operations).
3. Never against production without explicit written approval from the human for that
   target and window. Prefer mocks or a dedicated environment.
4. Define the hypothesis first: "when <fault> at <rate> for <duration>, <metric> stays
   above <threshold>". Encode it as thresholds.

## Building blocks

| Need | Use |
|------|-----|
| Deterministic fault selection (error, latency, timeout, corruption, rate limit) | `evaluateChaosRules` from `@patterns/chaos-injection`; reset with `resetChaosState` |
| Separate injected errors from real service errors | `recordServiceError`, `buildChaosReportBreakdown`, `formatChaosForJson` |
| Continuity indicator | Custom `Rate` (e.g. `fci_continuity`) with a threshold like `rate>0.95` outside the chaos window |
| Hermetic dependencies | Client mock configs + `@patterns/mock-server` helpers (Node-side lifecycle; scenarios only call the mock URL) |
| Fault config loading from files | Node-side only (`@node/chaos-injection-node`), never imported by scenarios |

## Metrics to report

- Continuity rate inside vs outside the fault window.
- Error split: injected vs service.
- Recovery time after the fault window closes.
- Latency percentiles per window (tag requests with the window name).

## Done

- Smoke run with faults disabled passes first.
- Chaos run exit code and breakdown captured as artifacts; results-analysis applies the
  deterministic-first rule.
