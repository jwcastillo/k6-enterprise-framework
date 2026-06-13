---
title: "Client Repository Management (T-152)"
sidebar_position: 4
---
# Client Repository Management (T-152)

The framework supports three strategies for linking client repositories.
All three strategies produce identical behaviour — `bin/run-test.sh` and
`client-validator.ts` work the same regardless of how the client was linked.

Client repos follow the naming convention: `k6-tests-<client>`.

---

## Strategy 1 — Git Submodules (recommended for monorepo teams)

```bash
# Add a client as a submodule
git submodule add https://github.com/my-org/k6-tests-my-team clients/my-team

# Update all submodules
git submodule update --init --recursive

# Update a specific client to latest
git submodule update --remote clients/my-team
```

### .gitmodules entry (auto-generated)

```ini
[submodule "clients/my-team"]
    path = clients/my-team
    url = https://github.com/my-org/k6-tests-my-team
    branch = main
```

### CI/CD with submodules

```yaml
# GitHub Actions
- name: Checkout with submodules
  uses: actions/checkout@v4
  with:
    submodules: recursive
    token: ${{ secrets.GH_PAT }}  # PAT with access to client repos
```

---

## Strategy 2 — Symlinks (recommended for local development)

```bash
# Link an external repo already checked out locally
ln -s /path/to/k6-tests-my-team clients/my-team

# Verify the link resolves correctly
ls clients/my-team/scenarios/
```

Symlinks are transparent to the framework — `run-test.sh` validates that
the resolved path stays within `clients/` (T-127 path-traversal protection).

---

## Strategy 3 — CI/CD Cloning (recommended for isolated pipelines)

Clone the client repo at pipeline start, then run tests:

### GitHub Actions

```yaml
jobs:
  load-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4  # framework repo

      - name: Clone client repo
        run: |
          git clone \
            --depth=1 \
            --branch=${BRANCH:-main} \
            https://x-access-token:${{ secrets.GH_PAT }}@github.com/my-org/k6-tests-my-team \
            clients/my-team

      - name: Run tests
        run: ./bin/run-test.sh --client=my-team --scenario=api/smoke-users --profile=smoke
```

### GitLab CI

```yaml
load-test:
  script:
    - git clone
        --depth=1
        https://oauth2:${CI_JOB_TOKEN}@gitlab.com/my-org/k6-tests-my-team
        clients/my-team
    - ./bin/run-test.sh --client=my-team --scenario=api/smoke-users --profile=smoke
```

---

## .gitignore configuration

The framework `.gitignore` excludes all client directories except the
built-in reference clients:

```gitignore
# Client repos — each lives in its own repository
clients/*/
!clients/_reference/
!clients/_benchmark/
```

This means:
- `clients/_reference/` and `clients/_benchmark/` are committed to the framework repo
- All other `clients/<name>/` directories are ignored (linked via submodule, symlink, or CI clone)

---

## Generating a new client repo

```bash
# Create the client directory structure
./bin/create-client.sh --client=my-team

# This creates:
#   clients/my-team/
#   ├── config/
#   │   └── config.json        (client configuration)
#   ├── scenarios/             (test scenarios)
#   ├── data/                  (test data files)
#   └── lib/                   (shared helpers)
```

The generated repo name follows the convention `k6-tests-<client>`.

---

## Migration: monorepo → multi-repo

If you currently have client code inside the framework repo and want to
move it to a separate repository:

```bash
# 1. Create new GitHub/GitLab repo: k6-tests-my-team

# 2. Push existing client directory to the new repo
cd /tmp
git init k6-tests-my-team
cp -r /path/to/framework/clients/my-team/. k6-tests-my-team/
cd k6-tests-my-team
git add -A
git commit -m "chore: extract client to dedicated repo"
git remote add origin https://github.com/my-org/k6-tests-my-team
git push -u origin main

# 3. Remove from framework monorepo and add as submodule
cd /path/to/framework
git rm -r clients/my-team
git submodule add https://github.com/my-org/k6-tests-my-team clients/my-team
git commit -m "chore: migrate my-team client to submodule"

# 4. Verify tests still pass
./bin/run-test.sh --client=my-team --scenario=api/smoke-users --profile=smoke
```
