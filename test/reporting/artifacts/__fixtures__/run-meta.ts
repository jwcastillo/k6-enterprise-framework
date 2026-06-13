import type { RunMeta } from "../../../../src/reporting/artifacts/types";

/** Deterministic RunMeta fixture for snapshot tests. */
export function makeRunMeta(overrides: Partial<RunMeta> = {}): RunMeta {
  return {
    runId: "test-run-001",
    timestamp: "20260319-113700",
    scenario: "smoke-users",
    profile: "smoke",
    env: "staging",
    client: "acme",
    exitCode: 0,
    ...overrides,
  };
}
