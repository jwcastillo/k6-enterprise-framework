/**
 * Target guard — refuses to fire load at a target the config does not allow.
 *
 * Ported from a previous internal framework (core/Runner.ts :: checkTarget), adapted to the
 * endpoints/services config shape used here.
 */

import { describe, it, expect } from "vitest";

const { checkTarget, collectBaseUrls } = require("../../bin/target-guard.js");

const endpoints = (baseUrl: string) => ({ endpoints: { api: { baseUrl } } });

describe("collectBaseUrls", () => {
  it("collects top-level, endpoints and services baseUrls", () => {
    const found = collectBaseUrls({
      baseUrl: "https://root.example.com",
      endpoints: { api: { baseUrl: "https://api.example.com" } },
      services: { auth: { baseUrl: "https://auth.example.com" }, noUrl: { timeout: 10 } },
    });
    expect(found.map((f: { name: string }) => f.name)).toEqual([
      "baseUrl",
      "endpoints.api",
      "services.auth",
    ]);
  });
});

describe("checkTarget", () => {
  it("allows a plain staging target", () => {
    expect(checkTarget(endpoints("https://api.staging.example.com"), "staging", "load", false)).toEqual([]);
  });

  it("refuses embedded credentials without leaking the baseUrl", () => {
    const errors = checkTarget(endpoints("https://user:s3cret@api.example.com"), "staging", "load", false);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("api.example.com");
    expect(errors[0]).not.toContain("s3cret");
  });

  it("refuses a host outside allowedHosts", () => {
    const config = { ...endpoints("https://evil.example.com"), allowedHosts: ["api.staging.example.com"] };
    expect(checkTarget(config, "staging", "load", false)[0]).toContain("not in allowedHosts");
  });

  it("accepts a host in allowedHosts, case-insensitively", () => {
    const config = { ...endpoints("https://API.Staging.Example.com"), allowedHosts: ["api.staging.example.com"] };
    expect(checkTarget(config, "staging", "load", false)).toEqual([]);
  });

  it("refuses an invalid baseUrl when allowedHosts is set", () => {
    const config = { ...endpoints("not-a-url"), allowedHosts: ["api.example.com"] };
    expect(checkTarget(config, "staging", "load", false)[0]).toContain("not a valid URL");
  });

  it("refuses a non-light profile against production", () => {
    const errors = checkTarget(endpoints("https://api.example.com"), "production", "stress", false);
    expect(errors[0]).toContain("K6_ALLOW_PROD_LOAD");
  });

  it("allows smoke and quick against production", () => {
    for (const profile of ["smoke", "quick"]) {
      expect(checkTarget(endpoints("https://api.example.com"), "production", profile, false)).toEqual([]);
    }
  });

  it("refuses production with no profile at all", () => {
    expect(checkTarget(endpoints("https://api.example.com"), "prod", undefined, false)).toHaveLength(1);
  });

  it("allows production load when K6_ALLOW_PROD_LOAD is set", () => {
    expect(checkTarget(endpoints("https://api.example.com"), "production", "stress", true)).toEqual([]);
  });

  it("refuses when allowedHosts is set but no baseUrl is declared", () => {
    expect(checkTarget({ allowedHosts: ["api.example.com"] }, "staging", "load", false)[0]).toContain(
      "no baseUrl"
    );
  });
});
