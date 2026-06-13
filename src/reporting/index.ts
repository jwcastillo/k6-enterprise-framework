/** Barrel export — k6 Enterprise Framework reporting */

export { generateJsonSummary } from "./json-summary-generator";
export type { JsonSummaryOutput, K6TestOptions } from "./json-summary-generator";

// T-090/T-091: Capacity analysis + projections
export { analyzeCapacity, projectCapacity, formatCapacityMarkdown } from "./capacity-analyzer";
export type { LoadDataPoint, CapacityAnalysis, CapacityProjection } from "./capacity-analyzer";

// T-092: Capacity HTML report generator
export { generateCapacityReportHtml, writeCapacityReport } from "./capacity-report-generator";
export type { CapacityReportOptions } from "./capacity-report-generator";

// Ticket & comment generator (Jira / GitHub)
export { TicketGenerator, calculateApdex, apdexRating } from "./ticket-generator";
export type { TicketPayload, TicketPlatform, StoryContext } from "./ticket-generator";

// T-084: Trend visualization
export {
  buildTrendAnalysis,
  detectTrendPatterns,
  generateTrendHtml,
  generateGrafanaPanelConfig,
} from "./trend-visualizer";
export type { TrendDataPoint, TrendWindow, TrendAnalysis, TrendPattern } from "./trend-visualizer";

// Phase 6 / DX-06: Artifact-generation pipeline (split of bin/generate-artifacts.js)
export * from "./artifacts";
