---
name: reporting-toolkit
description: Pick and set up the right tool for each performance-test deliverable in this framework — the performance-report skill for the client report flow, archify for architecture / test-topology / request-path sequence diagrams, and Anthropic's document skills (docx, pdf, pptx, xlsx plugin) for files in those formats — with install and vetting steps, the artifact-only numbers rule and brand neutrality. Use when asked to "make the report as a Word/PDF/PowerPoint/Excel file", "draw the test topology or the request path of the tested flow", "which tool should build this deliverable", or "install the reporting skills". Not for analyzing results (results-analysis).
---

# Reporting toolkit

`<repo>` means the repository root.

## Which tool for which deliverable

| Deliverable | Tool | Where it comes from |
|-------------|------|---------------------|
| Client performance report (structure, sections, narrative from run artifacts) | performance-report skill | In the repo |
| Architecture of the system under test, test topology (injectors, target, observability), animated trace of a request path, sequence diagram of the tested flow | archify skill | Third party, installed on demand (below) |
| Word document | docx skill | document-skills plugin |
| PDF | pdf skill | document-skills plugin |
| Slide deck | pptx skill | document-skills plugin |
| Spreadsheet of metrics / per-step tables | xlsx skill | document-skills plugin |
| Markdown / HTML summary for chat or tickets | message and analysis artifacts from the run | Run artifacts (results-analysis) |

## Rules for every deliverable

- Numbers come only from run artifacts or deterministic tool output, with the source
  path kept in your notes. No estimated, rounded-differently or invented figures.
- Brand-neutral by default: no company names, logos or colours unless the human names
  the brand for this deliverable. If a skill proposes a default brand, drop it unless
  the human asked for it.
- No client hosts, IPs, tokens or personal data in diagrams, tables or file metadata.
- Run the generation gate with `--kind=report` on the final text when available
  (guardrails-gate).

## archify (diagrams)

Not vendored in this repo; the lock file at the repo root pins it
(tt-a1i/archify, tag v2.16.0, folder hash recorded). Install on demand:

```bash
npx skills@1.7.0 add tt-a1i/archify#v2.16.0 --skill archify --agent claude-code
# or restore everything pinned in the lock file
npx skills@1.7.0 experimental_install
```

Before first use, vet it (see security-scanning):

```bash
skillspector scan <repo>/.claude/skills/archify --no-llm
```

or `<repo>/bin/scan-skills.sh` when present. Use it only if the scan is SAFE, or the
human has reviewed and accepted each finding in a baseline with a written reason. At
the time of writing the static scan reports findings that are under upstream review:
treat archify as blocked until that review closes. The installed folder is gitignored;
never commit it. Feed archify only neutral component names (e.g. "API gateway",
"orders service"), never real hosts.

## Document skills (docx, pdf, pptx, xlsx)

Proprietary license: never copy them into this repository. Enable them as a Claude
Code plugin from Anthropic's skills marketplace. The project-level declaration (added
by a maintainer to the project settings.json in the .claude directory; not by agents)
is:

```json
{
  "extraKnownMarketplaces": {
    "anthropic-agent-skills": {
      "source": { "source": "github", "repo": "anthropics/skills" }
    }
  },
  "enabledPlugins": {
    "document-skills@anthropic-agent-skills": true
  }
}
```

The marketplace registers after the human trusts the folder. Per user, the same can be
done interactively with `/plugin marketplace add anthropics/skills` and
`/plugin install document-skills@anthropic-agent-skills`. Check availability with
`claude plugin list`; if the plugin is missing, produce Markdown/HTML and tell the human
which plugin to enable.
