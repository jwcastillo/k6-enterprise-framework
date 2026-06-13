import { describe, it, expect, vi, beforeEach } from "vitest";
import http from "k6/http";
import { GraphQLHelper } from "../../src/helpers/graphql-helper";

// Mock header-helper to avoid its internal complexity
vi.mock("../../src/helpers/header-helper", () => ({
  HeaderHelper: {
    standard: vi.fn(() => ({
      "Content-Type": "application/json",
      Accept: "application/json",
    })),
  },
}));

function mockResponse(overrides: Partial<{
  status: number;
  body: string | null;
  headers: Record<string, string>;
  timings: { duration: number; waiting: number; receiving: number; sending: number };
}> = {}) {
  return {
    status: overrides.status ?? 200,
    body: overrides.body ?? '{"data":null}',
    headers: overrides.headers ?? { "Content-Type": "application/json" },
    timings: overrides.timings ?? { duration: 50, waiting: 40, receiving: 8, sending: 2 },
  };
}

describe("GraphQLHelper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Constructor ────────────────────────────────────────────────────────────

  describe("constructor", () => {
    it("uses /graphql as default endpoint", () => {
      const gql = new GraphQLHelper("https://api.example.com");
      vi.mocked(http.post).mockReturnValue(
        mockResponse({ body: '{"data":{"user":{"id":1}}}' }) as never
      );
      gql.query({ query: "{ user { id } }" });
      const calledUrl = vi.mocked(http.post).mock.calls[0][0] as string;
      expect(calledUrl).toBe("https://api.example.com/graphql");
    });

    it("uses custom endpoint", () => {
      const gql = new GraphQLHelper("https://api.example.com", "/api/graphql");
      vi.mocked(http.post).mockReturnValue(
        mockResponse({ body: '{"data":null}' }) as never
      );
      gql.query({ query: "{ test }" });
      const calledUrl = vi.mocked(http.post).mock.calls[0][0] as string;
      expect(calledUrl).toBe("https://api.example.com/api/graphql");
    });
  });

  // ── query ────────────────────────────────────────────────────────────────────

  describe("query", () => {
    it("returns data on successful response", () => {
      const gql = new GraphQLHelper("https://api.example.com");
      vi.mocked(http.post).mockReturnValue(
        mockResponse({ body: '{"data":{"users":[{"id":1},{"id":2}]}}' }) as never
      );
      const result = gql.query<{ users: { id: number }[] }>({
        query: "{ users { id } }",
      });
      expect(result.data).toEqual({ users: [{ id: 1 }, { id: 2 }] });
      expect(result.hasData).toBe(true);
      expect(result.isSuccess).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it("returns errors on GraphQL error response", () => {
      const gql = new GraphQLHelper("https://api.example.com");
      vi.mocked(http.post).mockReturnValue(
        mockResponse({
          body: '{"data":null,"errors":[{"message":"Field not found"}]}',
        }) as never
      );
      const result = gql.query({ query: "{ invalid }" });
      expect(result.data).toBeNull();
      expect(result.hasData).toBe(false);
      expect(result.isSuccess).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors![0].message).toBe("Field not found");
    });

    it("handles partial response (data + errors)", () => {
      const gql = new GraphQLHelper("https://api.example.com");
      vi.mocked(http.post).mockReturnValue(
        mockResponse({
          body: '{"data":{"user":{"id":1}},"errors":[{"message":"Deprecated field"}]}',
        }) as never
      );
      const result = gql.query({ query: "{ user { id } }" });
      expect(result.data).toEqual({ user: { id: 1 } });
      expect(result.hasData).toBe(true);
      expect(result.isSuccess).toBe(false);
      expect(result.errors).toHaveLength(1);
    });

    it("returns HTTP error for non-200 status", () => {
      const gql = new GraphQLHelper("https://api.example.com");
      vi.mocked(http.post).mockReturnValue(
        mockResponse({ status: 500, body: "Internal Server Error" }) as never
      );
      const result = gql.query({ query: "{ test }" });
      expect(result.data).toBeNull();
      expect(result.hasData).toBe(false);
      expect(result.isSuccess).toBe(false);
      expect(result.errors![0].message).toBe("HTTP error 500");
    });

    it("sends Content-Type and Accept headers", () => {
      const gql = new GraphQLHelper("https://api.example.com");
      vi.mocked(http.post).mockReturnValue(
        mockResponse({ body: '{"data":null}' }) as never
      );
      gql.query({ query: "{ test }" });
      const body = vi.mocked(http.post).mock.calls[0][1] as string;
      const parsed = JSON.parse(body);
      expect(parsed.query).toBe("{ test }");
    });

    it("sends variables and operationName in the body", () => {
      const gql = new GraphQLHelper("https://api.example.com");
      vi.mocked(http.post).mockReturnValue(
        mockResponse({ body: '{"data":{"user":{"id":1}}}' }) as never
      );
      gql.query({
        query: "query GetUser($id: ID!) { user(id: $id) { id } }",
        variables: { id: "123" },
        operationName: "GetUser",
      });
      const body = vi.mocked(http.post).mock.calls[0][1] as string;
      const parsed = JSON.parse(body);
      expect(parsed.variables).toEqual({ id: "123" });
      expect(parsed.operationName).toBe("GetUser");
    });

    it("includes http SafeResponse in the result", () => {
      const gql = new GraphQLHelper("https://api.example.com");
      vi.mocked(http.post).mockReturnValue(
        mockResponse({ status: 200, body: '{"data":null}' }) as never
      );
      const result = gql.query({ query: "{ test }" });
      expect(result.http).toBeDefined();
      expect(result.http.status).toBe(200);
    });

    it("handles empty body gracefully", () => {
      const gql = new GraphQLHelper("https://api.example.com");
      vi.mocked(http.post).mockReturnValue(
        mockResponse({ status: 200, body: null }) as never
      );
      const result = gql.query({ query: "{ test }" });
      expect(result.data).toBeNull();
      expect(result.hasData).toBe(false);
    });
  });

  // ── mutate ───────────────────────────────────────────────────────────────────

  describe("mutate", () => {
    it("calls query internally (alias)", () => {
      const gql = new GraphQLHelper("https://api.example.com");
      vi.mocked(http.post).mockReturnValue(
        mockResponse({ body: '{"data":{"createUser":{"id":"abc"}}}' }) as never
      );
      const result = gql.mutate({
        query: "mutation { createUser(name: \"test\") { id } }",
      });
      expect(result.data).toEqual({ createUser: { id: "abc" } });
      expect(result.hasData).toBe(true);
      expect(result.isSuccess).toBe(true);
    });
  });

  // ── Static check helpers ─────────────────────────────────────────────────────

  describe("hasNoErrors", () => {
    it("returns true when isSuccess is true", () => {
      const res = {
        data: { test: 1 },
        hasData: true,
        isSuccess: true,
        http: {} as never,
      };
      expect(GraphQLHelper.hasNoErrors(res)).toBe(true);
    });

    it("returns false when isSuccess is false", () => {
      const res = {
        data: null,
        errors: [{ message: "err" }],
        hasData: false,
        isSuccess: false,
        http: {} as never,
      };
      expect(GraphQLHelper.hasNoErrors(res)).toBe(false);
    });
  });

  describe("hasData", () => {
    it("returns true when data is present", () => {
      const res = {
        data: { users: [] },
        hasData: true,
        isSuccess: true,
        http: {} as never,
      };
      expect(GraphQLHelper.hasData(res)).toBe(true);
    });

    it("returns false when data is null", () => {
      const res = {
        data: null,
        hasData: false,
        isSuccess: false,
        http: {} as never,
      };
      expect(GraphQLHelper.hasData(res)).toBe(false);
    });
  });

  describe("fieldExists", () => {
    it("returns true when field exists in data", () => {
      const res = {
        data: { users: [], total: 0 } as Record<string, unknown>,
        hasData: true,
        isSuccess: true,
        http: {} as never,
      };
      expect(GraphQLHelper.fieldExists(res, "users")).toBe(true);
    });

    it("returns false when field does not exist in data", () => {
      const res = {
        data: { users: [] } as Record<string, unknown>,
        hasData: true,
        isSuccess: true,
        http: {} as never,
      };
      expect(GraphQLHelper.fieldExists(res, "posts")).toBe(false);
    });

    it("returns false when data is null", () => {
      const res = {
        data: null,
        hasData: false,
        isSuccess: false,
        http: {} as never,
      };
      expect(GraphQLHelper.fieldExists(res as never, "anything")).toBe(false);
    });
  });
});
