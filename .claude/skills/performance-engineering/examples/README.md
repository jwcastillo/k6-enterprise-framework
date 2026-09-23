# examples/ — sample engagement materials

Concrete examples of artifacts the skill produces in real engagements. Useful for:
- Showing new users what a "good context document" / "good ticket" / "good engagement brief" looks like
- Giving Claude a calibration anchor when starting a new engagement
- Sharing internally or with clients as "this is the deliverable shape"

## Contents

| File | What it is |
|------|------------|
| `sample-engagement-acme-corp/context-document.md` | A fully filled-out context document for a fictional client engagement |
| `sample-engagement-acme-corp/engagement-brief.md` | The PM-produced 1-page brief that opens the engagement |
| `sample-engagement-acme-corp/sample-tickets.md` | Three vertical-slice tickets generated from findings, in Linear-compatible format |
| `sample-engagement-acme-corp/sample-exec-digest.md` | A 1-page executive digest produced mid-engagement |

The "Acme Corp" example is fictional but realistic — modeled on a common consulting engagement shape (Java/Spring Boot service in Kubernetes, checkout perf issue, multi-week engagement).

## How to use

**For Claude**: when activating the skill on a new engagement, reading the examples first calibrates output shape. Reference: *"Match the style of `examples/sample-engagement-acme-corp/engagement-brief.md` for the Brief format."*

**For users**: read these before starting an engagement to know what artifacts to expect.

**For maintainers**: when you complete a real engagement (with sensitive details redacted), consider adding a new `examples/sample-engagement-<name>/` directory with the produced artifacts as a permanent calibration anchor.

## Redaction discipline

If adding examples from real engagements:
- Replace client name with a fictional one
- Replace service names with neutral equivalents (`checkout-service`, `payment-gateway`)
- Replace specific numbers with rounded approximations (`~5000 RPS` instead of `4837 RPS`)
- Remove any URLs, dashboard IDs, ticket IDs that could identify the source
- Keep the methodology, structure, and lessons intact — that's the reusable value
