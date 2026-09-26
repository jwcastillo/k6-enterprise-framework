// Fixture: a scenario outside the five canonical buckets.
import http from "k6/http";

export const options = { thresholds: { http_req_failed: ["rate<0.01"] }, systemTags: ["status"] };

export default function (): void {
  http.get(__ENV.BASE_URL);
}
