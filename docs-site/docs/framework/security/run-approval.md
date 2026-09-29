---
title: "Run Approval and Trusted k6"
sidebar_position: 7
---
# Run Approval and Trusted k6

Heavy, unsafe and production runs start only with a human approval, and the runners never
find k6 through the caller's `PATH`. Both checks live in the runners
(`bin/run-test.sh`, `bin/run-distributed.sh` and the standalone `bin/run-test.sh` an export
generates), so a command-line trick that slips past the Claude Code hook still stops at the
runner. The hook stays as defense in depth (see [AI Guardrails](./guardrails.md)).

## Guarded runs

A run is **guarded** when any of these holds:

| Condition | Default |
| --- | --- |
| A scenario gate is unlocked (`export const gate = "unsafe"\|"experimental"\|"quarantined"` plus its flag). The standalone and distributed runners have no unlock flags: any gated scenario is guarded. | — |
| `K6_ALLOW_PROD_LOAD=true` | — |
| `--env` is not in `nonProdEnvs` (case-insensitive) | `default local dev development test testing qa ci sandbox staging stage uat` |
| `--profile` is in `heavyProfiles` | `stress spike breakpoint soak capacity throughput-high throughput-ramp` |
| A host in `productionHosts` (case-insensitive) appears in the built scenario or in an environment variable's value, whatever `--env` says. Checked after the build, right before k6 starts; a host in a comment counts too. | — (no check) |

Smoke, quick and load on a non-production environment stay frictionless: no approval.

The lists are per client, in the client config (`clients/<client>/config/default.json`,
else `clients/<client>/config.json`; `config/default.json` in a standalone repo). A list
replaces its default:

```json
{
  "nonProdEnvs": ["default", "dev", "staging", "perf-lab"],
  "heavyProfiles": ["stress", "spike", "breakpoint", "soak", "capacity"],
  "productionHosts": ["api.example.com", "www.example.com"],
  "trustedBinDirs": ["~/.local/bin"]
}
```

Approval is an additional requirement, never a substitute: the gate flags (exit `108`
without them), `K6_ALLOW_PROD_LOAD` for production load in the target guard, RBAC and
`K6_AGENT_ALLOW_UNSAFE` in the hook all still apply.

## Approving a run (humans only)

```bash
./bin/approve-run.sh --scenario=<bucket/path> --profile=<p> --env=<e> \
  [--client=<c>] [--ttl=4h] [--reason="..."]
```

- Refuses without an interactive terminal on stdin and stdout (exit `2`).
- Prints exactly what it approves (client, scenario, profile, env, gate, reason, user,
  expiry) and asks you to type a random 6-character code, read from `/dev/tty`.
- Writes a record outside the repository, in
  `${XDG_STATE_HOME:-$HOME/.local/state}/k6-framework/approvals/` (directory `0700`,
  files `0600`): `{id, client, scenario, profile, env, gates, user, host, created, expires,
  reason, nonce}` plus an HMAC-SHA256 over those fields, keyed by a per-user secret in the
  same directory (`.secret`, created `0600` on first use).
- `--ttl` goes from `1m` to `24h` (default `4h`). `--client` defaults to `_reference`; a
  standalone repo uses its directory name, as its runner does.

The runners never read approval data from environment variables or their own flags.

## What the runner does

1. Classifies the run. When guarded, and before building, it looks for a matching approval
   (exact client, scenario, profile and env), unexpired, not consumed, with a valid HMAC,
   owned by the current user and not group/world-writable (the secret must not be group- or
   world-readable either). A store inside the repository is refused.
2. Without one it exits **`109`** and prints the `approve-run.sh` command for a human to run.
3. Right before k6 starts it consumes the approval (atomic rename to `approvals/consumed/`,
   single use), writes `approval-<ISO>.json` next to the other run artifacts and stores
   `approvalId` in the summary JSON (`distributedExecution.approvalId` for distributed runs).
4. `--dry-run` needs no approval; it prints whether one is required and why.

CI: approvals cannot be created without a terminal, so a guarded run in CI exits `109`
(fail closed). Run guarded tests from an operator's machine, or keep CI to smoke/quick on
non-production environments.

## Trusted k6 resolution

- The runner searches `trustedBinDirs` (in order) and then
  `/usr/local/bin /usr/bin /bin /opt/homebrew/bin`. A leading `~/` is the account's home
  from the password database, not `$HOME`. Directories that are group/world-writable or
  owned by someone other than root or you are ignored with a warning.
- It resolves `k6` to an absolute path, checks the file and its directory are not
  group/world-writable and are owned by root or you, and executes that path.
- `K6_BINARY_PATH` still works when it points into a trusted directory (or `/opt/k6`, or
  `dist/binaries` in the monorepo). **`K6_BINARY_ALLOWED_PATHS` is no longer read**: an
  environment variable must not widen what is trusted. List extra directories in
  `trustedBinDirs` instead.
- CI: actions that drop k6 in a temporary directory and add it to `PATH` (for example
  `grafana/setup-k6-action`) need one more step, `sudo install -m 0755 "$(command -v k6)"
  /usr/local/bin/k6`; installing k6 with apt puts it in `/usr/bin` already. When `CI=true`
  the ownership/permission checks only warn, because hosted runners are single-user VMs
  that ship world-writable tool directories; the directory allowlist still applies.
- k6 runs with `NODE_OPTIONS`, `BASH_ENV`, `ENV`, `LD_PRELOAD`, `LD_LIBRARY_PATH`,
  `DYLD_INSERT_LIBRARIES` and `DYLD_LIBRARY_PATH` removed from its environment.
- The node that verifies approvals is resolved the same way. If your node lives elsewhere
  (asdf, nvm), add that directory to `trustedBinDirs`; otherwise guarded runs exit `107`.
  Node used for post-processing (reports) still comes from `PATH`.

## Exit codes

| Code | Meaning |
| --- | --- |
| `108` | Gated scenario without its unlock flag |
| `109` | Guarded run without a valid human approval |

## Threat model

Stops:

- An AI agent (or a script it writes) starting a heavy, unsafe or production run on its
  own: the Claude Code Bash tool has no terminal, so it cannot create an approval with
  `approve-run.sh`, and the runner refuses without one.
- Replaying an approval (single use), stretching it to another scenario, profile, env or
  client (exact match, HMAC), or editing a record (HMAC).
- `PATH` hijacking: a `k6` earlier in `PATH` is never executed.

Does not stop:

- A human approving the wrong thing. Read the summary before typing the code.
- Anyone with root, or any process running as your user that deliberately forges a record
  (it can read the secret) or drives a pseudo-terminal. For agents, pair this with the
  Claude Code sandbox (writes limited to the project) and keep the approvals directory out
  of the agent's reach. The repo hook and the agent-team guard already deny any agent run
  of `approve-run.sh` / `_run-approval.js`; they cannot see a copy renamed or linked
  elsewhere, which is why the terminal check and the HMAC stay the real boundary.
