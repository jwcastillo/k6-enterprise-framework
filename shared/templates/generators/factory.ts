/**
 * {{FACTORY_CLASS_NAME}}Factory — Data factory for {{CLIENT_NAME}} tests
 *
 * Generates realistic test data using DataHelper.
 * Use in scenarios via DataPool or direct calls in the VU function.
 */

import { DataHelper } from "../../../src/helpers/data-helper";

export class {{FACTORY_CLASS_NAME}}Factory {
  private data: DataHelper;

  constructor() {
    this.data = new DataHelper();
  }

  /**
   * Generate a valid {{FACTORY_CLASS_NAME}} payload for create/update operations.
   */
  build(overrides: Partial<{{FACTORY_CLASS_NAME}}Payload> = {}): {{FACTORY_CLASS_NAME}}Payload {
    return {
      name:  overrides.name  ?? this.data.randomString(12),
      email: overrides.email ?? this.data.randomEmail(),
      ...overrides,
    };
  }

  /**
   * Generate N payloads at once.
   */
  buildMany(count: number, overrides: Partial<{{FACTORY_CLASS_NAME}}Payload> = {}): {{FACTORY_CLASS_NAME}}Payload[] {
    return Array.from({ length: count }, () => this.build(overrides));
  }
}

// ── Type definition ───────────────────────────────────────────────────────────

export interface {{FACTORY_CLASS_NAME}}Payload {
  name:  string;
  email: string;
  [key: string]: unknown;
}
