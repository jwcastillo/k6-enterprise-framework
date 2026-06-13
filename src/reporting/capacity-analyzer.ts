// T-090: Motor de analisis de capacidad
// T-091: Proyecciones de crecimiento y recomendaciones de escalamiento

export interface LoadDataPoint {
  vus: number;
  rps: number;
  p95Ms: number;
  p99Ms: number;
  errorRatePct: number;
  timestamp?: string;
}

export interface CapacityAnalysis {
  maxSustainableLoad: LoadDataPoint | null;   // last point with p95<threshold && error<1%
  inflectionPoint: LoadDataPoint | null;       // where latency slope changes >50%
  breakingPoint: LoadDataPoint | null;         // error>5% or latency>3x baseline
  currentHeadroomPct: number | null;
  baselineLatencyMs: number;
  dataPointCount: number;
  sufficient: boolean;                         // >=5 data points
  warnings: string[];
}

export interface CapacityProjection {
  growthRatePerMonth: number;          // e.g. 0.15 for 15%
  currentRps: number;
  inflectionReachedAt?: Date;
  breakingPointReachedAt?: Date;
  confidenceLevel: 'high' | 'medium' | 'low';
  recommendations: string[];
  warnings: string[];
}

const MIN_POINTS = 5;
const ERROR_BURST_THRESHOLD_PCT = 5;
const LATENCY_BREAK_MULTIPLIER = 3;
const SLOPE_CHANGE_THRESHOLD = 0.5; // 50% change in slope

/** Analyze historical load test data points to determine capacity limits */
export function analyzeCapacity(
  dataPoints: LoadDataPoint[],
  p95ThresholdMs = 2000
): CapacityAnalysis {
  const warnings: string[] = [];

  if (dataPoints.length < MIN_POINTS) {
    warnings.push(`Only ${dataPoints.length} data points available. Need at least ${MIN_POINTS} for reliable analysis.`);
  }

  // Sort by VUs ascending
  const sorted = [...dataPoints].sort((a, b) => a.vus - b.vus);
  if (sorted.length === 0) {
    return { maxSustainableLoad: null, inflectionPoint: null, breakingPoint: null, currentHeadroomPct: null, baselineLatencyMs: 0, dataPointCount: 0, sufficient: false, warnings };
  }

  const baselineLatencyMs = sorted[0].p95Ms;

  // Max sustainable load: last point where p95 < threshold AND error < 1%
  let maxSustainable: LoadDataPoint | null = null;
  for (const dp of sorted) {
    if (dp.p95Ms < p95ThresholdMs && dp.errorRatePct < 1) {
      maxSustainable = dp;
    } else {
      break;
    }
  }

  // Breaking point: first point where error > 5% OR latency > 3x baseline
  let breakingPoint: LoadDataPoint | null = null;
  for (const dp of sorted) {
    if (dp.errorRatePct > ERROR_BURST_THRESHOLD_PCT || dp.p95Ms > baselineLatencyMs * LATENCY_BREAK_MULTIPLIER) {
      breakingPoint = dp;
      break;
    }
  }

  // Inflection point: where latency slope changes > 50%
  const inflectionPoint = detectInflectionPoint(sorted);

  // Headroom
  let headroomPct: number | null = null;
  if (maxSustainable && breakingPoint) {
    headroomPct = Math.round(((breakingPoint.rps - maxSustainable.rps) / breakingPoint.rps) * 100);
  }

  return {
    maxSustainableLoad: maxSustainable,
    inflectionPoint,
    breakingPoint,
    currentHeadroomPct: headroomPct,
    baselineLatencyMs,
    dataPointCount: dataPoints.length,
    sufficient: dataPoints.length >= MIN_POINTS,
    warnings,
  };
}

function detectInflectionPoint(sorted: LoadDataPoint[]): LoadDataPoint | null {
  if (sorted.length < 3) return null;

  const slopes: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const rpsΔ = sorted[i].rps - sorted[i - 1].rps;
    const latΔ = sorted[i].p95Ms - sorted[i - 1].p95Ms;
    slopes.push(rpsΔ > 0 ? latΔ / rpsΔ : 0); // ms per rps
  }

  for (let i = 1; i < slopes.length; i++) {
    if (slopes[i - 1] === 0) continue;
    const slopeChange = Math.abs((slopes[i] - slopes[i - 1]) / slopes[i - 1]);
    if (slopeChange >= SLOPE_CHANGE_THRESHOLD) {
      return sorted[i]; // inflection at this point
    }
  }
  return null;
}

/** Project when growth will reach capacity limits */
export function projectCapacity(
  analysis: CapacityAnalysis,
  currentRps: number,
  growthRatePerMonth: number // e.g. 0.15 for 15%
): CapacityProjection {
  const warnings: string[] = [];
  const recommendations: string[] = [];

  // Coefficient of variation check (SC-016)
  if (!analysis.sufficient) {
    warnings.push('Insufficient data for reliable projection (< 5 data points).');
  }

  const project = (targetRps: number): Date | undefined => {
    if (currentRps >= targetRps) return new Date(); // already there
    if (growthRatePerMonth <= 0) return undefined;
    // months = log(target/current) / log(1 + rate)
    const months = Math.log(targetRps / currentRps) / Math.log(1 + growthRatePerMonth);
    const d = new Date();
    d.setMonth(d.getMonth() + Math.ceil(months));
    return d;
  };

  const inflectionReachedAt = analysis.inflectionPoint
    ? project(analysis.inflectionPoint.rps)
    : undefined;

  const breakingPointReachedAt = analysis.breakingPoint
    ? project(analysis.breakingPoint.rps)
    : undefined;

  // Confidence level
  let confidenceLevel: 'high' | 'medium' | 'low' = 'high';
  if (!analysis.sufficient) confidenceLevel = 'low';
  else if (analysis.dataPointCount < 8) confidenceLevel = 'medium';

  // Recommendations
  if (breakingPointReachedAt) {
    const monthsToBreak = Math.ceil((breakingPointReachedAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30));
    if (monthsToBreak <= 3) {
      recommendations.push(`⚠️ Scale horizontally before ${breakingPointReachedAt.toLocaleDateString()} (${monthsToBreak} months away).`);
    } else {
      recommendations.push(`Plan horizontal scaling before ${breakingPointReachedAt.toLocaleDateString()}.`);
    }
  }
  if (analysis.currentHeadroomPct !== null && analysis.currentHeadroomPct < 20) {
    recommendations.push('Current headroom is below 20%. Consider immediate scaling.');
  }
  if (analysis.inflectionPoint) {
    recommendations.push(`Service shows latency degradation past ${analysis.inflectionPoint.rps.toFixed(0)} rps. Optimize before this load level.`);
  }

  return {
    growthRatePerMonth,
    currentRps,
    inflectionReachedAt,
    breakingPointReachedAt,
    confidenceLevel,
    recommendations,
    warnings,
  };
}

/** Format capacity analysis as markdown section for reports */
export function formatCapacityMarkdown(
  analysis: CapacityAnalysis,
  projection?: CapacityProjection
): string {
  const lines: string[] = [
    '## Capacity Analysis',
    '',
    '| Indicator | Value |',
    '|---|---|',
    `| Max Sustainable RPS | ${analysis.maxSustainableLoad?.rps.toFixed(0) ?? 'N/A'} |`,
    `| Max Sustainable VUs | ${analysis.maxSustainableLoad?.vus ?? 'N/A'} |`,
    `| Inflection Point RPS | ${analysis.inflectionPoint?.rps.toFixed(0) ?? 'N/A'} |`,
    `| Breaking Point RPS | ${analysis.breakingPoint?.rps.toFixed(0) ?? 'N/A'} |`,
    `| Headroom | ${analysis.currentHeadroomPct !== null ? analysis.currentHeadroomPct + '%' : 'N/A'} |`,
    `| Baseline p95 | ${analysis.baselineLatencyMs}ms |`,
    '',
  ];

  if (analysis.warnings.length > 0) {
    lines.push('**Warnings:**', ...analysis.warnings.map(w => `- ${w}`), '');
  }

  if (projection) {
    lines.push(
      '### Growth Projections',
      `**Growth rate**: ${(projection.growthRatePerMonth * 100).toFixed(0)}%/month | **Confidence**: ${projection.confidenceLevel}`,
      '',
    );
    if (projection.inflectionReachedAt) {
      lines.push(`- Inflection point reached ~${projection.inflectionReachedAt.toLocaleDateString()}`);
    }
    if (projection.breakingPointReachedAt) {
      lines.push(`- Breaking point reached ~${projection.breakingPointReachedAt.toLocaleDateString()}`);
    }
    if (projection.recommendations.length > 0) {
      lines.push('', '**Recommendations:**', ...projection.recommendations.map(r => `- ${r}`));
    }
  }

  return lines.join('\n');
}
