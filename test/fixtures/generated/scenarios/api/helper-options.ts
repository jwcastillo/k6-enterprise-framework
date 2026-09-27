// Fixture: options assigned from a helper identifier.
import http from "k6/http";
import { heavyOptions } from "../../lib/heavy-options";

export const options = heavyOptions;

export default function (): void {
  http.get(`${__ENV.BASE_URL}/health`);
}
