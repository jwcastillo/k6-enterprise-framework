/** T-010: DataHelper — Generadores de datos de prueba */

const CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
const ALPHA = "abcdefghijklmnopqrstuvwxyz";

/** Generate a random string of given length from charset */
export function randomString(length: number, charset = CHARS): string {
  let result = "";
  for (let i = 0; i < length; i++) {
    result += charset[Math.floor(Math.random() * charset.length)];
  }
  return result;
}

/** Generate a unique, valid-format email */
export function randomEmail(domain = "test.example.com"): string {
  const local = randomString(8, ALPHA) + Math.floor(Math.random() * 9999);
  return `${local}@${domain}`;
}

/** Luhn algorithm — validates credit card numbers */
function luhnCheck(digits: number[]): boolean {
  let sum = 0;
  let isEven = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits[i];
    if (isEven) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    isEven = !isEven;
  }
  return sum % 10 === 0;
}

/** Generate a Luhn-valid 16-digit credit card number (test prefix 4111...) */
export function randomCreditCard(): string {
  // Start with Visa test prefix
  const prefix = [4, 1, 1, 1];
  const digits: number[] = [...prefix];
  for (let i = 0; i < 11; i++) {
    digits.push(Math.floor(Math.random() * 10));
  }
  // Calculate Luhn check digit
  let sum = 0;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits[i];
    if ((digits.length - 1 - i) % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  digits.push((10 - (sum % 10)) % 10);
  const card = digits.join("");
  // Verify
  if (!luhnCheck(digits)) {
    throw new Error("DataHelper: Luhn calculation error");
  }
  return card;
}

export interface GeneratedUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  username: string;
}

const FIRST_NAMES = ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace", "Hank"];
const LAST_NAMES = ["Smith", "Jones", "Garcia", "Martinez", "Davis", "Wilson", "Anderson"];

/** Generate a random user with realistic-looking data */
export function randomUser(): GeneratedUser {
  const firstName = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const lastName = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  const id = randomString(8, "0123456789abcdef");
  const username = `${firstName.toLowerCase()}.${lastName.toLowerCase()}.${randomString(4)}`;
  return {
    id,
    firstName,
    lastName,
    email: `${username}@test.example.com`,
    username,
  };
}

/** Generate a random price in [min, max] with given decimal precision */
export function randomPrice(min = 0.01, max = 999.99, decimals = 2): number {
  const raw = min + Math.random() * (max - min);
  const factor = Math.pow(10, decimals);
  return Math.round(raw * factor) / factor;
}

/** Generate a UUID v4 */
export function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Generate a random integer between min and max (inclusive) */
export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Pick a random item from an array (accepts readonly so const-as-const arrays work). */
export function randomItem<T>(array: readonly T[]): T {
  if (array.length === 0) {
    throw new Error("Cannot pick random item from empty array");
  }
  return array[Math.floor(Math.random() * array.length)];
}

/** Shuffle an array (Fisher-Yates) */
export function shuffle<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/** Generate a random boolean */
export function randomBoolean(): boolean {
  return Math.random() < 0.5;
}

/** Generate a random phone number */
export function randomPhone(countryCode = "+1"): string {
  return `${countryCode}${randomInt(200, 999)}${randomInt(200, 999)}${randomInt(1000, 9999)}`;
}

/** Generate a random password */
export function randomPassword(length = 12): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/** Deep clone an object via JSON */
export function clone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/** Deep merge objects */
export function merge<T extends Record<string, unknown>>(target: T, ...sources: Partial<T>[]): T {
  const result = clone(target);
  for (const source of sources) {
    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        const sv = source[key];
        const tv = (result as Record<string, unknown>)[key];
        if (sv && typeof sv === "object" && !Array.isArray(sv)) {
          (result as Record<string, unknown>)[key] = merge(
            (tv || {}) as Record<string, unknown>,
            sv as Record<string, unknown>
          );
        } else {
          (result as Record<string, unknown>)[key] = sv;
        }
      }
    }
  }
  return result;
}

/**
 * Pick a function based on probability weights (must sum to 1.0).
 * Returns the chosen function without executing it.
 *
 * Distinct from patterns/weighted-execution.ts::weightedSwitch (which takes
 * named scenarios and executes the selection); kept here because data-helper
 * callers want the pure picker, not auto-execution.
 */
export function pickWeightedFn<T extends () => unknown>(weightedFuncs: Array<[number, T]>): T {
  let weightSum = 0;
  const intervals: Array<{ start: number; end: number; func: T }> = [];
  for (const [w, fn] of weightedFuncs) {
    intervals.push({ start: weightSum, end: weightSum + w, func: fn });
    weightSum += w;
  }
  if (Math.abs(weightSum - 1) > 0.0001) {
    throw new Error(`Weights must sum to 1.0, got ${weightSum}`);
  }
  const val = Math.random();
  for (const iv of intervals) {
    if (val >= iv.start && val < iv.end) return iv.func;
  }
  return intervals[intervals.length - 1].func;
}

/** @deprecated renamed to pickWeightedFn — collided with patterns/weighted-execution.ts::weightedSwitch which has a different signature and behavior. */
export const weightedSwitch = pickWeightedFn;

/**
 * Pick a uniformly-random element from a non-empty array.
 *
 * @example
 *   const route = pickRandom(routes); // each route equally likely
 */
export function pickRandom<T>(items: T[]): T {
  if (!items.length) throw new Error("pickRandom: empty array");
  return items[(Math.random() * items.length) | 0];
}

/**
 * Pick one element from `items` using positive *relative* weights.
 *
 * Unlike {@link pickWeightedFn}, weights need NOT sum to 1.0 — they are
 * normalized internally, so `[60, 30, 10]` means 60% / 30% / 10%. Negative or
 * non-numeric weights are treated as 0. Returns an item (not a function), which
 * makes it the right tool for data-driven selection (routes, payloads, users…).
 *
 * @param items   Candidate values; must be non-empty.
 * @param weights Relative weight per item; must match `items.length`.
 *
 * @example
 *   // 60% short, 30% medium, 10% long
 *   const bucket = pickWeighted(["short", "medium", "long"], [60, 30, 10]);
 *
 * @example
 *   // Weights from an env var: -e DISTANCE_MIX="70,20,10"
 *   const mix = (__ENV.DISTANCE_MIX || "60,30,10").split(",").map(Number);
 *   const route = pickWeighted(routes, mix);
 */
export function pickWeighted<T>(items: T[], weights: number[]): T {
  if (!items.length) throw new Error("pickWeighted: empty items array");
  if (items.length !== weights.length) {
    throw new Error(
      `pickWeighted: items (${items.length}) and weights (${weights.length}) length mismatch`
    );
  }
  const safe = weights.map((w) => Math.max(0, Number(w) || 0));
  const total = safe.reduce((a, b) => a + b, 0) || 1;
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    if (r < safe[i]) return items[i];
    r -= safe[i];
  }
  return items[items.length - 1];
}

/** Format number with thousand separators */
export function formatNumber(num: number, separator = ","): string {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

/** Convert object to query string */
export function toQueryString(obj: Record<string, unknown>): string {
  return Object.entries(obj)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
}

/** Generate a random person name */
export function randomName(): { first: string; last: string; full: string } {
  const first = randomItem(FIRST_NAMES);
  const last = randomItem(LAST_NAMES);
  return { first, last, full: `${first} ${last}` };
}

/** Generate a random date between two dates */
export function randomDate(start: Date, end: Date): Date {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

/** DataHelper — static facade for all generators */
export class DataHelper {
  static randomString = randomString;
  static randomEmail = randomEmail;
  static randomCreditCard = randomCreditCard;
  static randomUser = randomUser;
  static randomPrice = randomPrice;
  static uuid = uuid;
  static randomInt = randomInt;
  static randomItem = randomItem;
  static shuffle = shuffle;
  static randomBoolean = randomBoolean;
  static randomPhone = randomPhone;
  static randomPassword = randomPassword;
  static clone = clone;
  static merge = merge;
  static weightedSwitch = weightedSwitch;
  static formatNumber = formatNumber;
  static toQueryString = toQueryString;
  static randomName = randomName;
  static randomDate = randomDate;
}
