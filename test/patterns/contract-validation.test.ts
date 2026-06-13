import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ContractValidator,
  defaultValidator,
} from "../../src/patterns/contract-validation";

describe("contract-validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── ContractValidator ──────────────────────────────────────────────────

  describe("ContractValidator", () => {
    let validator: ContractValidator;

    beforeEach(() => {
      validator = new ContractValidator();
    });

    describe("registerSchema", () => {
      it("registers a valid JSON schema", () => {
        expect(() =>
          validator.registerSchema("user", {
            type: "object",
            properties: {
              id: { type: "number" },
              name: { type: "string" },
            },
            required: ["id", "name"],
          })
        ).not.toThrow();

        expect(validator.listSchemas()).toContain("user");
      });

      it("overwrites existing schema with same name (with warning)", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        validator.registerSchema("user", {
          type: "object",
          properties: { id: { type: "number" } },
        });

        validator.registerSchema("user", {
          type: "object",
          properties: { id: { type: "string" } },
        });

        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("already registered, overwriting")
        );

        // New schema should be active
        const result = validator.validate("user", { id: "string-id" });
        expect(result.valid).toBe(true);
      });

      it("throws on invalid schema", () => {
        expect(() =>
          validator.registerSchema("broken", {
            type: "not-a-valid-type" as unknown as string,
          })
        ).toThrow("ContractValidator: failed to compile schema 'broken'");
      });
    });

    describe("validate", () => {
      beforeEach(() => {
        validator.registerSchema("user", {
          type: "object",
          properties: {
            id: { type: "number" },
            name: { type: "string" },
            email: { type: "string", format: "email" },
          },
          required: ["id", "name"],
          additionalProperties: false,
        });
      });

      it("returns valid=true for conforming data", () => {
        const result = validator.validate("user", {
          id: 1,
          name: "Alice",
          email: "alice@example.com",
        });

        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
        expect(result.schemaId).toBe("user");
      });

      it("returns valid=false with errors for non-conforming data", () => {
        const result = validator.validate("user", {
          id: "not-a-number",
          name: 42,
        });

        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.schemaId).toBe("user");
      });

      it("reports missing required fields", () => {
        const result = validator.validate("user", { id: 1 });

        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.message?.includes("required"))).toBe(true);
      });

      it("reports additional properties violation", () => {
        const result = validator.validate("user", {
          id: 1,
          name: "Alice",
          extraField: "not allowed",
        });

        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.message?.includes("additional"))).toBe(true);
      });

      it("validates format (email)", () => {
        const result = validator.validate("user", {
          id: 1,
          name: "Alice",
          email: "not-an-email",
        });

        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.message?.includes("format"))).toBe(true);
      });

      it("throws for unregistered schema name", () => {
        expect(() => validator.validate("nonexistent", {})).toThrow(
          "ContractValidator: schema 'nonexistent' not registered"
        );
      });

      it("errors include path and message", () => {
        const result = validator.validate("user", { id: "wrong", name: 123 });

        for (const error of result.errors) {
          expect(error).toHaveProperty("path");
          expect(error).toHaveProperty("message");
        }
      });
    });

    describe("assertValid", () => {
      beforeEach(() => {
        validator.registerSchema("item", {
          type: "object",
          properties: {
            sku: { type: "string" },
            price: { type: "number", minimum: 0 },
          },
          required: ["sku", "price"],
        });
      });

      it("does not throw for valid data", () => {
        expect(() =>
          validator.assertValid("item", { sku: "ABC-001", price: 9.99 })
        ).not.toThrow();
      });

      it("throws for invalid data with error details", () => {
        expect(() =>
          validator.assertValid("item", { sku: "ABC-001", price: -5 })
        ).toThrow("ContractValidator: 'item' contract violated");
      });

      it("throws for missing required fields", () => {
        expect(() => validator.assertValid("item", { sku: "ABC" })).toThrow(
          "contract violated"
        );
      });

      it("includes error paths in exception message", () => {
        try {
          validator.assertValid("item", { sku: 123, price: "wrong" });
          expect.unreachable("Should have thrown");
        } catch (e) {
          const msg = (e as Error).message;
          expect(msg).toContain("item");
        }
      });
    });

    describe("listSchemas", () => {
      it("returns empty array initially", () => {
        expect(validator.listSchemas()).toEqual([]);
      });

      it("returns registered schema names", () => {
        validator.registerSchema("a", { type: "object" });
        validator.registerSchema("b", { type: "string" });

        const schemas = validator.listSchemas();
        expect(schemas).toContain("a");
        expect(schemas).toContain("b");
        expect(schemas.length).toBe(2);
      });
    });
  });

  // ── defaultValidator singleton ────────────────────────────────────────

  describe("defaultValidator", () => {
    it("is an instance of ContractValidator", () => {
      expect(defaultValidator).toBeInstanceOf(ContractValidator);
    });

    it("can register and validate schemas", () => {
      defaultValidator.registerSchema("test-singleton", {
        type: "object",
        properties: { ok: { type: "boolean" } },
      });

      const result = defaultValidator.validate("test-singleton", { ok: true });
      expect(result.valid).toBe(true);
    });
  });

  // ── Complex schema scenarios ──────────────────────────────────────────

  describe("complex schemas", () => {
    it("validates nested objects", () => {
      const validator = new ContractValidator();
      validator.registerSchema("order", {
        type: "object",
        properties: {
          id: { type: "string" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                sku: { type: "string" },
                quantity: { type: "integer", minimum: 1 },
              },
              required: ["sku", "quantity"],
            },
          },
        },
        required: ["id", "items"],
      });

      const valid = validator.validate("order", {
        id: "ORD-001",
        items: [
          { sku: "ITEM-A", quantity: 2 },
          { sku: "ITEM-B", quantity: 1 },
        ],
      });
      expect(valid.valid).toBe(true);

      const invalid = validator.validate("order", {
        id: "ORD-002",
        items: [{ sku: "ITEM-C", quantity: 0 }],
      });
      expect(invalid.valid).toBe(false);
    });

    it("validates enum values", () => {
      const validator = new ContractValidator();
      validator.registerSchema("status", {
        type: "object",
        properties: {
          status: { type: "string", enum: ["active", "inactive", "pending"] },
        },
        required: ["status"],
      });

      expect(validator.validate("status", { status: "active" }).valid).toBe(true);
      expect(validator.validate("status", { status: "unknown" }).valid).toBe(false);
    });
  });
});
