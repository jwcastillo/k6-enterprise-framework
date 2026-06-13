/**
 * 11-file-upload — File upload testing with multipart/form-data
 *
 * Demonstrates: binary data upload, multipart forms, FormData helper
 *
 * Expected results:
 *   - Upload returns 200
 *   - Response includes file field
 *   - P95 < 3000ms (uploads are slower)
 *
 * Run:
 *   ./bin/run-test.sh --client=examples --scenario=api/11-file-upload --profile=smoke
 */

import http from "k6/http";
import { check, group } from "k6";

export const options = {
  vus: 1,
  duration: "20s",
  thresholds: {
    http_req_duration: ["p(95)<3000"],
    http_req_failed: ["rate<0.05"],
  },
};

const BASE_URL = __ENV["BASE_URL"] ?? "https://httpbin.test.k6.io";

export default function (): void {
  group("Multipart file upload", () => {
    // Simulate a small CSV file
    const csvContent = `id,name,email\n1,Alice,alice@example.com\n2,Bob,bob@example.com`;
    const file = http.file(csvContent, "users.csv", "text/csv");

    const res = http.post(`${BASE_URL}/post`, {
      file,
      description: "Test upload from k6",
      timestamp: new Date().toISOString(),
    });

    check(res, {
      "upload: status 200": r => r.status === 200,
      "upload: files received": r => {
        try {
          const body = JSON.parse(r.body as string) as Record<string, unknown>;
          return "files" in body;
        } catch { return false; }
      },
      "upload: form data received": r => {
        try {
          const body = JSON.parse(r.body as string) as Record<string, unknown>;
          return "form" in body;
        } catch { return false; }
      },
    });
  });

  group("JSON body upload", () => {
    const payload = { data: Array.from({ length: 50 }, (_, i) => ({ id: i, value: `item-${i}` })) };
    const res = http.post(`${BASE_URL}/post`, JSON.stringify(payload), {
      headers: { "Content-Type": "application/json" },
    });
    check(res, {
      "json upload: status 200": r => r.status === 200,
      "json upload: payload echoed": r => {
        try { return "json" in (JSON.parse(r.body as string) as Record<string, unknown>); }
        catch { return false; }
      },
    });
  });
}
