// Fixture: options built in a shared module (the scenario only re-exports them).
import type { Options } from "k6/options";

export const options: Options = {
  vus: 5,
  duration: "30s",
  systemTags: ["status", "method", "name", "scenario"],
  thresholds: { http_req_failed: ["rate<0.01"], http_req_duration: ["p(95)<500"] },
};
