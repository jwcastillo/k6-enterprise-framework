// Fixture: options re-exported from a shared module.
import http from "k6/http";
import { check } from "k6";

export { options } from "../../lib/good-options";

export default function (): void {
  const res = http.get(`${__ENV.BASE_URL}/health`, { tags: { name: "health" } });
  check(res, { "status 200": (r) => r.status === 200 });
}
