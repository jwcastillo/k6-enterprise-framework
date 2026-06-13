/**
 * T-260: GPT throughput model — converts target user count to RPS and recommended max VUs.
 *
 * Based on the GitLab Performance Tool (GPT) user-to-RPS convention:
 * https://gitlab.com/gitlab-org/quality/performance
 *
 * Constants per 1 000 users (from GPT defaults):
 *   api:      20 RPS
 *   web:       2 RPS
 *   git-pull:  2 RPS
 *   git-push:  0.4 RPS  (floor: any users > 0 yields at least 1 RPS)
 *
 * Max VU recommendation: 5 × targetRps, capped at 2 000 (GPT convention).
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** Endpoint classification used by the GPT throughput model. */
export type EndpointClass = "api" | "web" | "git-pull" | "git-push";

// ── Constants ─────────────────────────────────────────────────────────────────

/** RPS generated per 1 000 concurrent users, keyed by endpoint class. */
const RPS_PER_1000_USERS: Record<EndpointClass, number> = {
  api: 20,
  web: 2,
  "git-pull": 2,
  "git-push": 0.4,
};

/** Maximum recommended VUs (GPT convention). */
const MAX_VUS = 2000;

/** Multiplier from RPS to recommended max VUs (GPT convention). */
const VUS_PER_RPS = 5;

// ── Functions ─────────────────────────────────────────────────────────────────

/**
 * Compute the target RPS for a given number of concurrent users and endpoint class.
 *
 * Formula: round-half-up(users / 1000 × constant)
 * Special case: git-push RPS is floored to 1 for any users > 0.
 * Non-positive or NaN user counts return 0 for all classes.
 *
 * @param users         - Number of concurrent virtual users (non-negative integer).
 * @param endpointClass - GPT endpoint classification.
 * @returns Target RPS as a non-negative integer.
 *
 * @example
 *   targetRpsForUsers(1000, "api")      // 20
 *   targetRpsForUsers(500,  "api")      // 10
 *   targetRpsForUsers(1000, "git-push") // 1  (floor applied)
 *   targetRpsForUsers(0,    "api")      // 0
 */
export function targetRpsForUsers(users: number, endpointClass: EndpointClass): number {
  if (!users || users <= 0 || !Number.isFinite(users)) return 0;

  const constant = RPS_PER_1000_USERS[endpointClass];
  const raw = (users / 1000) * constant;

  // Round half-up (Math.round uses "round half to even" in some JS engines;
  // Math.floor(x + 0.5) is the standard round-half-up implementation).
  const rounded = Math.floor(raw + 0.5);

  // git-push floor: any users > 0 must yield at least 1 RPS
  if (endpointClass === "git-push" && rounded < 1) {
    return 1;
  }

  return rounded;
}

/**
 * Compute the recommended maximum number of VUs for a given target RPS.
 *
 * Formula: min(round(rps × 5), 2000)
 * Negative RPS is treated as 0.
 *
 * @param rps - Target RPS (non-negative).
 * @returns Recommended max VUs, capped at 2 000.
 *
 * @example
 *   recommendMaxVUs(10)   // 50
 *   recommendMaxVUs(500)  // 2000  (2500 capped)
 *   recommendMaxVUs(0)    // 0
 */
export function recommendMaxVUs(rps: number): number {
  if (!rps || rps <= 0) return 0;
  return Math.min(Math.round(rps * VUS_PER_RPS), MAX_VUS);
}

/**
 * Build a full throughput plan for all four endpoint classes given a user count.
 *
 * @param users - Number of concurrent virtual users.
 * @returns Plan object with target RPS and recommended max VUs per class.
 *
 * @example
 *   buildThroughputPlan(1000)
 *   // {
 *   //   users: 1000,
 *   //   perClass: {
 *   //     api:      { targetRps: 20, recommendedMaxVUs: 100 },
 *   //     web:      { targetRps: 2,  recommendedMaxVUs: 10  },
 *   //     "git-pull": { targetRps: 2, recommendedMaxVUs: 10 },
 *   //     "git-push": { targetRps: 1, recommendedMaxVUs: 5  },
 *   //   }
 *   // }
 */
export function buildThroughputPlan(users: number): {
  users: number;
  perClass: Record<EndpointClass, { targetRps: number; recommendedMaxVUs: number }>;
} {
  const classes: EndpointClass[] = ["api", "web", "git-pull", "git-push"];

  const perClass = {} as Record<EndpointClass, { targetRps: number; recommendedMaxVUs: number }>;
  for (const cls of classes) {
    const targetRps = targetRpsForUsers(users, cls);
    perClass[cls] = {
      targetRps,
      recommendedMaxVUs: recommendMaxVUs(targetRps),
    };
  }

  return { users, perClass };
}
