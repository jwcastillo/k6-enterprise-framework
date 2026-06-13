## Load Test Request

**As a** performance engineer,
**I want to** execute a {{profile}} load test on **{{service}}** in the {{environment}} environment,
**So that** we can validate that the service meets its performance SLAs before release.

### Acceptance Criteria

- [ ] p95 response time < defined threshold
- [ ] p99 response time < defined threshold
- [ ] Error rate < 1%
- [ ] Check pass rate >= 95%
- [ ] No threshold violations

### Test Details

| Field | Value |
|---|---|
| Client | {{client}} |
| Service | {{service}} |
| Environment | {{environment}} |
| Profile | `{{profile}}` |
| Scenario | `{{test_name}}` |

### Notes

- Profile `{{profile}}` defines VU ramp, duration, and thresholds
- Data source: `clients/{{client}}/data/`
