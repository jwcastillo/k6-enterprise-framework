---
name: client-export
description: Export a client from this monorepo into a standalone repository with export-client.sh (flags, capability options such as --with-claude, standalone layout, runner differences) and keep it current with update-framework.sh. Use when asked to "export <client> as a standalone repo", "what does --with-claude include", "why does the standalone runner not accept --client", "update the vendored framework in the standalone repo", or "the export does not typecheck". Not for creating a client inside the monorepo from scratch (use create-client.sh) or for CI wiring (ci-quality-gates).
---

# Client export

`<repo>` means the monorepo root.

## Command

```bash
<repo>/bin/export-client.sh --client=<name> --output=<dir> [options]
```

| Option | Effect |
|--------|--------|
| `--dry-run` | Show what would be exported. Use first. |
| `--force` | Overwrite an existing output directory. Ask before using on a non-empty dir. |
| `--git-init` | Initialise git with a first commit. |
| `--ci=github\|gitlab\|none` | Generate a CI workflow. |
| `--new --service=<name>` | Scaffold a new client and export it. |
| `--skip-validate` | Skip install + typecheck of the export (avoid). |
| `--with-reports`, `--with-observability`, `--with-binary`, `--with-mcp` | Optional capabilities. |
| `--with-claude` | Claude Code config: settings, CLAUDE.md, the agent team (agents), repo skills, and the agent Bash guard. |
| `--full` | All capabilities. |

## Standalone layout

```
<output>/
  framework/   vendored src (AI module pruned), shared profiles and schemas, validators
  config/ data/ lib/ scenarios/   client files
  bin/                            standalone runner (run-test.sh)
  reports/                        run artifacts
```

Differences from the monorepo that agents must respect:

- The runner has no `--client` flag and no gate or target-guard enforcement; check
  `export const gate` and confirm targets manually (run-operations).
- Imports are rewritten to the vendored `framework` path.
- Monorepo-only tools (discovery, generation gate, compare, trend, triage, capacity
  search) are not exported unless listed in the export; detect with a file check before
  using them and say when they are missing.
- The AI agent module is removed from the vendored source.

## Updating the vendored framework

Run from the standalone repo root:

```bash
<standalone>/bin/update-framework.sh --from=<path to monorepo>
<standalone>/bin/update-framework.sh --from=github:<org>/<repo> --ref=<tag>
```

It replaces the vendored framework only, never client files. Pin `--ref` to a tag.

## Verifying an export

1. `--dry-run`, then the real export into an empty directory.
2. In the output: install dependencies, `npm run typecheck` (or the scripts in its
   package.json), then a smoke run with the standalone runner.
3. Test coverage for the exporter: `pnpm test` in the monorepo runs the export tests.
