/** T-015: Patron de autenticacion reutilizable */

import { RequestHelper, RequestOptions } from "../helpers/request-helper";
import { StructuredLogger } from "../helpers/structured-logger";

const logger = new StructuredLogger({ pattern: "auth" });

export type AuthPatternType = "bearer" | "basic" | "oauth2" | "apikey";

export interface BearerAuthConfig {
  type: "bearer";
  loginUrl: string;
  username: string;
  password: string;
  tokenPath?: string; // JSON path to extract token, default "access_token"
  baseUrl: string;
}

export interface BasicAuthConfig {
  type: "basic";
  username: string;
  password: string;
  baseUrl: string;
}

export interface OAuth2Config {
  type: "oauth2";
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  baseUrl: string;
}

export interface ApiKeyConfig {
  type: "apikey";
  apiKey: string;
  header?: string; // default "X-API-Key"
  baseUrl: string;
}

export type AuthConfig = BearerAuthConfig | BasicAuthConfig | OAuth2Config | ApiKeyConfig;

export interface AuthSession {
  type: AuthPatternType;
  token?: string;
  credentials: Record<string, string>;
  expiresAt?: number;
  client: RequestHelper;
}

/** Execute Bearer auth flow: login -> extract token -> return session */
function bearerLogin(config: BearerAuthConfig): AuthSession {
  const client = new RequestHelper(config.baseUrl);
  const res = client.post(config.loginUrl, {
    username: config.username,
    password: config.password,
  });

  if (res.status !== 200 && res.status !== 201) {
    throw new Error(
      `AuthPattern[bearer]: login failed — expected 200/201, got ${res.status}. URL: ${config.loginUrl}`
    );
  }

  const tokenPath = config.tokenPath ?? "access_token";
  const token = res.json<string>(tokenPath);
  if (!token || typeof token !== "string") {
    throw new Error(
      `AuthPattern[bearer]: token not found at path '${tokenPath}' in response`
    );
  }

  logger.logEvent("auth.bearer.success", { loginUrl: config.loginUrl });

  const session: AuthSession = {
    type: "bearer",
    token,
    credentials: { token },
    client: new RequestHelper(config.baseUrl, {
      authType: "bearer",
      credentials: { token },
    }),
  };
  return session;
}

/** Basic auth — no login request, credentials embedded in every request */
function basicAuth(config: BasicAuthConfig): AuthSession {
  const credentials = { username: config.username, password: config.password };
  return {
    type: "basic",
    credentials,
    client: new RequestHelper(config.baseUrl, {
      authType: "basic",
      credentials,
    }),
  };
}

/** OAuth2 client credentials flow */
function oauth2Login(config: OAuth2Config): AuthSession {
  const client = new RequestHelper(config.tokenUrl);
  const body = [
    `grant_type=client_credentials`,
    `client_id=${encodeURIComponent(config.clientId)}`,
    `client_secret=${encodeURIComponent(config.clientSecret)}`,
    config.scope ? `scope=${encodeURIComponent(config.scope)}` : "",
  ]
    .filter(Boolean)
    .join("&");

  const res = client.post("", body, {
    extraHeaders: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  if (res.status !== 200) {
    throw new Error(
      `AuthPattern[oauth2]: token request failed — expected 200, got ${res.status}. URL: ${config.tokenUrl}`
    );
  }

  const accessToken = res.json<string>("access_token");
  const expiresIn = res.json<number>("expires_in") ?? 3600;

  if (!accessToken) {
    throw new Error("AuthPattern[oauth2]: access_token not found in response");
  }

  logger.logEvent("auth.oauth2.success", { tokenUrl: config.tokenUrl });

  return {
    type: "oauth2",
    token: accessToken,
    credentials: { accessToken },
    expiresAt: Date.now() + expiresIn * 1000,
    client: new RequestHelper(config.baseUrl, {
      authType: "oauth2",
      credentials: { accessToken },
    }),
  };
}

/** API Key auth — key injected as header on every request */
function apiKeyAuth(config: ApiKeyConfig): AuthSession {
  const header = config.header ?? "X-API-Key";
  return {
    type: "apikey",
    credentials: { key: config.apiKey, header },
    client: new RequestHelper(config.baseUrl, {
      authType: "apikey",
      credentials: { key: config.apiKey, header },
    }),
  };
}

/** Unified auth factory — returns a ready-to-use AuthSession */
export function authenticate(config: AuthConfig): AuthSession {
  switch (config.type) {
    case "bearer":
      return bearerLogin(config);
    case "basic":
      return basicAuth(config);
    case "oauth2":
      return oauth2Login(config);
    case "apikey":
      return apiKeyAuth(config);
    default:
      throw new Error(`AuthPattern: unsupported auth type '${(config as AuthConfig).type}'`);
  }
}

/** Check if a session token is still valid (has not expired) */
export function isSessionValid(session: AuthSession): boolean {
  if (!session.expiresAt) return true;
  return Date.now() < session.expiresAt - 30_000; // 30s buffer
}

/** Get options for using a session's RequestHelper */
export function sessionRequestOptions(session: AuthSession): RequestOptions {
  return {
    authType: session.type,
    credentials: session.credentials,
  };
}
