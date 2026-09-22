---
title: "Target Guard"
sidebar_position: 5
---
# Target Guard

Before k6 starts, `bin/run-test.sh` runs `bin/target-guard.js` against the resolved client
config. When a check fails the run is refused, the reasons are printed and the script exits
with code `107` — k6 never launches.

The guard is **not** bypassable with `--skip-validate`.

## Checks

| Check | Refuses when | How to proceed |
| --- | --- | --- |
| Embedded credentials | a `baseUrl` contains `user:pass@` | move the credentials to the `auth` config or to environment variables |
| Host allow-list | `allowedHosts` is set and a `baseUrl` hostname is not listed (or the URL is invalid) | fix the `baseUrl`, or add the hostname to `allowedHosts` |
| Production load | `--env` matches `/^prod/i` and `--profile` is not `smoke` or `quick` (including no profile) | set `K6_ALLOW_PROD_LOAD=true` |

Error messages only ever name the config key and the hostname, never the full `baseUrl` —
it may carry a token or credentials.

## Host allow-list

`allowedHosts` is optional. When absent, hostnames are not checked. When present, every
`baseUrl` in the config (top level, `endpoints.*`, `services.*`) must resolve to a listed
hostname:

```json
{
  "client": "my-team",
  "allowedHosts": ["api.staging.example.com", "auth.staging.example.com"],
  "endpoints": {
    "api": { "baseUrl": "https://api.staging.example.com" }
  }
}
```

A typo that would have pointed a 400-VU stress run at production now stops the run instead.

## Running it on its own

```bash
node bin/target-guard.js --client=my-team --env=production --profile=stress
node bin/target-guard.js --config=clients/my-team/config/production.json --env=production
```

Exit code `0` means the target is allowed, `1` means it was refused.

## Config resolution

The guard reads the first file that exists:

1. `clients/<client>/config/<env>.json`
2. `clients/<client>/config/default.json`
3. `clients/<client>/config.json`

JSON only. A client whose config is YAML gets the production check but no URL checks.
