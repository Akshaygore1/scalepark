import {
  databaseCapacityLevel,
  validateArchitecture,
  type Architecture,
  type ComponentConfig,
} from "./architecture";
import {
  runSimulation,
  type Scenario,
  type SimulationEvent,
  type SimulationResult,
  type Snapshot,
} from "./simulation";

export const REVIEW_METRICS = [
  "throughput",
  "p95LatencyMs",
  "availability",
  "queueBacklog",
  "utilization",
  "cost",
] as const;

export type ReviewMetric = (typeof REVIEW_METRICS)[number];
export type ReviewMarkerKind = "incident" | "deployment" | "saturation" | "recovery" | "slo-breach";

export type ReviewMarker = {
  id: string;
  second: number;
  kind: ReviewMarkerKind;
  label: string;
  message: string;
  nodeId?: string;
};

export type ReviewCausalSummary = {
  headline: string;
  detail: string;
  signals: string[];
};

export type WhatIfVariant = {
  apiReplicas: Record<string, number>;
  workerReplicas: Record<string, number>;
  cacheTtlSeconds: Record<string, number>;
  retriesEnabled: Record<string, boolean>;
  databaseCapacityLevel: Record<string, number>;
  dnsWeights: Record<string, number>;
};

export type ComparisonMetrics = {
  outcome: SimulationResult["outcome"];
  availability: number;
  p95LatencyMs: number;
  throughput: number;
  maximumBacklog: number;
  cost: number;
  firstSaturatedNodeId?: string;
};

export type ComparisonResult = {
  baseline: SimulationResult;
  candidate: SimulationResult;
  baselineMetrics: ComparisonMetrics;
  candidateMetrics: ComparisonMetrics;
  deltas: {
    availability: number;
    p95LatencyMs: number;
    throughput: number;
    maximumBacklog: number;
    cost: number;
  };
};

const incidentEventTypes = new Set<SimulationEvent["type"]>([
  "hot-key",
  "cache-stampede",
  "database-slowdown",
  "database-failure",
  "regional-latency",
  "retry-amplification",
]);

function markerKind(event: SimulationEvent): ReviewMarkerKind | undefined {
  if (incidentEventTypes.has(event.type)) return "incident";
  if (
    event.type === "deployment-applied" ||
    event.type === "capacity-removed" ||
    event.type === "scale-out-requested" ||
    event.type === "scale-in-requested"
  ) {
    return "deployment";
  }
  if (event.type === "saturation" || event.type === "queue-overflow") return "saturation";
  if (event.type === "recovery") return "recovery";
  if (event.type === "slo-breach") return "slo-breach";
  return undefined;
}

export function reviewMarkers(events: SimulationEvent[]): ReviewMarker[] {
  return events.flatMap((event, index) => {
    const kind = markerKind(event);
    if (!kind) return [];
    return [
      {
        id: `${event.second}-${event.type}-${event.nodeId ?? "system"}-${index}`,
        second: event.second,
        kind,
        label: markerLabel(kind),
        message: event.message,
        nodeId: event.nodeId,
      },
    ];
  });
}

export function reviewMetricValue(snapshot: Snapshot, metric: ReviewMetric) {
  switch (metric) {
    case "throughput":
      return snapshot.throughput;
    case "p95LatencyMs":
      return snapshot.p95LatencyMs;
    case "availability":
      return snapshot.availability * 100;
    case "queueBacklog":
      return Math.max(snapshot.queued, snapshot.queueBacklog);
    case "utilization":
      return Math.max(0, ...Object.values(snapshot.nodeUtilization));
    case "cost":
      return snapshot.cost;
  }
}

export function reviewMetricLabel(metric: ReviewMetric) {
  return {
    throughput: "Throughput",
    p95LatencyMs: "p95 latency",
    availability: "Availability",
    queueBacklog: "Queue backlog",
    utilization: "Peak utilization",
    cost: "Operating cost",
  }[metric];
}

export function reviewMetricUnit(metric: ReviewMetric) {
  return {
    throughput: "req/s",
    p95LatencyMs: "ms",
    availability: "%",
    queueBacklog: "requests",
    utilization: "%",
    cost: "$",
  }[metric];
}

export function formatReviewMetric(value: number, metric: ReviewMetric) {
  if (metric === "availability") return `${value.toFixed(2)}%`;
  if (metric === "p95LatencyMs") return `${Math.round(value)}ms`;
  if (metric === "cost") return `$${value.toFixed(2)}`;
  return `${Math.round(value).toLocaleString()} ${reviewMetricUnit(metric)}`;
}

export function reviewCausalSummary(
  result: SimulationResult,
  architecture: Architecture,
  second: number,
): ReviewCausalSummary {
  const snapshot = result.snapshots.find((item) => item.second === second);
  if (!snapshot) {
    return {
      headline: "No completed simulation data yet",
      detail: "The review becomes available after the first simulation tick.",
      signals: [],
    };
  }
  const previous = result.snapshots.find((item) => item.second === second - 1);
  const events = result.events.filter((event) => event.second === second);
  const saturatedNode = snapshot.saturatedNodeId
    ? architecture.nodes.find((node) => node.id === snapshot.saturatedNodeId)
    : undefined;
  const queueDelta = previous ? Math.max(0, snapshot.queued - previous.queued) : 0;
  const latencyDelta = previous ? snapshot.p95LatencyMs - previous.p95LatencyMs : 0;
  const headline = events[0]?.message ??
    (saturatedNode
      ? `${saturatedNode.label} is the first constrained component.`
      : snapshot.systemHealth === "healthy"
        ? "Traffic is flowing within the current limits."
        : `The system is ${snapshot.systemHealth}.`);
  const signals: string[] = [];
  const incident = events.find((event) => incidentEventTypes.has(event.type));
  if (incident) signals.push(`Incident impact: ${incident.message}`);
  if (saturatedNode) signals.push(`Saturated component: ${saturatedNode.label}.`);
  if (queueDelta > 0) signals.push(`Queue grew by ${queueDelta.toLocaleString()} requests this second.`);
  if (latencyDelta > 0) signals.push(`p95 latency rose by ${latencyDelta}ms from the prior second.`);
  if (snapshot.dropped > 0) signals.push(`${snapshot.dropped.toLocaleString()} requests were dropped or timed out.`);
  if (snapshot.retryAttempts > 0) {
    signals.push(`${snapshot.retryAttempts.toLocaleString()} retry attempts added pressure to downstream work.`);
  }
  const detail = events.length > 1
    ? events.slice(1).map((event) => event.message).join(" ")
    : signals[0] ??
      `At ${formatSecond(second)}, ${Math.round(snapshot.throughput).toLocaleString()} requests per second completed with ${snapshot.availability.toFixed(4)} availability.`;
  return { headline, detail, signals };
}

export function createWhatIfVariant(architecture: Architecture): WhatIfVariant {
  return {
    apiReplicas: Object.fromEntries(
      architecture.nodes
        .filter((node) => node.type === "api-server")
        .map((node) => [node.id, node.config.replicas]),
    ),
    workerReplicas: Object.fromEntries(
      architecture.nodes
        .filter((node) => node.type === "worker")
        .map((node) => [node.id, node.config.replicas]),
    ),
    cacheTtlSeconds: Object.fromEntries(
      architecture.nodes
        .filter((node) => node.type === "cache")
        .map((node) => [node.id, node.config.ttlSeconds]),
    ),
    retriesEnabled: Object.fromEntries(
      architecture.nodes
        .filter((node) => node.type === "api-server")
        .map((node) => [node.id, node.config.retries > 0]),
    ),
    databaseCapacityLevel: Object.fromEntries(
      architecture.nodes
        .filter((node) => node.type === "primary-database")
        .map((node) => [node.id, databaseCapacityLevel(node)]),
    ),
    dnsWeights: Object.fromEntries(
      architecture.edges
        .filter((edge) => architecture.nodes.find((node) => node.id === edge.source)?.type === "dns")
        .map((edge) => [edge.id, edge.weight]),
    ),
  };
}

export function applyWhatIfVariant(architecture: Architecture, variant: WhatIfVariant): Architecture {
  const next = structuredClone(architecture);
  next.nodes = next.nodes.map((node) => {
    const config: ComponentConfig = { ...node.config, autoscaling: { ...node.config.autoscaling } };
    if (node.type === "api-server" && variant.apiReplicas[node.id] !== undefined) {
      config.replicas = clamp(variant.apiReplicas[node.id]!, 0, 12);
    }
    if (node.type === "worker" && variant.workerReplicas[node.id] !== undefined) {
      config.replicas = clamp(variant.workerReplicas[node.id]!, 0, 12);
    }
    if (node.type === "cache" && variant.cacheTtlSeconds[node.id] !== undefined) {
      config.ttlSeconds = clamp(variant.cacheTtlSeconds[node.id]!, 1, 3_600);
    }
    if (node.type === "api-server" && variant.retriesEnabled[node.id] !== undefined) {
      config.retries = variant.retriesEnabled[node.id] ? Math.max(1, node.config.retries) : 0;
    }
    if (node.type === "primary-database" && variant.databaseCapacityLevel[node.id] !== undefined) {
      Object.assign(config, databaseConfigForLevel(clamp(variant.databaseCapacityLevel[node.id]!, 1, 3)));
    }
    return { ...node, config };
  });
  next.edges = next.edges.map((edge) =>
    variant.dnsWeights[edge.id] === undefined
      ? edge
      : { ...edge, weight: clamp(variant.dnsWeights[edge.id]!, 1, 100) },
  );
  return next;
}

export function whatIfVariantErrors(architecture: Architecture, variant: WhatIfVariant) {
  const errors = [
    ...boundedErrors(variant.apiReplicas, "API replicas", 0, 12),
    ...boundedErrors(variant.workerReplicas, "Worker replicas", 0, 12),
    ...boundedErrors(variant.cacheTtlSeconds, "Cache TTL", 1, 3_600),
    ...boundedErrors(variant.databaseCapacityLevel, "Database capacity level", 1, 3),
    ...boundedErrors(variant.dnsWeights, "DNS route weight", 1, 100),
  ];
  return [...errors, ...validateArchitecture(applyWhatIfVariant(architecture, variant)).errors];
}

export function compareArchitectures(
  baselineArchitecture: Architecture,
  candidateArchitecture: Architecture,
  scenario: Scenario,
  seed: number,
): ComparisonResult {
  const baseline = runSimulation(baselineArchitecture, scenario, [], seed);
  const candidate = runSimulation(candidateArchitecture, scenario, [], seed);
  const baselineMetrics = comparisonMetrics(baseline);
  const candidateMetrics = comparisonMetrics(candidate);
  return {
    baseline,
    candidate,
    baselineMetrics,
    candidateMetrics,
    deltas: {
      availability: candidateMetrics.availability - baselineMetrics.availability,
      p95LatencyMs: candidateMetrics.p95LatencyMs - baselineMetrics.p95LatencyMs,
      throughput: candidateMetrics.throughput - baselineMetrics.throughput,
      maximumBacklog: candidateMetrics.maximumBacklog - baselineMetrics.maximumBacklog,
      cost: candidateMetrics.cost - baselineMetrics.cost,
    },
  };
}

function comparisonMetrics(result: SimulationResult): ComparisonMetrics {
  if (result.snapshots.length === 0) {
    return {
      outcome: result.outcome,
      availability: 0,
      p95LatencyMs: 0,
      throughput: 0,
      maximumBacklog: 0,
      cost: 0,
      firstSaturatedNodeId: result.firstSaturatedNodeId,
    };
  }
  return {
    outcome: result.outcome,
    availability: Math.min(...result.snapshots.map((snapshot) => snapshot.availability)),
    p95LatencyMs: Math.max(...result.snapshots.map((snapshot) => snapshot.p95LatencyMs)),
    throughput: Math.max(...result.snapshots.map((snapshot) => snapshot.throughput)),
    maximumBacklog: Math.max(
      ...result.snapshots.map((snapshot) => Math.max(snapshot.queued, snapshot.queueBacklog)),
    ),
    cost: Math.max(...result.snapshots.map((snapshot) => snapshot.cost)),
    firstSaturatedNodeId: result.firstSaturatedNodeId,
  };
}

function databaseConfigForLevel(level: number): Partial<ComponentConfig> {
  return level <= 1
    ? { capacity: 2_500, concurrency: 80, connectionLimit: 80 }
    : level === 2
      ? { capacity: 20_000, concurrency: 2_000, connectionLimit: 2_000 }
      : { capacity: 30_000, concurrency: 1_200, connectionLimit: 1_200 };
}

function markerLabel(kind: ReviewMarkerKind) {
  return {
    incident: "Incident",
    deployment: "Deployment",
    saturation: "Saturation",
    recovery: "Recovery",
    "slo-breach": "SLO breach",
  }[kind];
}

function formatSecond(second: number) {
  return `${Math.floor(second / 60)}m ${String(second % 60).padStart(2, "0")}s`;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function boundedErrors(values: Record<string, number>, label: string, min: number, max: number) {
  return Object.entries(values).flatMap(([key, value]) =>
    Number.isInteger(value) && value >= min && value <= max
      ? []
      : [`${label} for ${key} must be between ${min} and ${max}.`],
  );
}

export function componentLabel(architecture: Architecture, nodeId?: string) {
  return architecture.nodes.find((node) => node.id === nodeId)?.label ?? "No component";
}
