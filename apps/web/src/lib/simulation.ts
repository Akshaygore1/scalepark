import { validateArchitecture, type Architecture } from "./architecture";

export type Scenario = {
  version: 1;
  durationSeconds: number;
  normalRps: number;
  spikeRps: number;
  spikeAtSecond: number;
  availabilityTarget: number;
  p95TargetMs: number;
  throughputTarget: number;
  costCeiling: number;
  incidents?: ScenarioIncident[];
};
export type ScenarioIncident = { atSecond: number; type: "hot-key" | "cache-failure" };
export type SimulationCommand = { atSecond: number; type: "traffic"; rps: number };
export type Snapshot = {
  second: number;
  offered: number;
  successful: number;
  queued: number;
  dropped: number;
  timedOut: number;
  inFlight: number;
  availability: number;
  p95LatencyMs: number;
  throughput: number;
  cost: number;
  cacheHitRate: number;
  originLoad: number;
  hotKeyPressure: number;
  cacheMisses: number;
  cacheEvictions: number;
  cacheHealth: "absent" | "healthy" | "hot" | "expired" | "failed";
  saturatedNodeId?: string;
};
export type SimulationEvent = {
  second: number;
  type: "traffic" | "saturation" | "slo-breach" | "hot-key" | "cache-stampede";
  message: string;
  nodeId?: string;
};
export type SimulationResult = {
  validation: ReturnType<typeof validateArchitecture>;
  snapshots: Snapshot[];
  events: SimulationEvent[];
  outcome: "passed" | "failed" | "invalid";
  firstSaturatedNodeId?: string;
  seed: number;
  architectureVersion: number;
  scenarioVersion: number;
};

export type FailureReport = {
  frozenAtSecond: number;
  firstSaturatedNodeId?: string;
  queueGrowth: number;
  propagatedLatencyMs: number;
  successfulTraffic: number;
  dropped: number;
  timedOut: number;
  cause: string;
};

export const starterScenario: Scenario = {
  version: 1,
  durationSeconds: 60,
  normalRps: 2100,
  spikeRps: 18_000,
  spikeAtSecond: 12,
  availabilityTarget: 0.9995,
  p95TargetMs: 180,
  throughputTarget: 17_100,
  costCeiling: 42,
  incidents: [
    { atSecond: 25, type: "hot-key" },
    { atSecond: 40, type: "cache-failure" },
  ],
};

export function runSimulation(
  architecture: Architecture,
  scenario = starterScenario,
  commands: SimulationCommand[] = [],
  seed = 1,
): SimulationResult {
  const validation = validateArchitecture(architecture);
  if (!validation.runnable)
    return result(validation, [], [], "invalid", undefined, seed, architecture, scenario);
  const reachable = reachableNodeIds(architecture);
  const nodes = architecture.nodes.filter(
    (node) => node.type !== "client" && reachable.has(node.id),
  );
  const cache = nodes.find((node) => node.type === "cache");
  const database = nodes.find((node) => node.type === "primary-database") ?? nodes[0]!;
  const transportNodes = nodes.filter(
    (node) => !["cache", "primary-database", "read-replica"].includes(node.type),
  );
  const events: SimulationEvent[] = [];
  const snapshots: Snapshot[] = [];
  let queue = 0;
  let firstSaturatedNodeId: string | undefined;
  for (let second = 0; second < scenario.durationSeconds; second += 1) {
    const command = commands.find((item) => item.atSecond === second);
    const offered =
      (command?.rps ??
        (second >= scenario.spikeAtSecond ? scenario.spikeRps : scenario.normalRps)) +
      (seed % 3);
    const incident = scenario.incidents?.filter((candidate) => candidate.atSecond <= second).at(-1);
    const hotKeyPressure = incident?.type === "hot-key" ? 0.8 : 0;
    const cacheFailed = incident?.type === "cache-failure";
    const cacheExpired = Boolean(
      cache && !cacheFailed && second > 0 && second % Math.max(1, cache.config.ttlSeconds) === 0,
    );
    const cacheHitRate =
      cache && !cacheFailed && !cacheExpired ? calculateCacheHitRate(cache, hotKeyPressure) : 0;
    const cacheHealth = !cache
      ? "absent"
      : cacheFailed
        ? "failed"
        : cacheExpired
          ? "expired"
          : hotKeyPressure > 0
            ? "hot"
            : "healthy";
    if (incident?.atSecond === second && incident.type === "hot-key")
      events.push({
        second,
        type: "hot-key",
        nodeId: cache?.id,
        message: "A viral short link concentrates traffic on one cache key.",
      });
    if (incident?.atSecond === second && incident.type === "cache-failure")
      events.push({
        second,
        type: "cache-stampede",
        nodeId: cache?.id,
        message: "Cache failure sends concurrent misses to the origin.",
      });
    if (cacheExpired)
      events.push({
        second,
        type: "cache-stampede",
        nodeId: cache?.id,
        message: "TTL expiry invalidates the working set and concurrent misses reach the origin.",
      });
    if (second === scenario.spikeAtSecond)
      events.push({
        second,
        type: "traffic",
        message: `Traffic spike reaches ${offered.toLocaleString()} req/s.`,
      });
    const demand = offered + queue;
    const cacheMisses = Math.ceil(demand * (1 - cacheHitRate));
    const workingSet = Math.ceil(demand * (hotKeyPressure > 0 ? 0.03 : 0.18));
    const cacheEvictions = cache ? Math.max(0, workingSet - cache.config.cacheSize) : 0;
    const originLoad = cacheMisses + cacheEvictions;
    const databaseCapacity = effectiveCapacity(database);
    const cacheCapacity =
      cache && !cacheFailed ? effectiveCapacity(cache) * (1 - hotKeyPressure * 0.5) : 0;
    const transportCapacity = transportNodes.length
      ? Math.min(...transportNodes.map(effectiveCapacity))
      : Number.POSITIVE_INFINITY;
    const capacity = Math.max(
      1,
      Math.floor(Math.min(transportCapacity, databaseCapacity + cacheCapacity * cacheHitRate)),
    );
    const bottleneck =
      originLoad > databaseCapacity
        ? database
        : transportNodes.reduce(
            (lowest, node) => (effectiveCapacity(node) < effectiveCapacity(lowest) ? node : lowest),
            transportNodes[0] ?? database,
          );
    const admitted = Math.min(demand, capacity);
    const inFlight = Math.min(Math.ceil(admitted * 0.1), admitted);
    const successful = admitted - inFlight;
    const excess = Math.max(0, demand - capacity);
    const timedOut = queue > capacity * 2 ? Math.min(queue - capacity * 2, excess) : 0;
    const dropped = Math.max(0, excess - 20_000);
    queue = Math.max(0, excess - timedOut - dropped);
    const availability = offered === 0 ? 1 : admitted / offered;
    const p95LatencyMs = Math.round(
      42 + (queue / Math.max(1, capacity)) * 420 + bottleneck.config.serviceTimeMs,
    );
    const cost = Number(nodes.reduce((sum, node) => sum + componentCost(node), 0).toFixed(2));
    if (excess > 0 && !firstSaturatedNodeId) {
      firstSaturatedNodeId = bottleneck.id;
      events.push({
        second,
        type: "saturation",
        nodeId: bottleneck.id,
        message: `${bottleneck.label} reaches finite capacity.`,
      });
    }
    const snapshot: Snapshot = {
      second,
      offered,
      successful,
      queued: queue,
      dropped,
      timedOut,
      inFlight,
      availability,
      p95LatencyMs,
      throughput: admitted,
      cost,
      cacheHitRate,
      originLoad,
      hotKeyPressure,
      cacheMisses,
      cacheEvictions,
      cacheHealth,
      saturatedNodeId: firstSaturatedNodeId,
    };
    snapshots.push(snapshot);
    if (
      availability < scenario.availabilityTarget ||
      p95LatencyMs > scenario.p95TargetMs ||
      (offered >= scenario.throughputTarget && admitted < scenario.throughputTarget) ||
      cost > scenario.costCeiling
    ) {
      events.push({
        second,
        type: "slo-breach",
        nodeId: firstSaturatedNodeId,
        message: `Objective breached: ${Math.round(availability * 10000) / 100}% availability, p95 ${p95LatencyMs}ms.`,
      });
      return result(
        validation,
        snapshots,
        events,
        "failed",
        firstSaturatedNodeId,
        seed,
        architecture,
        scenario,
      );
    }
  }
  return result(
    validation,
    snapshots,
    events,
    "passed",
    firstSaturatedNodeId,
    seed,
    architecture,
    scenario,
  );
}

function result(
  validation: ReturnType<typeof validateArchitecture>,
  snapshots: Snapshot[],
  events: SimulationEvent[],
  outcome: SimulationResult["outcome"],
  firstSaturatedNodeId: string | undefined,
  seed: number,
  architecture: Architecture,
  scenario: Scenario,
): SimulationResult {
  return {
    validation,
    snapshots,
    events,
    outcome,
    firstSaturatedNodeId,
    seed,
    architectureVersion: architecture.version,
    scenarioVersion: scenario.version,
  };
}

function effectiveCapacity(node: Architecture["nodes"][number]) {
  const serviceLimit = (node.config.concurrency * 1000) / node.config.serviceTimeMs;
  return Math.max(
    1,
    Math.floor(Math.min(node.config.capacity, serviceLimit) * node.config.replicas),
  );
}

function calculateCacheHitRate(cache: Architecture["nodes"][number], hotKeyPressure: number) {
  const sizeFactor = Math.min(0.22, Math.log10(Math.max(1, cache.config.cacheSize)) * 0.055);
  const ttlFactor = Math.min(0.3, cache.config.ttlSeconds / 1000);
  return Number(
    Math.max(0.05, Math.min(0.92, 0.4 + sizeFactor + ttlFactor - hotKeyPressure * 0.45)).toFixed(3),
  );
}

function componentCost(node: Architecture["nodes"][number]) {
  const capacityCost = node.config.capacity * 0.00015;
  const concurrencyCost = node.config.concurrency * 0.001;
  const servicePerformanceCost = (1000 / node.config.serviceTimeMs) * 0.01;
  return node.config.replicas * (capacityCost + concurrencyCost + servicePerformanceCost);
}

function reachableNodeIds(architecture: Architecture) {
  const reachable = new Set(
    architecture.nodes.filter((node) => node.type === "client").map((node) => node.id),
  );
  const queue = [...reachable];
  while (queue.length > 0) {
    const source = queue.shift()!;
    for (const edge of architecture.edges.filter((candidate) => candidate.source === source)) {
      if (reachable.has(edge.target)) continue;
      reachable.add(edge.target);
      queue.push(edge.target);
    }
  }
  return reachable;
}

export function explainFailure(result: SimulationResult): FailureReport | null {
  if (result.outcome !== "failed" || result.snapshots.length === 0) return null;
  const frozen = result.snapshots.at(-1)!;
  const before = result.snapshots[0]!;
  return {
    frozenAtSecond: frozen.second,
    firstSaturatedNodeId: result.firstSaturatedNodeId,
    queueGrowth: frozen.queued - before.queued,
    propagatedLatencyMs: frozen.p95LatencyMs - before.p95LatencyMs,
    successfulTraffic: frozen.successful,
    dropped: frozen.dropped,
    timedOut: frozen.timedOut,
    cause:
      frozen.timedOut > 0
        ? "Work waited beyond the timeout while the saturated path drained its queue."
        : frozen.dropped > 0
          ? "Demand exceeded the finite queue budget after the saturated path filled."
          : "Demand exceeded the first saturated component’s finite capacity and accumulated in its queue.",
  };
}
