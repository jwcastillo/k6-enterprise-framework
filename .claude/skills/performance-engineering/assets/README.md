# assets/ — templates and static files for output

This directory is for **non-executable resources** used in skill outputs: document templates, dashboard JSON exports, chart templates, image assets. Currently empty (templates live inline in `references/deliverable-templates.md` and `references/study-paper-templates.md` for v1.0.0), but the structure is here for future expansion.

## What goes here

Files that the skill includes in or uses to produce deliverables:

| Future asset candidate | Purpose |
|------------------------|---------|
| `templates/executive-1pager.docx` | Pre-styled Word template for executive 1-pagers |
| `templates/campaign-report.docx` | Full-length campaign report template with section anchors |
| `templates/study-paper.docx` | Research-style document template |
| `templates/post-mortem.docx` | Perf-focused post-mortem template |
| `dashboards/use-method.json` | Grafana dashboard JSON for USE method (CPU/memory/disk/network) |
| `dashboards/red-method.json` | Grafana dashboard JSON for RED method (Rate/Errors/Duration) per service |
| `dashboards/slo-burn-rate.json` | Grafana dashboard for SLO + error budget + burn-rate alerts |
| `dashboards/web-vitals-rum.json` | Grafana dashboard JSON for Web Vitals from Faro RUM |
| `alerts/multi-burn-rate.yaml` | Prometheus alerting rules for multi-window multi-burn-rate |
| `k6-snippets/templates/` | k6 scenario templates (smoke, load, stress, spike, soak, breakpoint) ready to copy |
| `images/architecture-icons/` | Vendor-neutral architecture icons for diagrams |

## How the skill uses assets

Pattern 1 — **Template-fill for document generation**:
```markdown
When asked to produce an executive 1-pager and the user has Office available:
1. Copy `assets/templates/executive-1pager.docx` to the output location
2. Use the docx skill to fill placeholders (TITLE, FINDINGS, RECOMMENDATIONS)
3. Present with `present_files`
```

Pattern 2 — **Reference for dashboard provisioning**:
```markdown
For a new perf engagement, recommend importing:
- `assets/dashboards/use-method.json` for infrastructure layer
- `assets/dashboards/red-method.json` per critical service
- `assets/dashboards/slo-burn-rate.json` for each SLO

The user imports these into their Grafana via the UI or `grafana-cli` and customizes data sources.
```

Pattern 3 — **Static reference embedding**:
Some artifacts (architecture diagrams, methodology illustrations) live here so they survive packaging.

## Naming conventions

- Lowercase, hyphen-separated: `executive-1pager.docx`
- Group by type: `templates/`, `dashboards/`, `alerts/`, `images/`
- Version-tag if format changes: `executive-1pager-v2.docx`

## Why this is empty for v1.0.0

Templates ship inline as markdown in `references/deliverable-templates.md` and `references/study-paper-templates.md` because:
- Markdown templates are easier to adapt to user-specific corporate styles
- Pre-styled .docx templates impose styling decisions that may not match the user's brand
- Maintaining binary templates across versions adds complexity

Future versions will add binary templates when:
- A specific corporate style emerges from real engagements (e.g., a company-branded executive 1-pager)
- The skill grows scripts that fill .docx programmatically (see `scripts/README.md`)
- Vendor-specific dashboard JSON proves valuable enough to standardize (e.g., a SOAP-test report dashboard for k6 + Grafana)

## Contributing a new asset

When adding a new asset:

1. Place in the appropriate subdirectory (`templates/`, `dashboards/`, etc.)
2. Add a row to the table above
3. Update the relevant reference in `references/` to point to the asset and explain how to use it
4. If the asset replaces inline content (e.g., a docx template that supersedes a markdown template in `deliverable-templates.md`), mark the markdown version as "legacy — see assets/templates/X.docx"
