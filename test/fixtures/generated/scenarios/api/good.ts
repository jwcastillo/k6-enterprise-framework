// Fixture: a scenario the generation gate must accept.
import http from "k6/http";
import { check } from "k6";
import { Options } from "k6/options";

export const options: Options = {
  vus: 10,
  duration: "30s",
  systemTags: ["status", "method", "name", "scenario"],
  thresholds: { http_req_failed: ["rate<0.01"], http_req_duration: ["p(95)<500"] },
};

const BASE = __ENV.BASE_URL || "https://api.shop.test";

export default function (): void {
  const res = http.get(`${BASE}/health`, { tags: { name: "health" } });
  check(res, { "status 200": (r) => r.status === 200 });
}
