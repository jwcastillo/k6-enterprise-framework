/** Barrel exports for k6 Enterprise Framework types */

export * from "./profile.d";
export * from "./config.d";
export * from "./report.d";
export * from "./safe-response";

// Phase 2: Enterprise types
export * from "./client.d";
export * from "./audit.d";
export * from "./rbac.d";
export * from "./slo.d";
export * from "./mock.d";
export * from "./benchmark.d";

// Phase 5: AI Agentic Pipeline types (T-107)
export * from "./ai.d";

/** Client extension contract — implemented by each product-specific layer */
export interface ClientExtension {
  /** Unique client identifier (matches directory name under clients/) */
  readonly clientId: string;
  /** Semantic version of the client layer */
  readonly version: string;
  /** Required directory structure entries */
  readonly requiredPaths: string[];
  /** Custom check registrations */
  customChecks?: Record<string, (response: unknown) => boolean>;
}

/** Check definition for the generic check system */
export interface CheckDefinition {
  name: string;
  fn: (response: unknown) => boolean;
  type: "status" | "schema" | "content" | "threshold" | "custom";
}

/** Secret resolution result */
export interface SecretValue {
  key: string;
  value: string;
  backend: string;
  masked: string;
}
