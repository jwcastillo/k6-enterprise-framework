/** Configuration type definitions for k6 Enterprise Framework */

import { ProfileName } from "./profile.d";

export type Environment = "default" | "staging" | "production" | string;

export type AuthType = "bearer" | "basic" | "oauth2" | "apikey" | "none";

/**
 * Auth config shape used inside client configuration files.
 * Distinct from patterns/auth-pattern.ts::AuthConfig (runtime discriminated
 * union) and ai.d.ts::AiAuthConfig (test-plan metadata).
 */
export interface ClientAuthConfig {
  type: AuthType;
  loginUrl?: string;
  tokenPath?: string;
  username?: string;
  password?: string;
  apiKey?: string;
  apiKeyHeader?: string;
  clientId?: string;
  clientSecret?: string;
  tokenUrl?: string;
}

/** @deprecated renamed to ClientAuthConfig — collided with two other AuthConfig shapes. */
export type AuthConfig = ClientAuthConfig;

export interface EndpointConfig {
  baseUrl: string;
  timeout?: number;
  auth?: ClientAuthConfig;
}

export interface ClientConfig {
  client: string;
  version: string;
  environment: Environment;
  endpoints: Record<string, EndpointConfig>;
  secrets?: Record<string, string>;
  data?: Record<string, unknown>;
  tags?: Record<string, string>;
}

export interface TestConfig {
  name: string;
  description?: string;
  profile: ProfileName;
  client: string;
  environment: Environment;
  script: string;
  tags?: Record<string, string>;
  thresholds?: Record<string, string[]>;
  options?: Record<string, unknown>;
}

export interface FrameworkOptions {
  profile?: ProfileName;
  env?: Environment;
  client?: string;
  secretsBackends?: string[];
  structuredLogs?: boolean;
  debug?: boolean;
  reportsDir?: string;
  baselineFile?: string;
}
