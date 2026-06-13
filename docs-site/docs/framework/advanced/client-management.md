---
title: "Client Management"
sidebar_position: 3
---
# Client Management

Strategies for organizing clients: monorepo, separate repositories, and linking mechanisms.

---

## Table of Contents

1. [Client Model](#client-model)
2. [Monorepo vs Separate Repositories](#monorepo-vs-separate-repositories)
3. [Linking Mechanisms](#linking-mechanisms)
   - [Git submodules](#1-git-submodules)
   - [Local symlinks](#2-local-symlinks)
   - [CI/CD cloning](#3-cicd-cloning)
4. [Comparison Table](#comparison-table)
5. [Filesystem Isolation](#filesystem-isolation)
6. [Migration Guide](#migration-guide)

---

## Client Model

Each client is a directory under `clients/{name}/` with the following minimum structure:

```
clients/
  acme/
    config/
      default.json       # base client configuration
      thresholds.json    # (optional) custom thresholds per service
      slos.json          # (optional) SLOs per service
      rbac.json          # (optional) roles and permissions
      chaos.json         # (optional) chaos injection
    scenarios/
      users.ts           # at least one test scenario
    data/                # (optional) CSV/JSON data pools
    mocks/               # (optional) mock server configurations
    branding/            # (optional) logo, colors for HTML reports
```

All access to client resources goes through `ClientResolver` (`src/core/client-resolver.ts`), which prevents path traversal and ensures isolation between clients.

---

## Monorepo vs Separate Repositories

### Monorepo

The framework and all clients live in the same Git repository.

**Advantages**:
- Immediate initial setup: `mkdir clients/new-client`
- A single CI/CD pipeline for all
- Framework and client changes in the same PR

**Disadvantages**:
- All engineers have access to all clients' code
- Repository grows with each new client
- No Git history isolation per client

**Recommended when**: small team, all clients are internal, initial project phase.

### Separate Repositories

The framework lives in its own repository. Each client has its own repo (`k6-tests-{client-name}`) linked to the framework via submodule, symlink, or CI/CD cloning.

**Advantages**:
- Total isolation: each client only sees their own code
- Independent Git history per client
- Clients can update the framework at their own pace (when using submodule)

**Disadvantages**:
- More complex initial setup
- CI/CD pipeline requires access token management

**Recommended when**: clients are external organizations, test code confidentiality is required.

---

## Linking Mechanisms

### 1. Git Submodules

The client linked as a Git submodule. The `clients/{name}` directory points to a specific commit of the client repository.

```bash
# Link a client as submodule
git submodule add https://github.com/org/k6-tests-acme.git clients/acme
git submodule update --init --recursive

# Update to the latest client version
cd clients/acme && git pull origin main && cd ../..
git add clients/acme && git commit -m "chore: update acme submodule"
```

The framework automatically detects if `clients/{name}` is a submodule and treats it identically to a regular directory.

**If the submodule is not initialized**:
```bash
git submodule update --init clients/acme
```

### 2. Local Symlinks

Useful for local development when the client repository is cloned in a different path.

```bash
# Clone the client repository in some local location
git clone https://github.com/org/k6-tests-acme.git ~/repos/k6-tests-acme

# Create the symlink in clients/
ln -s ~/repos/k6-tests-acme clients/acme
```

The `ClientResolver` accepts symlinks pointing to valid directories with client structure. Symlinks pointing to nonexistent directories or to the framework core are rejected.

### 3. CI/CD Cloning

The pipeline clones the client repository before running tests. There is no persistent link in the framework repository.

**GitHub Actions** — use the template in `ci-templates/github-actions-client.yml`:

```yaml
- name: Clone client repository
  uses: actions/checkout@v4
  with:
    repository: org/k6-tests-acme
    token: ${{ secrets.CLIENT_REPO_TOKEN }}
    path: clients/acme
```

**GitLab CI** — use the template in `ci-templates/gitlab-ci-client.yml`:

```yaml
before_script:
  - git clone https://oauth2:${CLIENT_REPO_TOKEN}@gitlab.com/org/k6-tests-acme.git clients/acme
```

CI/CD tokens should have minimum `read` scope (read-only access to the client repository).

---

## Comparison Table

| Feature                     | Monorepo    | Submodule   | Symlink     | CI/CD Clone     |
|-----------------------------|-------------|-------------|-------------|-----------------|
| Initial setup               | Immediate   | Easy        | Easy        | Medium          |
| Code isolation              | None        | High        | High        | High            |
| Separate Git history        | No          | Yes         | Yes         | Yes             |
| Local development           | Optimal     | Good        | Optimal     | Requires clone  |
| Requires CI/CD token        | No          | No          | No          | Yes             |
| Automatically detected      | Yes         | Yes         | Yes         | Yes             |
| Framework update            | Manual      | Explicit    | Transparent | Automatic       |

---

## Filesystem Isolation

The `ClientResolver` guarantees the following security properties:

- **Path traversal blocked**: `--client=../otherClient` is rejected before any filesystem operation.
- **Controlled symlinks**: only symlinks whose target exists and meets the client structure are accepted.
- **Opaque errors**: error messages do not reveal the existence or paths of other clients.
- **Isolated concurrent executions**: Client A and Client B running simultaneously operate in completely separate filesystem namespaces.

```typescript
// All access to client resources must go through resolveClient()
import { resolveClient } from "./src/core/client-resolver";

const ctx = resolveClient("acme");
// ctx.configDir, ctx.dataDir, ctx.scenariosDir, ctx.reportsDir, ctx.envFile
// are absolute, canonical, and validated paths
```

---

## Migration Guide

Process to move a client from monorepo to separate repository without losing result history.

### Step 1: Extract the Client Code

```bash
# Create the new client repository
git init k6-tests-acme
cd k6-tests-acme

# Copy the client structure
cp -r ../k6-framework/clients/acme/* .
echo "node_modules/" > .gitignore

git add -A
git commit -m "feat: initial migration from monorepo"
git remote add origin https://github.com/org/k6-tests-acme.git
git push -u origin main
```

### Step 2: Link as Submodule

```bash
cd ../k6-framework

# Remove the local directory
git rm -r clients/acme

# Link as submodule
git submodule add https://github.com/org/k6-tests-acme.git clients/acme
git commit -m "chore(clients): migrate acme to separate repository"
```

### Step 3: Preserve Report History

Historical reports live in `reports/acme/`. They are not migrated to the client repository (they remain in the framework). The audit log and HTML/JSON reports remain accessible from `bin/audit-query.js --client=acme`.

### Step 4: Verify

```bash
# Verify the client works identically after migration
./bin/run-test.sh --client=acme --service=users --test=smoke
```
