/** Path shim — SaturationCalculator was split into saturation/{cpu,memory,io,network,resource}-calculator.ts
 *  in Phase 4 ARC-07. This file re-exports the facade so legacy imports from
 *  "./calculators/saturation-calculator" keep working. Original: 1344 LOC, T-184.
 */
export { SaturationCalculator } from "./saturation/index";
