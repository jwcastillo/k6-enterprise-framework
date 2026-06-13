/** T-019: Assertion helper — fluent expect() API complementing check-system (k6 v1.2.1+) */

import { check } from "k6";
import { SafeResponse } from "@types-k6/safe-response";

export interface AssertionResult {
  name: string;
  passed: boolean;
}

/**
 * Fluent assertion builder that integrates with k6 check() for metrics.
 * Provides expect()-style API complementing the existing check system.
 *
 * @example
 *   const res = client.get("/api/users");
 *   expect(res).status(200);
 *   expect(res).bodyContains("users");
 *   expect(res).jsonField("data").toBeDefined();
 *   expect(res).responseTime().toBeLessThan(500);
 */
export function expect(response: SafeResponse): ResponseExpectation {
  return new ResponseExpectation(response);
}

export class ResponseExpectation {
  private _results: AssertionResult[] = [];

  constructor(private response: SafeResponse) {}

  /** Assert exact status code */
  status(expected: number): this {
    const name = `expect: status is ${expected}`;
    const passed = this.response.status === expected;
    check(this.response, { [name]: () => passed });
    this._results.push({ name, passed });
    return this;
  }

  /** Assert status code is within range (inclusive) */
  statusIn(min: number, max: number): this {
    const name = `expect: status in ${min}-${max}`;
    const passed = this.response.status >= min && this.response.status <= max;
    check(this.response, { [name]: () => passed });
    this._results.push({ name, passed });
    return this;
  }

  /** Assert body contains a substring */
  bodyContains(substring: string): this {
    const name = `expect: body contains '${substring}'`;
    const passed = this.response.body.includes(substring);
    check(this.response, { [name]: () => passed });
    this._results.push({ name, passed });
    return this;
  }

  /** Start a field assertion chain for a JSON path */
  jsonField(path: string): FieldExpectation {
    return new FieldExpectation(this.response, path, this._results);
  }

  /** Start a header assertion chain */
  header(name: string): HeaderExpectation {
    return new HeaderExpectation(this.response, name, this._results);
  }

  /** Start a response time assertion chain */
  responseTime(): DurationExpectation {
    return new DurationExpectation(this.response, this._results);
  }

  /** All assertions passed? */
  get passed(): boolean {
    return this._results.every((r) => r.passed);
  }

  /** Individual assertion results */
  get results(): AssertionResult[] {
    return [...this._results];
  }
}

/** Assertion chain for a JSON field extracted via dot-notation path */
export class FieldExpectation {
  private value: unknown;
  private resolved = false;

  constructor(
    private response: SafeResponse,
    private path: string,
    private _results: AssertionResult[]
  ) {
    this.value = this.resolve();
  }

  private resolve(): unknown {
    try {
      const body = this.response.json<Record<string, unknown>>();
      if (!body || typeof body !== "object") return undefined;
      return this.path.split(".").reduce<unknown>((obj, key) => {
        if (obj && typeof obj === "object" && key in (obj as Record<string, unknown>)) {
          return (obj as Record<string, unknown>)[key];
        }
        return undefined;
      }, body);
    } catch {
      return undefined;
    }
  }

  /** Assert the field exists and is not undefined */
  toBeDefined(): this {
    const name = `expect: '${this.path}' is defined`;
    const passed = this.value !== undefined;
    check(this.response, { [name]: () => passed });
    this._results.push({ name, passed });
    this.resolved = true;
    return this;
  }

  /** Assert the field equals an expected value (strict equality) */
  toEqual(expected: unknown): this {
    const name = `expect: '${this.path}' equals ${JSON.stringify(expected)}`;
    const passed = this.value === expected;
    check(this.response, { [name]: () => passed });
    this._results.push({ name, passed });
    this.resolved = true;
    return this;
  }

  /** Assert the field contains a substring (string fields) */
  toContain(substring: string): this {
    const name = `expect: '${this.path}' contains '${substring}'`;
    const passed = typeof this.value === "string" && this.value.includes(substring);
    check(this.response, { [name]: () => passed });
    this._results.push({ name, passed });
    this.resolved = true;
    return this;
  }

  /** Assert the field is an array with a specific length */
  toHaveLength(expected: number): this {
    const name = `expect: '${this.path}' has length ${expected}`;
    const passed = Array.isArray(this.value) && this.value.length === expected;
    check(this.response, { [name]: () => passed });
    this._results.push({ name, passed });
    this.resolved = true;
    return this;
  }
}

/** Assertion chain for response headers */
export class HeaderExpectation {
  private value: string | undefined;

  constructor(
    private response: SafeResponse,
    private headerName: string,
    private _results: AssertionResult[]
  ) {
    const headers = this.response.headers;
    // Header names are case-insensitive
    const lowerName = headerName.toLowerCase();
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === lowerName) {
        this.value = headers[key];
        break;
      }
    }
  }

  /** Assert header exists */
  toBeDefined(): this {
    const name = `expect: header '${this.headerName}' is defined`;
    const passed = this.value !== undefined;
    check(this.response, { [name]: () => passed });
    this._results.push({ name, passed });
    return this;
  }

  /** Assert header equals a value */
  toEqual(expected: string): this {
    const name = `expect: header '${this.headerName}' equals '${expected}'`;
    const passed = this.value === expected;
    check(this.response, { [name]: () => passed });
    this._results.push({ name, passed });
    return this;
  }

  /** Assert header contains a substring */
  toContain(substring: string): this {
    const name = `expect: header '${this.headerName}' contains '${substring}'`;
    const passed = typeof this.value === "string" && this.value.includes(substring);
    check(this.response, { [name]: () => passed });
    this._results.push({ name, passed });
    return this;
  }
}

/** Assertion chain for response time / duration */
export class DurationExpectation {
  constructor(
    private response: SafeResponse,
    private _results: AssertionResult[]
  ) {}

  /** Assert response time is less than maxMs */
  toBeLessThan(maxMs: number): this {
    const name = `expect: response time < ${maxMs}ms`;
    const passed = this.response.timings.duration < maxMs;
    check(this.response, { [name]: () => passed });
    this._results.push({ name, passed });
    return this;
  }

  /** Assert response time is greater than minMs */
  toBeGreaterThan(minMs: number): this {
    const name = `expect: response time > ${minMs}ms`;
    const passed = this.response.timings.duration > minMs;
    check(this.response, { [name]: () => passed });
    this._results.push({ name, passed });
    return this;
  }
}
