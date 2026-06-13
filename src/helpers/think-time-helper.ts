/** Think-time simulation — realistic user delay patterns for load testing */

import { sleep } from "k6";

/** Preset think-time ranges [min, max] in seconds */
export const THINK_TIME = {
  FAST: [0.5, 1.5] as const,
  NORMAL: [1, 3] as const,
  SLOW: [2, 5] as const,
  READING: [3, 8] as const,
};

/**
 * Generate a normally-distributed random number using the Box-Muller transform.
 * Returns a value centered around `mean` with the given `stddev`.
 */
export function randomNormal(mean: number, stddev: number): number {
  let u1 = Math.random();
  let u2 = Math.random();
  // Avoid log(0)
  while (u1 === 0) u1 = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return mean + z * stddev;
}

/**
 * Sleep for a uniformly random duration between `min` and `max` seconds.
 * Simulates variable user think time.
 */
export function thinkTime(min: number, max: number): void {
  const duration = min + Math.random() * (max - min);
  sleep(duration);
}

/**
 * Sleep for a normally-distributed duration centered around `mean` seconds.
 * Clamped to [mean * 0.1, mean * 3] to prevent extreme outliers.
 */
export function thinkTimeNormal(mean: number, stddev: number): void {
  const lower = mean * 0.1;
  const upper = mean * 3;
  const duration = Math.max(lower, Math.min(upper, randomNormal(mean, stddev)));
  sleep(duration);
}

/**
 * Pace an iteration to a fixed target duration.
 * Sleeps for the remaining time so that each iteration takes exactly
 * `targetDurationMs` regardless of how long the requests took.
 * If the iteration already exceeded the target, no sleep occurs.
 *
 * @param targetDurationMs — desired iteration duration in milliseconds
 * @param iterationStartMs — timestamp (ms) when the iteration began (Date.now())
 * @returns the actual sleep duration in ms (0 if already exceeded)
 */
export function pace(targetDurationMs: number, iterationStartMs: number): number {
  const elapsed = Date.now() - iterationStartMs;
  const remaining = targetDurationMs - elapsed;
  if (remaining > 0) {
    sleep(remaining / 1000);
    return remaining;
  }
  return 0;
}

/** ThinkTimeHelper — static facade for think-time utilities */
export class ThinkTimeHelper {
  static THINK_TIME = THINK_TIME;
  static randomNormal = randomNormal;
  static thinkTime = thinkTime;
  static thinkTimeNormal = thinkTimeNormal;
  static pace = pace;
}
