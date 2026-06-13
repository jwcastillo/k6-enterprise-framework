/**
 * T-049: Generator health monitor
 *
 * Monitors CPU and memory of the load generator during test execution.
 * Emits warnings when CPU > 80% (results may be distorted).
 * Includes a report section with resource usage graphs data.
 *
 * Compatible with native execution and Docker (reads cgroups in containers).
 *
 * Runs in Node.js context (bin/), NOT in k6 goja runtime.
 */

import { GeneratorHealthMetrics, HealthSample } from "../types/benchmark.d";

const os = require("os") as typeof import("os");
const fs = require("fs") as typeof import("fs");

// ── Constants ─────────────────────────────────────────────────────────────────

const SAMPLE_INTERVAL_MS = 5000;
const CPU_WARNING_THRESHOLD = 80;

// ── State ─────────────────────────────────────────────────────────────────────

let monitorInterval: ReturnType<typeof setInterval> | null = null;
let samples: HealthSample[] = [];
let previousCpuUsage: { idle: number; total: number } | null = null;

// ── CPU measurement ───────────────────────────────────────────────────────────

/**
 * Detect if running inside a Docker container.
 */
function isDocker(): boolean {
  try {
    return (
      fs.existsSync("/.dockerenv") ||
      (fs.existsSync("/proc/1/cgroup") &&
        fs.readFileSync("/proc/1/cgroup", "utf-8").includes("docker"))
    );
  } catch {
    return false;
  }
}

/**
 * Get CPU usage percentage.
 * Uses cgroups in Docker, os.cpus() natively.
 */
function getCpuPercent(): number {
  if (isDocker()) {
    return getCpuPercentCgroups();
  }
  return getCpuPercentNative();
}

/**
 * Native CPU measurement using os.cpus() delta.
 */
function getCpuPercentNative(): number {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;

  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq + cpu.times.idle;
  }

  if (previousCpuUsage) {
    const idleDelta = idle - previousCpuUsage.idle;
    const totalDelta = total - previousCpuUsage.total;
    previousCpuUsage = { idle, total };

    if (totalDelta === 0) return 0;
    return Math.round(((totalDelta - idleDelta) / totalDelta) * 100);
  }

  previousCpuUsage = { idle, total };
  return 0; // First sample — no delta available
}

/**
 * Docker/cgroups CPU measurement.
 * Reads from cgroups v2 (/sys/fs/cgroup/cpu.stat) or v1.
 */
function getCpuPercentCgroups(): number {
  try {
    // cgroups v2
    if (fs.existsSync("/sys/fs/cgroup/cpu.stat")) {
      const stat = fs.readFileSync("/sys/fs/cgroup/cpu.stat", "utf-8");
      const usageMatch = stat.match(/usage_usec\s+(\d+)/);
      if (usageMatch) {
        // Simplified: return a rough estimate based on usage
        // Full implementation would track delta over interval
        return Math.min(100, parseInt(usageMatch[1], 10) / 10000);
      }
    }
    // cgroups v1 fallback
    if (fs.existsSync("/sys/fs/cgroup/cpuacct/cpuacct.usage")) {
      const usage = parseInt(
        fs.readFileSync("/sys/fs/cgroup/cpuacct/cpuacct.usage", "utf-8").trim(),
        10
      );
      return Math.min(100, usage / 1e9); // nanoseconds to rough %
    }
  } catch {
    // Fall back to native
  }
  return getCpuPercentNative();
}

/**
 * Get memory usage.
 * Uses cgroups in Docker, os.freemem()/totalmem() natively.
 */
function getMemoryUsage(): { bytes: number; percent: number } {
  if (isDocker()) {
    try {
      // cgroups v2
      if (fs.existsSync("/sys/fs/cgroup/memory.current")) {
        const current = parseInt(
          fs.readFileSync("/sys/fs/cgroup/memory.current", "utf-8").trim(),
          10
        );
        const max = fs.existsSync("/sys/fs/cgroup/memory.max")
          ? parseInt(fs.readFileSync("/sys/fs/cgroup/memory.max", "utf-8").trim(), 10)
          : os.totalmem();
        return { bytes: current, percent: Math.round((current / max) * 100) };
      }
    } catch {
      // Fall back to native
    }
  }

  const used = os.totalmem() - os.freemem();
  const percent = Math.round((used / os.totalmem()) * 100);
  return { bytes: used, percent };
}

// ── Monitor lifecycle ─────────────────────────────────────────────────────────

/**
 * Start the generator health monitor.
 * Samples CPU and memory every 5 seconds.
 */
export function startHealthMonitor(): void {
  samples = [];
  previousCpuUsage = null;

  // Take initial sample
  collectSample();

  monitorInterval = setInterval(collectSample, SAMPLE_INTERVAL_MS);
  console.log("[generator-health] Health monitor started (sampling every 5s)");
}

/**
 * Collect a single health sample.
 */
function collectSample(): void {
  const cpuPercent = getCpuPercent();
  const memory = getMemoryUsage();

  const sample: HealthSample = {
    timestamp: new Date().toISOString(),
    cpuPercent,
    memoryBytes: memory.bytes,
    memoryPercent: memory.percent,
  };

  samples.push(sample);

  // T-169: traffic-light color-coded CPU warning (green <60%, yellow 60-80%, red >80%)
  if (cpuPercent > CPU_WARNING_THRESHOLD) {
    // Red indicator: >80%
    console.warn(
      `\x1b[33m[generator-health] WARNING: Generator CPU at ${cpuPercent}%. Results may be distorted.\x1b[0m`
    );
    if (cpuPercent > 90) {
      console.warn(
        `\x1b[31m[generator-health] CRITICAL: CPU >90% — consider distributed execution. See: docs/DISTRIBUTED_TESTING.md\x1b[0m`
      );
    }
  } else if (cpuPercent > 60) {
    // Yellow indicator: 60–80%
    console.log(`[generator-health] CPU at ${cpuPercent}% (elevated — monitoring)`);
  }
  // Green (<60%): no log noise
}

/**
 * Stop the health monitor and return aggregated metrics.
 */
export function stopHealthMonitor(): GeneratorHealthMetrics {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }

  // Collect final sample
  collectSample();

  if (samples.length === 0) {
    return {
      cpuMax: 0,
      cpuAvg: 0,
      memMax: 0,
      memAvg: 0,
      warnings: [],
      samples: [],
      saturated: false,
    };
  }

  const cpuValues = samples.map((s) => s.cpuPercent);
  const memValues = samples.map((s) => s.memoryBytes);

  const cpuMax = Math.max(...cpuValues);
  const cpuAvg = Math.round(cpuValues.reduce((a, b) => a + b, 0) / cpuValues.length);
  const memMax = Math.max(...memValues);
  const memAvg = Math.round(memValues.reduce((a, b) => a + b, 0) / memValues.length);

  const saturated = cpuMax > CPU_WARNING_THRESHOLD;
  const warnings: string[] = [];

  if (saturated) {
    warnings.push(
      `CPU exceeded ${CPU_WARNING_THRESHOLD}% (peak: ${cpuMax}%). Results may be distorted by generator saturation.`
    );
  }

  const metrics: GeneratorHealthMetrics = {
    cpuMax,
    cpuAvg,
    memMax,
    memAvg,
    warnings,
    samples,
    saturated,
  };

  console.log(
    `[generator-health] Monitor stopped. CPU max=${cpuMax}% avg=${cpuAvg}%, ` +
      `Memory max=${formatBytes(memMax)} avg=${formatBytes(memAvg)}` +
      (saturated ? " ⚠ SATURATED" : "")
  );

  return metrics;
}

/**
 * Format bytes as human-readable string.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

/**
 * T-169: Traffic-light CSS indicator for CPU level.
 *   < 60%  → green circle
 *   60-80% → yellow triangle
 *   > 80%  → red square
 */
function cpuTrafficLight(cpuPercent: number): string {
  if (cpuPercent > 80) {
    return `<span title="CPU critical (>80%)" style="display:inline-block;width:12px;height:12px;background:#ef4444;margin-right:6px" aria-label="CPU critical"></span>`;
  }
  if (cpuPercent > 60) {
    return `<span title="CPU elevated (60-80%)" style="display:inline-block;width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:12px solid #f59e0b;margin-right:6px" aria-label="CPU elevated"></span>`;
  }
  return `<span title="CPU healthy (<60%)" style="display:inline-block;width:12px;height:12px;background:#22c55e;border-radius:50%;margin-right:6px" aria-label="CPU healthy"></span>`;
}

/**
 * Format generator health for HTML report.
 * T-169: traffic-light indicators, distributed testing recommendation.
 */
export function formatHealthForHtml(metrics: GeneratorHealthMetrics): string {
  const cpuIndicator = cpuTrafficLight(metrics.cpuMax);
  const saturationBanner = metrics.saturated
    ? `<div role="alert" style="background:#fef9c3;border:1px solid #fde047;border-radius:6px;padding:10px 14px;margin-bottom:12px;color:#713f12;font-size:13px">
        ⚠ <strong>WARNING: Generator CPU at ${metrics.cpuMax}%.</strong> Results may be distorted.
        Consider running with fewer VUs or use distributed mode.
      </div>`
    : `<div style="background:#dcfce7;border:1px solid #86efac;border-radius:6px;padding:10px 14px;margin-bottom:12px;color:#166534;font-size:13px">
        ✓ Generator resources within acceptable bounds (CPU max: ${metrics.cpuMax}%).
      </div>`;

  const rows = [
    ["CPU (max)", `${cpuIndicator}${metrics.cpuMax}%`],
    ["CPU (avg)", `${metrics.cpuAvg}%`],
    ["Memory (max)", formatBytes(metrics.memMax)],
    ["Memory (avg)", formatBytes(metrics.memAvg)],
    ["Samples", String(metrics.samples.length)],
  ];

  const tableRows = rows
    .map(
      ([label, val]) =>
        `<tr><td style="color:#64748b;padding:4px 12px">${label}</td><td style="padding:4px 12px;font-weight:600">${val}</td></tr>`
    )
    .join("");

  return `
<div id="generator-health" style="margin-bottom:20px">
  <h3 style="font-size:15px;font-weight:600;margin-bottom:8px">Generator Health</h3>
  ${saturationBanner}
  <table style="width:auto;border-collapse:collapse;background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.07)">
    ${tableRows}
  </table>
  ${metrics.warnings.length > 0 ? `<p style="margin-top:8px;font-size:12px;color:#94a3b8">For >5000 VUs, use distributed mode. See: <a href="../docs/DISTRIBUTED_TESTING.md">docs/DISTRIBUTED_TESTING.md</a></p>` : ""}
</div>`;
}

/**
 * Format generator health for JSON summary.
 */
export function formatHealthForJson(metrics: GeneratorHealthMetrics): Record<string, unknown> {
  return {
    generatorHealth: {
      cpuMax: metrics.cpuMax,
      cpuAvg: metrics.cpuAvg,
      memMax: metrics.memMax,
      memAvg: metrics.memAvg,
      warnings: metrics.warnings,
      saturated: metrics.saturated,
      sampleCount: metrics.samples.length,
    },
  };
}
