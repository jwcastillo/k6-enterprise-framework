# {{CLIENT_NAME}}

{{CLIENT_DESCRIPTION}}

---

## Structure

```
clients/{{CLIENT_NAME}}/
  config/
    default.json      # base configuration
    staging.json      # staging overrides
    production.json   # production overrides
    slos.json         # SLO definitions (optional)
    rbac.json         # role-based access control (optional)
  data/               # test data pools (CSV/JSON)
  lib/
    services/         # service objects (HTTP wrappers)
    factories/        # data factories
  scenarios/
    api/              # REST API tests
    integration/      # integration tests
    mixed/            # multi-protocol tests
```

## Configuration

Set environment variables before running:

```bash
export BASE_URL="https://api.{{CLIENT_NAME}}.example.com"
export API_TOKEN="<your-token>"   # use CI/CD secrets in pipelines
```

## Running tests

```bash
# Single test
./bin/run-test.sh --client={{CLIENT_NAME}} --scenario=api/smoke --profile=smoke

# All tests
./bin/testing/run-all-tests.sh --client={{CLIENT_NAME}}

# With environment override
./bin/run-test.sh --client={{CLIENT_NAME}} --scenario=api/smoke --env=staging
```

## Available scenarios

| Scenario | Description | Profiles |
|---|---|---|
| `api/smoke` | Quick health check | smoke, quick |

## SLOs

SLOs are defined in `config/slos.json`. Run the monthly compliance report:

```bash
node bin/slo-report.js --client={{CLIENT_NAME}} --month=$(date +%Y-%m)
```

## Troubleshooting

- **Config validation fails**: check `config/default.json` against the schema in `shared/schemas/client-config.schema.json`
- **Test not found**: ensure the scenario file exists in `scenarios/` and the webpack build is up to date (`npm run build`)
- **High error rate**: check `BASE_URL` is reachable and credentials are set
