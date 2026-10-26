// Fixture: options from the framework's buildOptions() (profile thresholds + overrides, resolved at run time).
import http from "k6/http";
import { buildOptions } from "@core/config-loader";

export const options = buildOptions({ checks: ["rate>=0.99"] });

export default function (): void {
  http.get(`${__ENV.BASE_URL}/health`);
}
