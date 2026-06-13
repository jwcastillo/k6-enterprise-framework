/**
 * UserService — Reference service object demonstrating API encapsulation.
 *
 * Pattern demonstrated:
 * - Service object encapsulates API calls (no raw http.get in scenarios)
 * - Token is scoped to VU/iteration context (not a global variable)
 * - Uses RequestHelper + auth-pattern for clean, reusable auth
 */

import { RequestHelper } from "../../../../src/helpers/request-helper";
import { authenticate, AuthSession } from "../../../../src/patterns/auth-pattern";
import { runChecks, statusCheck, schemaCheck, thresholdCheck } from "../../../../src/core/check-system";

export interface User {
  id: string;
  username: string;
  email: string;
  role: string;
}

export interface UserServiceConfig {
  baseUrl: string;
  /** Token for this VU — never stored as global, always passed per-session */
  session?: AuthSession;
}

export class UserService {
  private readonly client: RequestHelper;

  constructor(config: UserServiceConfig) {
    if (config.session) {
      this.client = config.session.client;
    } else {
      this.client = new RequestHelper(config.baseUrl);
    }
  }

  /** Demonstrate bearer auth flow + correlation (extract response field) */
  static login(baseUrl: string, username: string): AuthSession {
    // In reference client, we use httpbin.org's /post endpoint to simulate auth
    // Real clients would point to their actual auth endpoint
    return authenticate({
      type: "bearer",
      loginUrl: "/post",
      username,
      password: "use-secrets-manager-in-real-clients",
      tokenPath: "json",  // httpbin returns posted body under "json" key
      baseUrl,
    });
  }

  /** GET /get — demonstrates checks + threshold pattern */
  getInfo(): { success: boolean; origin: string | null } {
    const res = this.client.get("/get");

    const passed = runChecks(res, [
      statusCheck(200),
      schemaCheck(["origin", "headers"]),
      thresholdCheck(2000),
    ]);

    return {
      success: passed,
      origin: res.json<string>("origin"),
    };
  }

  /** POST /post — demonstrates correlation pattern */
  createUser(data: Partial<User>): { success: boolean; echoed: unknown } {
    const res = this.client.post("/post", data);

    const passed = runChecks(res, [
      statusCheck(200),
      schemaCheck(["json", "url"]),
      thresholdCheck(2000),
    ]);

    return {
      success: passed,
      echoed: res.json<unknown>("json"),
    };
  }
}
