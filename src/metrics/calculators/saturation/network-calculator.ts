/**
 * Network Saturation sub-calculator — extracted from saturation-calculator.ts in Phase 4 ARC-07.
 * Implements the Network/ExternalDeps/Kubernetes/Node.js-specific portion of MetricsCalculator
 * (sections g, l, m, and n).
 * Metrics: SAT-026 to SAT-029, SAT-044 to SAT-050 (network bandwidth/drops/retransmits/ports,
 * external dependency latency/errors, K8s pods/scale/HPA/probes, Node.js event loop lag).
 */

import { MetricsCalculator, MetricsEngineInput, MetricResult, k6Stat } from "../../types";
import { avg, m, na, percentile } from "../_helpers";

const CAT = "saturation" as const;

export class NetworkSaturationCalculator implements MetricsCalculator {
  readonly category = CAT;

  calculate(input: MetricsEngineInput): MetricResult[] {
    const { k6Metrics, externalMetrics = {}, durationMs } = input;
    const results: MetricResult[] = [];
    const durationSec = durationMs / 1000;

    // ── (g) Network ────────────────────────────────────────────────────────────
    const _netBWSeries = externalMetrics["network_bandwidth_bytes_per_sec"] ?? [];
    const netDropsSeries = externalMetrics["network_drops"] ?? [];
    const netRetransSeries = externalMetrics["network_retransmits"] ?? [];
    const ephPortSeries = externalMetrics["ephemeral_ports_used"] ?? [];

    const dataReceived = k6Stat(k6Metrics, "data_received", "count");
    const dataSent = k6Stat(k6Metrics, "data_sent", "count");
    const netTotalMbps = durationSec > 0 ? (dataReceived + dataSent) / durationSec / 125_000 : 0;
    results.push(
      m(
        "SAT-026",
        "Network Bandwidth — k6 Avg (Mbps)",
        CAT,
        parseFloat(netTotalMbps.toFixed(2)),
        "Mbps",
        undefined,
        `Average bi-directional network bandwidth from k6: ${(dataReceived / 1_048_576).toFixed(1)} MB received + ${(dataSent / 1_048_576).toFixed(1)} MB sent`
      )
    );

    if (netDropsSeries.length > 0) {
      const drops = netDropsSeries.reduce((s, p) => s + p.value, 0);
      results.push(
        m("SAT-027", "Network Packet Drops", CAT, drops, "packets", "== 0",
          `Total network packet drops during test. Any drops indicate NIC or network saturation`)
      );
    } else {
      results.push(na("SAT-027", "Network Packet Drops", CAT, "packets",
        "Requires network_drops time-series (node_network_receive_drop_total from node_exporter)"));
    }

    if (netRetransSeries.length > 0) {
      const retrans = netRetransSeries.reduce((s, p) => s + p.value, 0);
      const retransRate = durationSec > 0 ? retrans / durationSec : 0;
      results.push(
        m("SAT-028", "TCP Retransmit Rate (/s)", CAT, parseFloat(retransRate.toFixed(2)), "/s",
          "< 10", `TCP segment retransmission rate. High = network congestion or packet loss`)
      );
    } else {
      results.push(na("SAT-028", "TCP Retransmit Rate", CAT, "/s",
        "Requires network_retransmits time-series (node_netstat_Tcp_RetransSegs from node_exporter)"));
    }

    if (ephPortSeries.length > 0) {
      const portMax = Math.max(...ephPortSeries.map((p) => p.value));
      results.push(
        m("SAT-029", "Ephemeral Ports Used — Peak", CAT, portMax, "ports", "< 28000",
          `Peak ephemeral port usage (range ~28232). Near-exhaustion causes EADDRINUSE connection failures`)
      );
    } else {
      results.push(na("SAT-029", "Ephemeral Ports Used", CAT, "ports",
        "Requires ephemeral_ports_used time-series (ss -s or /proc/net/sockstat parsing)"));
    }

    // ── (l) External dependencies ──────────────────────────────────────────────
    const extDepLatSeries = externalMetrics["ext_dep_latency_ms"] ?? [];
    const extDepErrSeries = externalMetrics["ext_dep_error_rate"] ?? [];
    const reqP95 = k6Stat(k6Metrics, "http_req_duration", "p(95)");

    if (extDepLatSeries.length > 0) {
      const extP95 = percentile(extDepLatSeries.map((p) => p.value), 95);
      results.push(
        m("SAT-044", "External Dependency Latency — p95 (ms)", CAT,
          parseFloat(extP95.toFixed(1)), "ms", "< 500",
          `p95 latency for calls to external dependencies`)
      );
    } else {
      results.push(
        m("SAT-044", "External Dependency Latency — p95 (k6 proxy)", CAT,
          parseFloat(reqP95.toFixed(1)), "ms", "< 500",
          `Approximated from k6 http_req_duration p95. For isolated dependency tracking, provide ext_dep_latency_ms in externalMetrics`)
      );
    }

    if (extDepErrSeries.length > 0) {
      const extErrMax = Math.max(...extDepErrSeries.map((p) => p.value));
      results.push(
        m("SAT-045", "External Dependency Error Rate — Peak (%)", CAT,
          parseFloat(extErrMax.toFixed(2)), "%", "< 5",
          `Peak error rate for calls to external dependencies`)
      );
    } else {
      results.push(na("SAT-045", "External Dependency Error Rate", CAT, "%",
        "Requires ext_dep_error_rate time-series (service mesh sidecar or APM tracing)"));
    }

    // ── (m) Kubernetes ────────────────────────────────────────────────────────
    const k8sPodsSeries = externalMetrics["k8s_pods_ready"] ?? [];
    const k8sScaleUpSeries = externalMetrics["k8s_scale_up_lag_sec"] ?? [];
    const k8sHPASeries = externalMetrics["k8s_hpa_active"] ?? [];
    const k8sProbeSeries = externalMetrics["k8s_probe_failures"] ?? [];

    if (k8sPodsSeries.length > 0) {
      const podMin = Math.min(...k8sPodsSeries.map((p) => p.value));
      const podMax = Math.max(...k8sPodsSeries.map((p) => p.value));
      results.push(
        m("SAT-046", "K8s — Ready Pods (min during test)", CAT, podMin, "pods", "> 1",
          `Minimum number of ready pods during the test. Start: ${k8sPodsSeries[0].value}, Peak: ${podMax}, Min: ${podMin}`)
      );
    } else {
      results.push(na("SAT-046", "K8s — Ready Pods", CAT, "pods",
        "Requires k8s_pods_ready time-series (kube_deployment_status_replicas_ready from kube-state-metrics)"));
    }

    if (k8sScaleUpSeries.length > 0) {
      const scaleMax = Math.max(...k8sScaleUpSeries.map((p) => p.value));
      results.push(
        m("SAT-047", "K8s — Scale-Up Lag — Max (s)", CAT, parseFloat(scaleMax.toFixed(0)),
          "s", "< 60",
          `Maximum time from HPA scale decision to pod ready. Long lags leave system under-provisioned`)
      );
    } else {
      results.push(na("SAT-047", "K8s — Scale-Up Lag", CAT, "s",
        "Requires k8s_scale_up_lag_sec time-series (kube_pod_start_time vs HPA lastScaleTime)"));
    }

    if (k8sHPASeries.length > 0) {
      const hpaActivated = k8sHPASeries.some((p) => p.value > 0);
      results.push(
        m("SAT-048", "K8s — HPA Triggered", CAT, hpaActivated ? 1 : 0, "bool", undefined,
          `Whether Horizontal Pod Autoscaler was triggered during the test. ${hpaActivated ? "HPA scaled up." : "HPA not activated."}`)
      );
    } else {
      results.push(na("SAT-048", "K8s — HPA Triggered", CAT, "bool",
        "Requires k8s_hpa_active time-series (kube_horizontalpodautoscaler_status_current_replicas from kube-state-metrics)"));
    }

    if (k8sProbeSeries.length > 0) {
      const probeFailures = k8sProbeSeries.reduce((s, p) => s + p.value, 0);
      results.push(
        m("SAT-049", "K8s — Probe Failures (liveness/readiness)", CAT, probeFailures,
          "events", "== 0",
          `Total liveness/readiness probe failures. Failures cause pod restarts and traffic disruption`)
      );
    } else {
      results.push(na("SAT-049", "K8s — Probe Failures", CAT, "events",
        "Requires k8s_probe_failures time-series (kube_pod_container_status_restarts_total filtered by probe type)"));
    }

    // ── (n) Node.js event loop ─────────────────────────────────────────────────
    const evLoopSeries = externalMetrics["nodejs_eventloop_lag_ms"] ?? [];
    const _workerUtilSeries = externalMetrics["nodejs_worker_pool_util"] ?? [];

    if (evLoopSeries.length > 0) {
      const elMax = Math.max(...evLoopSeries.map((p) => p.value));
      const elAvg = avg(evLoopSeries.map((p) => p.value));
      results.push(
        m("SAT-050", "Node.js Event Loop Lag — Max (ms)", CAT, parseFloat(elMax.toFixed(1)),
          "ms", "< 100",
          `Maximum event loop lag. High lag means event loop is blocked by CPU-intensive work. Avg: ${elAvg.toFixed(1)}ms`)
      );
    } else {
      results.push(na("SAT-050", "Node.js Event Loop Lag", CAT, "ms",
        "Requires nodejs_eventloop_lag_ms time-series (prom-client eventLoopMonitor or @pm2/node-metrics)"));
    }

    return results;
  }
}
