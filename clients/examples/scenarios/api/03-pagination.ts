/**
 * 03-pagination — Automatic pagination through a collection
 *
 * Demonstrates: PaginationPattern, correlation between pages
 *
 * Expected results:
 *   - All pages return 200
 *   - Each page has different offset
 *   - P95 < 1500ms
 *
 * Run:
 *   ./bin/run-test.sh --client=examples --scenario=api/03-pagination --profile=smoke
 */

import http from "k6/http";
import { check, group, sleep } from "k6";

export const options = {
  vus: 1,
  duration: "30s",
  thresholds: {
    http_req_duration: ["p(95)<1500"],
    http_req_failed: ["rate<0.05"],
  },
};

const BASE_URL  = __ENV["BASE_URL"] ?? "https://httpbin.test.k6.io";
const PAGE_SIZE = 5;
const MAX_PAGES = 3;

export default function (): void {
  group("Paginated collection traversal", () => {
    for (let page = 0; page < MAX_PAGES; page++) {
      const offset = page * PAGE_SIZE;

      const res = http.get(`${BASE_URL}/anything?page=${page}&offset=${offset}&limit=${PAGE_SIZE}`);

      check(res, {
        [`page ${page}: status 200`]: r => r.status === 200,
        [`page ${page}: has args`]: r => {
          try {
            const body = JSON.parse(r.body as string) as Record<string, unknown>;
            const args = body["args"] as Record<string, string>;
            return args["offset"] === String(offset);
          } catch { return false; }
        },
      });

      sleep(0.1);
    }
  });
}
