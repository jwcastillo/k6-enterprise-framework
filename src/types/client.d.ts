/** Client isolation and multi-tenant types for k6 Enterprise Framework (Phase 2) */

/** Resolved paths for a client's isolated filesystem namespace */
export interface ClientContext {
  /** Client identifier (directory name under clients/) */
  clientId: string;
  /** Absolute canonical path to the client root */
  rootDir: string;
  /** Absolute path to config directory */
  configDir: string;
  /** Absolute path to data directory (pools, fixtures) */
  dataDir: string;
  /** Absolute path to lib directory (services, factories) */
  libDir: string;
  /** Absolute path to scenarios directory */
  scenariosDir: string;
  /** Absolute path to reports output directory */
  reportsDir: string;
  /** Absolute path to .env file (if exists) */
  envFile: string;
  /** Absolute path to mocks directory */
  mocksDir: string;
  /** Absolute path to branding directory */
  brandingDir: string;
  /** Whether the client is linked via git submodule */
  isSubmodule: boolean;
  /** Whether the client is linked via symlink */
  isSymlink: boolean;
}

/**
 * Data pool exhaustion policy.
 * - recycle: restart from beginning when pool is exhausted
 * - generate: generate new data via DataHelper
 * - stop: halt VU with descriptive error
 */
export type ExhaustionPolicy = "recycle" | "generate" | "stop";

/** Configuration for a client's data pool */
export interface DataPoolConfig {
  /** Path to data file relative to client data/ directory */
  file: string;
  /** Column or field to use as unique key */
  keyField?: string;
  /** Exhaustion policy when all records have been consumed */
  exhaustionPolicy: ExhaustionPolicy;
  /** Maximum records to load (0 = all) */
  maxRecords?: number;
}

/** Client-specific threshold overrides per service and profile */
export interface ThresholdOverrideConfig {
  /** Service-level threshold overrides */
  services?: Record<string, Record<string, string[]>>;
  /** Profile-level threshold overrides */
  profiles?: Record<string, Record<string, string[]>>;
  /** Global overrides applied to all services/profiles */
  global?: Record<string, string[]>;
}
