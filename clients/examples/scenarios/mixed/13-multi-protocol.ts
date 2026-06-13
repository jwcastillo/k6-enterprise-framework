/**
 * 13-multi-protocol — Mixed HTTP + GraphQL in same iteration
 *
 * Simulates a realistic app flow that uses multiple protocols:
 *   1. REST: authenticate
 *   2. GraphQL: fetch user profile
 *   3. REST: update last-seen timestamp
 *
 * Demonstrates: multi-protocol in one VU function, group timing
 *
 * Run:
 *   ./bin/run-test.sh --client=examples --scenario=mixed/13-multi-protocol --profile=smoke
 */

import http from "k6/http";
import { check, group, sleep } from "k6";

export const options = {
  vus: 2,
  duration: "30s",
  thresholds: {
    http_req_duration: ["p(95)<2000"],
    http_req_failed: ["rate<0.05"],
  },
};

const BASE_URL = __ENV["BASE_URL"] ?? "https://httpbin.test.k6.io";

export default function (): void {
  // Step 1: REST authentication
  group("REST: authenticate", () => {
    const res = http.post(
      `${BASE_URL}/post`,
      JSON.stringify({ username: `user${__VU}`, password: "test" }),
      { headers: { "Content-Type": "application/json" } },
    );
    check(res, { "auth: 200": r => r.status === 200 });
    sleep(0.1);
  });

  // Step 2: GraphQL profile fetch
  group("GraphQL: user profile", () => {
    const res = http.post(
      `${BASE_URL}/post`,
      JSON.stringify({
        query: `query { user(id: "${__VU}") { id name email } }`,
        variables: {},
      }),
      { headers: { "Content-Type": "application/json" } },
    );
    check(res, {
      "graphql: 200": r => r.status === 200,
      "graphql: has json body": r => {
        try { return "json" in (JSON.parse(r.body as string) as Record<string, unknown>); }
        catch { return false; }
      },
    });
    sleep(0.2);
  });

  // Step 3: REST update
  group("REST: update last-seen", () => {
    const res = http.put(
      `${BASE_URL}/put`,
      JSON.stringify({ userId: __VU, lastSeen: new Date().toISOString() }),
      { headers: { "Content-Type": "application/json" } },
    );
    check(res, { "update: 200": r => r.status === 200 });
  });
}
