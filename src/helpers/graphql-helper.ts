/** T-018a: GraphQLHelper — Queries y mutations sobre HTTP con instrumentacion k6 */

import { RequestHelper, RequestOptions } from "./request-helper";
import { SafeResponse } from "@types-k6/safe-response";

export interface GraphQLQuery {
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
}

export interface GraphQLResponse<T = unknown> {
  data: T | null;
  errors?: GraphQLError[];
  /** True if data is present (even if errors also present — partial response) */
  hasData: boolean;
  /** True if response has no errors */
  isSuccess: boolean;
  /** Underlying HTTP response */
  http: SafeResponse;
}

export interface GraphQLError {
  message: string;
  locations?: { line: number; column: number }[];
  path?: string[];
  extensions?: Record<string, unknown>;
}

export class GraphQLHelper {
  private readonly client: RequestHelper;
  private readonly endpoint: string;

  constructor(baseUrl: string, endpoint = "/graphql", opts: RequestOptions = {}) {
    this.client = new RequestHelper(baseUrl, opts);
    this.endpoint = endpoint;
  }

  /**
   * Execute a GraphQL query or mutation.
   * Handles partial responses (data + errors simultaneously) as checks.
   */
  query<T = unknown>(gql: GraphQLQuery, opts: RequestOptions = {}): GraphQLResponse<T> {
    const res = this.client.post(this.endpoint, gql, {
      ...opts,
      extraHeaders: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(opts.extraHeaders ?? {}),
      },
    });

    if (res.status !== 200) {
      return {
        data: null,
        errors: [{ message: `HTTP error ${res.status}` }],
        hasData: false,
        isSuccess: false,
        http: res,
      };
    }

    const body = res.json<{ data?: T; errors?: GraphQLError[] }>();
    const data = body?.data ?? null;
    const errors = body?.errors;

    return {
      data,
      errors,
      hasData: data !== null,
      // EC-BRW-002: partial responses (data + errors) are partially successful
      isSuccess: !errors || errors.length === 0,
      http: res,
    };
  }

  /** Execute a mutation (alias for query — GraphQL mutations use POST /graphql too) */
  mutate<T = unknown>(gql: GraphQLQuery, opts: RequestOptions = {}): GraphQLResponse<T> {
    return this.query<T>(gql, opts);
  }

  /**
   * Build a check-compatible function for GraphQL responses.
   * Use with k6 check() or runChecks().
   */
  static hasNoErrors<T>(res: GraphQLResponse<T>): boolean {
    return res.isSuccess;
  }

  static hasData<T>(res: GraphQLResponse<T>): boolean {
    return res.hasData;
  }

  static fieldExists<T extends Record<string, unknown>>(
    res: GraphQLResponse<T>,
    field: string
  ): boolean {
    return res.data !== null && field in (res.data as Record<string, unknown>);
  }
}
