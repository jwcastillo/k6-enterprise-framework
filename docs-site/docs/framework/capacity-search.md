---
title: "Capacity Search"
sidebar_position: 6
---
# Capacity Search

A load profile tells you whether the system survives a rate you picked. A capacity search
finds the rate itself: the highest arrival rate the target sustains before it breaks.

`bin/find-capacity.js` runs one scenario repeatedly at fixed rates and narrows down:

1. **Ramp** — start at `--start-rps` and double until a rate fails (or `--max-rps` is hit).
2. **Binary** — bisect between the last passing and the first failing rate until the gap is
   `--resolution-rps` or smaller.
3. **Confirm** — repeat the winning rate `--confirm-runs` times. If confirmation fails, step
   down by the resolution and confirm again. A number that only held once is not a capacity.

Each step is an ordinary `run-test.sh` execution, so gates, artifacts and reports work as
usual. The bundle is built once, on the first step.

```bash
node bin/find-capacity.js \
  --client=my-team --scenario=api/checkout \
  --start-rps=10 --max-rps=400 --step-duration=60 --resolution-rps=5
```

## Requirement: the scenario must be profile-driven

The search overrides the rate through the profile, so the scenario has to take its options
from it:

```ts
import { buildOptions } from "@core/config-loader";
export const options = buildOptions();
```

A scenario with a hardcoded `export const options = { vus: 5, duration: "20s" }` runs the
same load on every step, and the "capacity" it reported would just be the last step that
happened to pass. `find-capacity.js` checks the source up front and refuses rather than
hand you a bogus number.

## When a step counts as failed

A step fails when any of these is true — the same rules a human would apply:

- a threshold was crossed (the run exited 99),
- the generator dropped iterations, meaning it could not even issue the requested load,
- the achieved rate fell below `--min-achieved-ratio` (default 95%) of the requested one.

That last one matters: a run where k6 asked for 200/s and only managed 140/s is not a
passing 200/s, no matter how good the latency looks.

Anything else — a broken script, a bad config, a target that is not there — aborts the
search with exit 2 instead of being recorded as a capacity limit.

## Safety

A capacity search pushes the target until it breaks, so a non-local `baseUrl` is refused:

```
[capacity] Refusing to run: target api.staging.example.com is not local.
  A capacity search pushes the target until it fails. Pass --i-own-this-target if you may do that.
```

Hosts are read from the same client config the [Target Guard](./security/target-guard.md)
checks. `--i-own-this-target` is the explicit override.

Between steps the search waits `--cooldown` seconds, or polls `--health-url` until it
answers 2xx — measuring a target that has not recovered from the previous step gives you
the recovery time, not the capacity.

## Options

| Flag | Default | Meaning |
| --- | --- | --- |
| `--client`, `--scenario` | — | Required, same values as `run-test.sh`. |
| `--env` | `default` | Environment whose config is read. |
| `--profile` | `throughput-medium` | Arrival-rate profile whose thresholds apply. |
| `--start-rps` | `10` | First rate tried. |
| `--max-rps` | `1000` | Upper bound of the search. |
| `--resolution-rps` | `5` | Stop bisecting when the gap is this small. |
| `--step-duration` | `30` | Seconds per step. |
| `--confirm-runs` | `2` | Passing runs required at the winning rate. |
| `--retries` | `1` | Extra attempts before a rate is declared failed. |
| `--cooldown` | `10` | Seconds between steps (ignored with `--health-url`). |
| `--health-url` | — | Poll this until 2xx instead of sleeping. |
| `--health-timeout` | `120` | Give up waiting after this many seconds. |
| `--min-achieved-ratio` | `0.95` | Fraction of the requested rate that must be achieved. |
| `--i-own-this-target` | off | Allow a non-local target. |

The rate override reaches k6 through `K6_ARRIVAL_RATE` and `K6_STEP_DURATION`, which
replace the `rate` and `duration` of any arrival-rate profile and raise its VU pool to
match. Outside a capacity search these are unset and profiles behave exactly as declared.

## Output

Every step is printed as it finishes, then a table and the verdict:

```
Highest sustainable: 135 rps (confirmed: true)
First failing:       140 rps
Result written to:   reports/my-team/api_checkout/capacity-result.json
```

Exit code `0` means a sustainable rate was found, `1` means nothing passed (not even
`--start-rps`), `2` means usage error or an aborted search.
