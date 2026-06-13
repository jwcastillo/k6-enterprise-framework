/**
 * {{SERVICE_CLASS_NAME}}Service — Service object for {{SERVICE_NAME}} API
 *
 * Encapsulates all HTTP calls to the {{SERVICE_NAME}} service.
 * Use this class in scenarios to keep business logic separate from test logic.
 */

import { RequestHelper, RequestOptions, SafeResponse } from "../../../src/helpers/request-helper";

export class {{SERVICE_CLASS_NAME}}Service {
  private api: RequestHelper;

  constructor(baseUrl: string) {
    this.api = new RequestHelper(baseUrl);
  }

  /**
   * List all {{SERVICE_NAME}} resources.
   */
  list(opts?: RequestOptions): SafeResponse {
    return this.api.get("/api/{{SERVICE_NAME}}", undefined, opts);
  }

  /**
   * Get a single {{SERVICE_NAME}} resource by ID.
   */
  getById(id: string | number, opts?: RequestOptions): SafeResponse {
    return this.api.get(`/api/{{SERVICE_NAME}}/${id}`, undefined, opts);
  }

  /**
   * Create a new {{SERVICE_NAME}} resource.
   */
  create(payload: Record<string, unknown>, opts?: RequestOptions): SafeResponse {
    return this.api.post("/api/{{SERVICE_NAME}}", payload, opts);
  }

  /**
   * Update an existing {{SERVICE_NAME}} resource.
   */
  update(id: string | number, payload: Record<string, unknown>, opts?: RequestOptions): SafeResponse {
    return this.api.put(`/api/{{SERVICE_NAME}}/${id}`, payload, opts);
  }

  /**
   * Delete a {{SERVICE_NAME}} resource.
   */
  remove(id: string | number, opts?: RequestOptions): SafeResponse {
    return this.api.delete(`/api/{{SERVICE_NAME}}/${id}`, opts);
  }
}
