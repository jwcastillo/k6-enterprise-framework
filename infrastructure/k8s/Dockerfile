# k6 Enterprise Framework — k6-operator compatible image (T-156)
#
# Builds a self-contained k6 image with compiled test scripts embedded.
# Compatible with grafana/k6-operator CRD-based test execution.
#
# Build args:
#   CLIENT          — client name (matches clients/<CLIENT>/) [required]
#   K6_VERSION      — k6 base image version tag (human-readable) [default: 2.3.0]
#   K6_VERSION_DIGEST — SHA256 digest of the k6 base image [see ARG below]
#   NODE_DIGEST     — SHA256 digest of the node:22-alpine builder image [see ARG below]
#
# Security hardening:
#   Runs as UID 65534 (nobody/nogroup) [SEC-07]
#   k6 base image pinned by SHA256 digest [SEC-08]
#   node:22-alpine builder image pinned by SHA256 digest [CR-04]
#   To refresh k6 digest:   ./bin/update-k6-digest.sh --tag=<version>
#   To refresh node digest: docker pull node:22-alpine && docker image inspect node:22-alpine --format='{{index .RepoDigests 0}}'
#
# Usage:
#   npm run build                      # compile TypeScript first
#   docker build \
#     --build-arg CLIENT=my-team \
#     -f infrastructure/k8s/Dockerfile \
#     -t registry.example.com/k6-my-team:latest .
#
# Multi-arch:
#   docker buildx build \
#     --platform linux/amd64,linux/arm64 \
#     --build-arg CLIENT=my-team \
#     -f infrastructure/k8s/Dockerfile \
#     -t registry.example.com/k6-my-team:latest \
#     --push .

ARG K6_VERSION=2.3.0
# SEC-08: Default digest — refresh via bin/update-k6-digest.sh; this placeholder is
# replaced in Task 2 of Plan 01-06 with the real digest of grafana/k6:${K6_VERSION}.
ARG K6_VERSION_DIGEST=sha256:9c2dee7f8ed74d317e4027c06a10f169b625638189de8d4555d0b3486a5aeb34

# CR-04: Builder stage digest — pin node:22-alpine to a specific SHA-256 to prevent
# mutable-tag supply-chain substitution. Refresh with:
#   docker pull node:22-alpine && docker image inspect node:22-alpine --format='{{index .RepoDigests 0}}'
ARG NODE_DIGEST=sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402

# ── Build stage: verify dist exists ───────────────────────────────────────────
FROM node:22-alpine@${NODE_DIGEST} AS builder

ARG CLIENT
RUN test -n "${CLIENT}" || (echo "ERROR: --build-arg CLIENT=<name> is required" && exit 1)

WORKDIR /build

# Copy compiled bundles (must run `npm run build` before docker build)
COPY dist/ ./dist/

# Verify the client's compiled scripts exist
RUN test -d "./dist/${CLIENT}" || \
    (echo "ERROR: dist/${CLIENT}/ not found. Run 'npm run build' first." && exit 1)

# ── Final stage: k6-operator compatible image ─────────────────────────────────
FROM grafana/k6@${K6_VERSION_DIGEST}

ARG CLIENT
ENV K6_CLIENT=${CLIENT}

# Copy compiled scripts for this client
COPY --from=builder /build/dist/${CLIENT} /scripts/

# SEC-07: Drop root — run as nobody/nogroup (UID 65534).
# Idempotent against base images that already run as nonroot.
USER 65534

# k6-operator expects scripts in /scripts/ by convention
# The CRD's spec.script.configMap can override the path

# Default entrypoint: k6 (inherited from base image)
# Override in CRD: spec.runner.command

LABEL org.opencontainers.image.title="k6-enterprise-${CLIENT}" \
      org.opencontainers.image.description="k6 Enterprise Framework — ${CLIENT} client" \
      org.opencontainers.image.vendor="k6 Enterprise Framework" \
      k6.enterprise.client="${CLIENT}" \
      k6.version="${K6_VERSION}" \
      k6.version.digest="${K6_VERSION_DIGEST}"
