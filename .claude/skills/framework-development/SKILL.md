---
name: framework-development
description: Change the k6 enterprise framework core itself — src modules (core, helpers, patterns, metrics, observability, reporting, node, ai), bin tools, profiles and schemas — while keeping the goja/Node runtime split, path aliases, Vitest coverage, ESLint rules, standalone export, bilingual docs and Conventional Commits intact. Use when asked to "add a helper/pattern to the framework", "fix a bug in src/core", "change a bin tool", "add a load profile", or "update the framework docs". Not for client scenarios (k6-scenario-authoring) or for exporting clients (client-export).
---

# Framework development

`<repo>` means the repository root. Package manager: pnpm only.

## Layout and runtime split

| Area | Runtime | Rule |
|------|---------|------|
| `src/core`, `src/helpers`, `src/patterns`, `src/metrics`, `src/observability`, `src/reporting` | k6 goja (bundled by webpack) | No Node built-ins, no npm packages that need Node. |
| `src/node` | Node.js | Never imported by scenarios (ESLint enforces). |
| `src/ai` | Node.js, optional LLM SDK | Pruned from standalone exports; keep it out of the goja barrel path. |
| `bin` | Node.js / bash | CLI tools; each supports `--help` and documents exit codes in its header. |
| `shared/profiles`, `shared/schemas` | data | Profiles are JSON; a new profile needs schema-valid fields and a docs row. |

Path aliases (tsconfig, webpack and Vitest must stay in sync): `@core`, `@helpers`,
`@patterns`, `@observability`, `@reporting`, `@types-k6`, `@node`.

## Workflow

1. Read the module and its tests under `<repo>/test` (mirrors `src` and `bin`).
2. Change the smallest surface; keep public exports backward compatible or note the
   breaking change.
3. Add or update a Vitest test for any branch, parser or security path you touch.
4. Run, in order: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
5. If you touched anything the standalone export copies (src, shared, validators,
   runner behaviour), run the export tests (`pnpm test` includes them) and see
   client-export.
6. Docs: framework docs live in `<repo>/docs-site/docs/framework` with a Spanish copy
   under `<repo>/docs-site/i18n/es/docusaurus-plugin-content-docs/current/framework`.
   Update both; register new pages in the docs sidebar config.
7. Commit with Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`,
   `refactor:`); commitlint runs in the pre-commit hooks. Never bypass hooks.

## Guardrails

- Public repository: no client names, hosts, IPs, credentials or client-specific
  vocabulary in code, tests, docs or commit messages. Use example.com hosts and the `_reference` client.
- Run `<repo>/bin/detect-secrets.sh` before committing.
- Do not weaken security checks (target guard, gating, RBAC, secret masking, XSS audit
  of reports) to make a test pass; fix the caller.
- Do not edit the Claude Code project settings file or repository hooks as part of framework work.
