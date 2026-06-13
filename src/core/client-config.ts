/**
 * Shared client configuration factory.
 *
 * Provides the generic plumbing every client needs: scenarioOptions(),
 * scenarioTags(), and THINK-time constants.  Each client calls
 * createClientConfig() once with its specific URL and tags, then
 * re-exports the helpers.
 *
 * Usage (in clients/<name>/lib/client-config.ts):
 *
 *   import config from "../config/default.json";
 *   import { createClientConfig, THINK } from "../../../src/core/client-config";
 *
 *   const helpers = createClientConfig({
 *     baseUrl: __ENV["API_BASE_URL"] || config.endpoints["my-api"].baseUrl,
 *     baseTags: { client: config.tags.client, service: config.tags.service },
 *   });
 *
 *   export const BASE_URL = helpers.BASE_URL;
 *   export const scenarioOptions = helpers.scenarioOptions;
 *   export const scenarioTags = helpers.scenarioTags;
 *   export { THINK };
 */

import { profileToOptions } from "./profile-loader";
import { ProfileName } from "../types/profile.d";

// ── Think-time constants (seconds) ───────────────────────────────────────────

export const THINK = {
  AGGRESSIVE: 0.1,
  FAST: 0.2,
  NORMAL: 0.3,
  REALISTIC: 0.5,
  LONG: 1.0,
} as const;

export type ThinkTime = typeof THINK;

// ── Types ────────────────────────────────────────────────────────────────────

export interface ClientHelpers {
  BASE_URL: string;
  scenarioOptions: (
    scenario: string,
    thresholdOverrides?: Record<string, string[]>
  ) => Record<string, unknown> & { tags: Record<string, string> };
  scenarioTags: (scenario: string) => Record<string, string>;
  THINK: ThinkTime;
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createClientConfig(options: {
  baseUrl: string;
  baseTags: Record<string, string>;
  profileName?: ProfileName;
}): ClientHelpers {
  const profile = (options.profileName || __ENV["K6_PROFILE"] || "smoke") as ProfileName;

  const baseTags = options.baseTags;

  function scenarioTags(scenario: string): Record<string, string> {
    return { ...baseTags, scenario };
  }

  function scenarioOptions(
    scenario: string,
    thresholdOverrides: Record<string, string[]> = {}
  ): Record<string, unknown> & { tags: Record<string, string> } {
    const opts = profileToOptions(profile, thresholdOverrides);
    return { ...opts, tags: scenarioTags(scenario) };
  }

  return {
    BASE_URL: options.baseUrl,
    scenarioOptions,
    scenarioTags,
    THINK,
  };
}
