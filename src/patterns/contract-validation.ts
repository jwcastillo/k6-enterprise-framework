/** T-020: Validacion de contratos — JSON Schema / OpenAPI contract checks */

import Ajv, { ValidateFunction, ErrorObject } from "ajv";
import addFormats from "ajv-formats";

// Single shared Ajv instance (compiled at init time, not per-VU iteration)
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

export interface ContractValidationResult {
  valid: boolean;
  errors: ContractError[];
  schemaId: string;
}

export interface ContractError {
  path: string;
  message: string;
  value?: unknown;
}

function mapErrors(errors: ErrorObject[] | null | undefined): ContractError[] {
  if (!errors) return [];
  return errors.map((e) => ({
    path: e.instancePath || "/",
    message: e.message ?? "unknown error",
    value: e.data,
  }));
}

export class ContractValidator {
  private readonly validators = new Map<string, ValidateFunction>();

  /**
   * Register a JSON Schema for a named contract.
   * Call once at init time (outside VU functions) to compile the schema.
   */
  registerSchema(name: string, schema: Record<string, unknown>): void {
    if (this.validators.has(name)) {
      console.warn(`ContractValidator: schema '${name}' already registered, overwriting`);
    }
    try {
      const validate = ajv.compile(schema);
      this.validators.set(name, validate);
    } catch (err) {
      throw new Error(
        `ContractValidator: failed to compile schema '${name}': ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * Validate a response body against a registered schema.
   */
  validate(schemaName: string, data: unknown): ContractValidationResult {
    const validate = this.validators.get(schemaName);
    if (!validate) {
      throw new Error(
        `ContractValidator: schema '${schemaName}' not registered. Call registerSchema() first.`
      );
    }

    const valid = validate(data) as boolean;
    return {
      valid,
      errors: mapErrors(validate.errors),
      schemaId: schemaName,
    };
  }

  /**
   * Validate and throw if invalid — for strict contract enforcement.
   */
  assertValid(schemaName: string, data: unknown): void {
    const result = this.validate(schemaName, data);
    if (!result.valid) {
      const messages = result.errors.map((e) => `${e.path}: ${e.message}`).join("; ");
      throw new Error(`ContractValidator: '${schemaName}' contract violated — ${messages}`);
    }
  }

  /** List registered schema names */
  listSchemas(): string[] {
    return Array.from(this.validators.keys());
  }
}

/** Default singleton validator for convenience */
export const defaultValidator = new ContractValidator();
