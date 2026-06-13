/**
 * 10-graphql — GraphQL query and mutation testing
 *
 * Demonstrates: GraphQLHelper pattern, query/mutation structure,
 * error handling for GraphQL-specific errors (200 + errors field)
 *
 * Uses a public GraphQL endpoint (postman-echo echoes the POST body)
 *
 * Expected results:
 *   - POST returns 200
 *   - Response body contains the echoed GraphQL query
 *   - P95 < 1500ms
 *
 * Run:
 *   ./bin/run-test.sh --client=examples --scenario=api/10-graphql --profile=smoke
 */

import http from "k6/http";
import { check, group } from "k6";

export const options = {
  vus: 1,
  duration: "20s",
  thresholds: {
    http_req_duration: ["p(95)<1500"],
    http_req_failed: ["rate<0.05"],
  },
};

const BASE_URL = __ENV["GRAPHQL_URL"] ?? "https://httpbin.test.k6.io";

function gqlPost(query: string, variables?: Record<string, unknown>): ReturnType<typeof http.post> {
  return http.post(
    `${BASE_URL}/post`,
    JSON.stringify({ query, variables }),
    { headers: { "Content-Type": "application/json" } },
  );
}

export default function (): void {
  group("GraphQL query", () => {
    const res = gqlPost(`
      query GetUser($id: ID!) {
        user(id: $id) {
          id
          name
          email
        }
      }
    `, { id: "user-1" });

    check(res, {
      "query: status 200": r => r.status === 200,
      "query: body has echoed json": r => {
        try {
          const body = JSON.parse(r.body as string) as Record<string, unknown>;
          const json = body["json"] as Record<string, unknown>;
          return typeof json["query"] === "string";
        } catch { return false; }
      },
      "query: no GraphQL errors": r => {
        try {
          const body = JSON.parse(r.body as string) as Record<string, unknown>;
          const json = body["json"] as Record<string, unknown>;
          return !("errors" in json);
        } catch { return true; }
      },
    });
  });

  group("GraphQL mutation", () => {
    const res = gqlPost(`
      mutation CreateUser($input: CreateUserInput!) {
        createUser(input: $input) {
          id
          name
        }
      }
    `, { input: { name: `User-${__VU}`, email: `user${__VU}@example.com` } });

    check(res, {
      "mutation: status 200": r => r.status === 200,
      "mutation: payload echoed": r => {
        try {
          const body = JSON.parse(r.body as string) as Record<string, unknown>;
          return "json" in body;
        } catch { return false; }
      },
    });
  });
}
