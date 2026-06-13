import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  validateCustomProfile,
  MAX_CUSTOM_VUS_DEVELOPER,
  MAX_CUSTOM_VUS_LEAD,
} from "../../src/core/profile-validator";

describe("ProfileValidator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Constants ─────────────────────────────────────────────────────────────

  describe("constants", () => {
    it("should export MAX_CUSTOM_VUS_DEVELOPER as 50", () => {
      expect(MAX_CUSTOM_VUS_DEVELOPER).toBe(50);
    });

    it("should export MAX_CUSTOM_VUS_LEAD as 500", () => {
      expect(MAX_CUSTOM_VUS_LEAD).toBe(500);
    });
  });

  // ── validateCustomProfile: basic validation ───────────────────────────────

  describe("validateCustomProfile - basic validation", () => {
    it("should reject null input", () => {
      expect(() => validateCustomProfile(null)).toThrow(
        "[profile-validator] Profile must be a JSON object"
      );
    });

    it("should reject undefined input", () => {
      expect(() => validateCustomProfile(undefined)).toThrow(
        "[profile-validator] Profile must be a JSON object"
      );
    });

    it("should reject array input", () => {
      expect(() => validateCustomProfile([])).toThrow(
        "[profile-validator] Profile must be a JSON object"
      );
    });

    it("should reject non-object input", () => {
      expect(() => validateCustomProfile("string")).toThrow(
        "[profile-validator] Profile must be a JSON object"
      );
    });

    it("should reject numeric input", () => {
      expect(() => validateCustomProfile(42)).toThrow(
        "[profile-validator] Profile must be a JSON object"
      );
    });
  });

  // ── validateCustomProfile: required fields ────────────────────────────────

  describe("validateCustomProfile - required fields", () => {
    it("should reject missing name", () => {
      expect(() =>
        validateCustomProfile({
          stages: [{ duration: "30s", target: 1 }],
        })
      ).toThrow("[profile-validator] Field 'name' is required");
    });

    it("should reject empty name", () => {
      expect(() =>
        validateCustomProfile({
          name: "",
          stages: [{ duration: "30s", target: 1 }],
        })
      ).toThrow("[profile-validator] Field 'name' is required");
    });

    it("should reject whitespace-only name", () => {
      expect(() =>
        validateCustomProfile({
          name: "   ",
          stages: [{ duration: "30s", target: 1 }],
        })
      ).toThrow("[profile-validator] Field 'name' is required");
    });

    it("should reject non-string name", () => {
      expect(() =>
        validateCustomProfile({
          name: 123,
          stages: [{ duration: "30s", target: 1 }],
        })
      ).toThrow("[profile-validator] Field 'name' is required");
    });

    it("should reject missing stages", () => {
      expect(() =>
        validateCustomProfile({
          name: "test-profile",
        })
      ).toThrow("[profile-validator] Field 'stages' is required");
    });

    it("should reject empty stages array", () => {
      expect(() =>
        validateCustomProfile({
          name: "test-profile",
          stages: [],
        })
      ).toThrow("[profile-validator] Field 'stages' is required");
    });

    it("should reject non-array stages", () => {
      expect(() =>
        validateCustomProfile({
          name: "test-profile",
          stages: "not-an-array",
        })
      ).toThrow("[profile-validator] Field 'stages' is required");
    });

    it("should reject non-string description", () => {
      expect(() =>
        validateCustomProfile({
          name: "test-profile",
          description: 123,
          stages: [{ duration: "30s", target: 1 }],
        })
      ).toThrow("[profile-validator] Field 'description' must be a string");
    });

    it("should accept undefined description", () => {
      const result = validateCustomProfile({
        name: "test-profile",
        stages: [{ duration: "30s", target: 1 }],
      });
      expect(result.description).toBeUndefined();
    });

    it("should accept string description", () => {
      const result = validateCustomProfile({
        name: "test-profile",
        description: "A test profile",
        stages: [{ duration: "30s", target: 1 }],
      });
      expect(result.description).toBe("A test profile");
    });
  });

  // ── validateCustomProfile: forbidden fields ───────────────────────────────

  describe("validateCustomProfile - forbidden fields", () => {
    const validBase = {
      name: "test-profile",
      stages: [{ duration: "30s", target: 1 }],
    };

    const forbiddenFields = [
      "executor",
      "gracefulStop",
      "gracefulRampDown",
      "env",
      "systemTags",
      "tags",
      "exec",
      "startTime",
      "maxDuration",
      "noConnectionReuse",
      "userAgent",
      "discardResponseBodies",
      "disableSecretMasking",
      "disableRbac",
      "disableAudit",
      "skipValidation",
    ];

    for (const field of forbiddenFields) {
      it(`should reject forbidden field '${field}'`, () => {
        const profile = { ...validBase, [field]: "any-value" };
        expect(() => validateCustomProfile(profile)).toThrow(
          `[profile-validator] Field '${field}' is not allowed in custom profiles`
        );
      });
    }
  });

  // ── validateCustomProfile: stage validation ───────────────────────────────

  describe("validateCustomProfile - stage validation", () => {
    it("should accept valid stages", () => {
      const result = validateCustomProfile({
        name: "test-profile",
        stages: [
          { duration: "30s", target: 5 },
          { duration: "5m", target: 10 },
          { duration: "1m", target: 0 },
        ],
      });
      expect(result.stages).toHaveLength(3);
    });

    it("should reject non-object stage", () => {
      expect(() =>
        validateCustomProfile({
          name: "test-profile",
          stages: ["not-an-object"],
        })
      ).toThrow("[profile-validator] stages[0] must be an object");
    });

    it("should reject null stage", () => {
      expect(() =>
        validateCustomProfile({
          name: "test-profile",
          stages: [null],
        })
      ).toThrow("[profile-validator] stages[0] must be an object");
    });

    it("should reject array stage", () => {
      expect(() =>
        validateCustomProfile({
          name: "test-profile",
          stages: [[1, 2]],
        })
      ).toThrow("[profile-validator] stages[0] must be an object");
    });

    it("should reject non-string duration", () => {
      expect(() =>
        validateCustomProfile({
          name: "test-profile",
          stages: [{ duration: 30, target: 1 }],
        })
      ).toThrow("[profile-validator] stages[0].duration must be a string");
    });

    it("should reject invalid duration format", () => {
      expect(() =>
        validateCustomProfile({
          name: "test-profile",
          stages: [{ duration: "thirty-seconds", target: 1 }],
        })
      ).toThrow("[profile-validator] stages[0].duration");
    });

    it("should accept duration with ms unit", () => {
      const result = validateCustomProfile({
        name: "test-profile",
        stages: [{ duration: "500ms", target: 1 }],
      });
      expect(result.stages[0].duration).toBe("500ms");
    });

    it("should accept duration with s unit", () => {
      const result = validateCustomProfile({
        name: "test-profile",
        stages: [{ duration: "30s", target: 1 }],
      });
      expect(result.stages[0].duration).toBe("30s");
    });

    it("should accept duration with m unit", () => {
      const result = validateCustomProfile({
        name: "test-profile",
        stages: [{ duration: "5m", target: 1 }],
      });
      expect(result.stages[0].duration).toBe("5m");
    });

    it("should accept duration with h unit", () => {
      const result = validateCustomProfile({
        name: "test-profile",
        stages: [{ duration: "1h", target: 1 }],
      });
      expect(result.stages[0].duration).toBe("1h");
    });

    it("should reject non-integer target", () => {
      expect(() =>
        validateCustomProfile({
          name: "test-profile",
          stages: [{ duration: "30s", target: 1.5 }],
        })
      ).toThrow("[profile-validator] stages[0].target must be a non-negative integer");
    });

    it("should reject negative target", () => {
      expect(() =>
        validateCustomProfile({
          name: "test-profile",
          stages: [{ duration: "30s", target: -1 }],
        })
      ).toThrow("[profile-validator] stages[0].target must be a non-negative integer");
    });

    it("should reject non-number target", () => {
      expect(() =>
        validateCustomProfile({
          name: "test-profile",
          stages: [{ duration: "30s", target: "five" }],
        })
      ).toThrow("[profile-validator] stages[0].target must be a non-negative integer");
    });

    it("should accept zero target", () => {
      const result = validateCustomProfile({
        name: "test-profile",
        stages: [{ duration: "30s", target: 0 }],
      });
      expect(result.stages[0].target).toBe(0);
    });

    it("should reject target exceeding developer VU limit (default)", () => {
      expect(() =>
        validateCustomProfile({
          name: "test-profile",
          stages: [{ duration: "30s", target: 51 }],
        })
      ).toThrow("exceeds the maximum allowed for your role (50 VUs)");
    });

    it("should accept target within developer VU limit", () => {
      const result = validateCustomProfile({
        name: "test-profile",
        stages: [{ duration: "30s", target: 50 }],
      });
      expect(result.stages[0].target).toBe(50);
    });

    it("should accept higher target when lead VU limit is specified", () => {
      const result = validateCustomProfile(
        {
          name: "test-profile",
          stages: [{ duration: "30s", target: 200 }],
        },
        MAX_CUSTOM_VUS_LEAD
      );
      expect(result.stages[0].target).toBe(200);
    });

    it("should reject target exceeding lead VU limit", () => {
      expect(() =>
        validateCustomProfile(
          {
            name: "test-profile",
            stages: [{ duration: "30s", target: 501 }],
          },
          MAX_CUSTOM_VUS_LEAD
        )
      ).toThrow("exceeds the maximum allowed for your role (500 VUs)");
    });

    it("should reject unexpected fields in stage", () => {
      expect(() =>
        validateCustomProfile({
          name: "test-profile",
          stages: [{ duration: "30s", target: 1, extra: "field" }],
        })
      ).toThrow("[profile-validator] stages[0]: unexpected field 'extra'");
    });
  });

  // ── validateCustomProfile: total duration ─────────────────────────────────

  describe("validateCustomProfile - total duration", () => {
    it("should accept profiles under 4 hours", () => {
      const result = validateCustomProfile({
        name: "test-profile",
        stages: [
          { duration: "1h", target: 5 },
          { duration: "2h", target: 10 },
          { duration: "30m", target: 0 },
        ],
      });
      expect(result.name).toBe("test-profile");
    });

    it("should accept profiles exactly at 4 hours", () => {
      const result = validateCustomProfile({
        name: "test-profile",
        stages: [
          { duration: "2h", target: 5 },
          { duration: "2h", target: 0 },
        ],
      });
      expect(result.name).toBe("test-profile");
    });

    it("should reject profiles exceeding 4 hours", () => {
      expect(() =>
        validateCustomProfile({
          name: "test-profile",
          stages: [
            { duration: "3h", target: 5 },
            { duration: "2h", target: 0 },
          ],
        })
      ).toThrow("exceeds the maximum allowed (240 min = 4 hours)");
    });
  });

  // ── validateCustomProfile: threshold validation ───────────────────────────

  describe("validateCustomProfile - threshold validation", () => {
    it("should accept valid thresholds", () => {
      const result = validateCustomProfile({
        name: "test-profile",
        stages: [{ duration: "30s", target: 1 }],
        thresholds: {
          http_req_duration: ["p(95)<2000", "p(99)<5000"],
          http_req_failed: ["rate<0.01"],
        },
      });
      expect(result.thresholds).toBeDefined();
      expect(result.thresholds!.http_req_duration).toHaveLength(2);
    });

    it("should accept profile without thresholds", () => {
      const result = validateCustomProfile({
        name: "test-profile",
        stages: [{ duration: "30s", target: 1 }],
      });
      expect(result.thresholds).toBeUndefined();
    });

    it("should reject non-object thresholds", () => {
      expect(() =>
        validateCustomProfile({
          name: "test-profile",
          stages: [{ duration: "30s", target: 1 }],
          thresholds: "not-an-object",
        })
      ).toThrow("[profile-validator] Field 'thresholds' must be an object");
    });

    it("should reject null thresholds", () => {
      expect(() =>
        validateCustomProfile({
          name: "test-profile",
          stages: [{ duration: "30s", target: 1 }],
          thresholds: null,
        })
      ).toThrow("[profile-validator] Field 'thresholds' must be an object");
    });

    it("should reject array thresholds", () => {
      expect(() =>
        validateCustomProfile({
          name: "test-profile",
          stages: [{ duration: "30s", target: 1 }],
          thresholds: [],
        })
      ).toThrow("[profile-validator] Field 'thresholds' must be an object");
    });

    it("should reject non-array threshold conditions", () => {
      expect(() =>
        validateCustomProfile({
          name: "test-profile",
          stages: [{ duration: "30s", target: 1 }],
          thresholds: {
            http_req_duration: "p(95)<2000",
          },
        })
      ).toThrow(
        "[profile-validator] thresholds.http_req_duration must be an array"
      );
    });

    it("should reject invalid threshold condition format", () => {
      expect(() =>
        validateCustomProfile({
          name: "test-profile",
          stages: [{ duration: "30s", target: 1 }],
          thresholds: {
            http_req_duration: ["invalid condition!"],
          },
        })
      ).toThrow("invalid threshold condition 'invalid condition!'");
    });

    it("should accept valid threshold conditions", () => {
      const conditions = [
        "p(95)<2000",
        "p(99)<5000",
        "rate<0.01",
        "count>100",
        "value<=500",
        "avg>=10",
      ];

      for (const cond of conditions) {
        const result = validateCustomProfile({
          name: "test-profile",
          stages: [{ duration: "30s", target: 1 }],
          thresholds: { test_metric: [cond] },
        });
        expect(result.thresholds!.test_metric).toContain(cond);
      }
    });
  });

  // ── validateCustomProfile: valid profile ──────────────────────────────────

  describe("validateCustomProfile - valid profile", () => {
    it("should return a properly typed CustomProfileDefinition", () => {
      const result = validateCustomProfile({
        name: "  my-profile  ",
        description: "A test profile",
        stages: [
          { duration: "30s", target: 5 },
          { duration: "5m", target: 10 },
          { duration: "1m", target: 0 },
        ],
        thresholds: {
          http_req_duration: ["p(95)<2000"],
        },
      });

      expect(result.name).toBe("my-profile"); // trimmed
      expect(result.description).toBe("A test profile");
      expect(result.stages).toHaveLength(3);
      expect(result.thresholds!.http_req_duration).toEqual(["p(95)<2000"]);
    });
  });
});
