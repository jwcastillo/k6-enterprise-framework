/**
 * SafeResponse — Client-safe shape of an HTTP response captured by RequestHelper.
 * Canonical declaration extracted from src/helpers/request-helper.ts to resolve
 * the core→helpers layering violation (ARC-01).
 *
 * SafeResponse — Forma cliente-safe de una respuesta HTTP capturada por RequestHelper.
 * Declaración canónica extraída de src/helpers/request-helper.ts para resolver
 * la violación de capas core→helpers (ARC-01).
 */

/** T-008 (ARC-01): SafeResponse — canonical type declaration */
export interface SafeResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
  timings: { duration: number; waiting: number; receiving: number; sending: number };
  json<T = unknown>(selector?: string): T | null;
}
