// Fixture: init code opens a data file whose path comes from __ENV (needs --k6-env).
import http from "k6/http";
import { Options } from "k6/options";

const rows = open(__ENV.GATE_DATA_FILE).split("\n");

export const options: Options = {
  vus: 1,
  iterations: 1,
  systemTags: ["status", "name"],
  thresholds: { http_req_failed: ["rate<0.01"] },
};

export default function (): void {
  http.get(`${__ENV.BASE_URL}/items/${rows[0]}`);
}
