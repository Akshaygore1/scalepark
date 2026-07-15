import { validateArchitecture, type Architecture, type Region } from "./architecture";

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
  observeRecovery?: boolean;
  incidents?: ScenarioIncident[];
};
export type ScenarioIncident = {
  atSecond: number;
  type:
    | "hot-key"
    | "cache-failure"
    | "database-slowdown"
    | "database-failure"
    | "regional-latency";
  region?: Region;
  durationSeconds?: number;
};
export type RouteAllocation = {
  sourceNodeId: string;
  targetNodeId: string;
  weight: number;
  offered: number;
  latencyMs: number;
  affected: boolean;
};
export type SimulationCommand = { atSecond: number; type: "traffic"; rps: number };
export type SemanticHealth =
  | "healthy"
  | "heating"
  | "saturated"
  | "queued"
  | "failed"
  | "recovered";
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
  networkLatencyMs: number;
  regionalCost: number;
  routeAllocations: RouteAllocation[];
  cacheHitRate: number;
  originLoad: number;
  hotKeyPressure: number;
  cacheMisses: number;
  cacheEvictions: number;
  cacheHealth: "absent" | "healthy" | "hot" | "expired" | "failed";
  retryAttempts: number;
  amplifiedLoad: number;
  databaseConnections: number;
  databaseQueue: number;
  queueBacklog: number;
  droppedMessages: number;
  nodeHealth: Record<string, SemanticHealth>;
  systemHealth: SemanticHealth;
  saturatedNodeId?: string;
};
export type SimulationEvent = {
  second: number;
  type:
    | "traffic"
    | "saturation"
    | "slo-breach"
    | "hot-key"
    | "cache-stampede"
    | "retry-amplification"
    | "database-slowdown"
    | "database-failure"
    | "regional-latency"
    | "queue-overflow"
    | "recovery";
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
  const queueNode = nodes.find((node) => node.type === "queue");
  const queueTrafficShare = queueNode
    ? trafficShareReachingNode(architecture, queueNode.id)
    : 0;
  const queueDescendants = queueNode ? descendantNodeIds(architecture, queueNode.id) : new Set();
  const workerNodes = nodes.filter(
    (node) => node.type === "worker" && queueDescendants.has(node.id),
  );
  const workerTrafficShares = new Map(
    workerNodes.map((node) => [
      node.id,
      queueNode ? trafficShareBetweenNodes(architecture, queueNode.id, node.id) : 0,
    ]),
  );
  const transportNodes = nodes.filter(
    (node) => !["cache", "primary-database", "read-replica", "queue", "worker"].includes(node.type),
  );
  const resilienceNodes = [...transportNodes, ...(queueTrafficShare > 0 ? workerNodes : [])];
  const workerCapacity =
    queueNode && workerNodes.length && queueTrafficShare > 0
      ? routedCapacityFromNode(architecture, queueNode.id)
      : Number.POSITIVE_INFINITY;
  const requestTimeoutMs = transportNodes.length
    ? Math.min(...transportNodes.map((node) => node.config.timeoutMs))
    : database.config.timeoutMs;
  const events: SimulationEvent[] = [];
  const snapshots: Snapshot[] = [];
  let requestBacklog = 0;
  let messageBacklog = 0;
  let firstSaturatedNodeId: string | undefined;
  let retriesWereActive = false;
  let objectiveBreached = false;
  for (let second = 0; second < scenario.durationSeconds; second += 1) {
    const command = commands.find((item) => item.atSecond === second);
    const offered =
      (command?.rps ??
        (second >= scenario.spikeAtSecond ? scenario.spikeRps : scenario.normalRps)) +
      (seed % 3);
    const activeIncidents = (scenario.incidents ?? []).filter((incident) =>
      incidentIsActive(incident, second),
    );
    const hotKeyPressure = activeIncidents.some((incident) => incident.type === "hot-key")
      ? 0.8
      : 0;
    const cacheFailed = activeIncidents.some((incident) => incident.type === "cache-failure");
    const databaseSlowed = activeIncidents.some(
      (incident) => incident.type === "database-slowdown",
    );
    const databaseFailed = activeIncidents.some((incident) => incident.type === "database-failure");
    const affectedRegions = new Set(
      activeIncidents
        .filter((incident) => incident.type === "regional-latency" && incident.region)
        .map((incident) => incident.region!),
    );
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
    if (incidentStarts(scenario, "hot-key", second))
      events.push({
        second,
        type: "hot-key",
        nodeId: cache?.id,
        message: "A viral short link concentrates traffic on one cache key.",
      });
    if (incidentStarts(scenario, "cache-failure", second))
      events.push({
        second,
        type: "cache-stampede",
        nodeId: cache?.id,
        message: "Cache failure sends concurrent misses to the origin.",
      });
    if (incidentStarts(scenario, "database-slowdown", second))
      events.push({
        second,
        type: "database-slowdown",
        nodeId: database.id,
        message: `${database.label} service time increases and available connections drain more slowly.`,
      });
    if (incidentStarts(scenario, "database-failure", second))
      events.push({
        second,
        type: "database-failure",
        nodeId: database.id,
        message: `${database.label} stops accepting work.`,
      });
    const regionalIncident = (scenario.incidents ?? []).find(
      (incident) => incident.type === "regional-latency" && incident.atSecond === second,
    );
    if (regionalIncident?.region)
      events.push({
        second,
        type: "regional-latency",
        nodeId: nodes.find((node) => node.config.region === regionalIncident.region)?.id,
        message: `${regionalIncident.region} experiences elevated network latency on affected routes.`,
      });
    const recoveredIncident = (scenario.incidents ?? []).find(
      (incident) =>
        ["database-slowdown", "database-failure", "regional-latency"].includes(incident.type) &&
        second === incident.atSecond + incidentDuration(incident),
    );
    if (recoveredIncident)
      events.push({
        second,
        type: "recovery",
        nodeId:
          recoveredIncident.type === "regional-latency"
            ? nodes.find((node) => node.config.region === recoveredIncident.region)?.id
            : database.id,
        message:
          recoveredIncident.type === "regional-latency"
            ? `${recoveredIncident.region ?? "Affected region"} network latency recovers to baseline.`
            : `${database.label} recovers from the ${recoveredIncident.type.replace("database-", "")} incident.`,
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
    const previousRequestBacklog = requestBacklog;
    const previousMessageBacklog = messageBacklog;
    const pathNetwork = calculatePathNetwork(architecture, affectedRegions);
    const networkLatencyMs = pathNetwork.p95LatencyMs;
    const networkDropped = affectedRegions.size
      ? Math.ceil(offered * pathNetwork.affectedShare * 0.02)
      : 0;
    const routableOffered = Math.max(0, offered - networkDropped);
    const freshMessages = Math.round(routableOffered * queueTrafficShare);
    const freshRequests = routableOffered - freshMessages;
    const messageDemand = freshMessages + previousMessageBacklog;
    const requestDemand = freshRequests + previousRequestBacklog;
    const workerReleasedMessages = Math.min(messageDemand, workerCapacity);
    const downstreamDemand = requestDemand + workerReleasedMessages;
    const routeAllocations = calculateRouteAllocations(architecture, offered, affectedRegions);
    const cacheMisses = Math.ceil(downstreamDemand * (1 - cacheHitRate));
    const workingSet = Math.ceil(downstreamDemand * (hotKeyPressure > 0 ? 0.03 : 0.18));
    const cacheEvictions = cache ? Math.max(0, workingSet - cache.config.cacheSize) : 0;
    const originLoad = cacheMisses + cacheEvictions;
    const databaseServiceTimeMs =
      database.config.serviceTimeMs * (databaseSlowed ? DATABASE_SLOWDOWN_FACTOR : 1);
    const connectionCapacity = Math.floor(
      (database.config.connectionLimit * database.config.replicas * 4000) / databaseServiceTimeMs,
    );
    const databaseCapacity = databaseFailed
      ? 0
      : Math.max(
          1,
          Math.min(
            effectiveCapacity(database, databaseServiceTimeMs),
            Math.max(1, connectionCapacity),
          ),
        );
    const cacheCapacity =
      cache && !cacheFailed ? effectiveCapacity(cache) * (1 - hotKeyPressure * 0.5) : 0;
    const routedTransportNodes = transportNodes;
    const transportCapacity = routedTransportNodes.length
      ? Math.floor(
          Math.min(
            ...routedTransportNodes.map((node) => {
              const trafficShare = trafficShareReachingNode(architecture, node.id);
              return trafficShare > 0
                ? effectiveCapacity(node) / trafficShare
                : Number.POSITIVE_INFINITY;
            }),
          ),
        )
      : Number.POSITIVE_INFINITY;
    const failedDatabaseAttempts = databaseFailed
      ? originLoad
      : Math.max(0, originLoad - databaseCapacity);
    const workerOriginShare =
      downstreamDemand === 0 ? 0 : workerReleasedMessages / downstreamDemand;
    const retryPolicies = resilienceNodes.map((node) => {
      const retryBase =
        node.type === "worker" ? Math.ceil(originLoad * workerOriginShare) : originLoad;
      const retryableAttempts =
        databaseServiceTimeMs > node.config.timeoutMs
          ? retryBase
          : Math.min(retryBase, failedDatabaseAttempts);
      return { node, attempts: retryableAttempts * node.config.retries };
    });
    const retryAttempts = retryPolicies.reduce((sum, policy) => sum + policy.attempts, 0);
    const amplifiedLoad = originLoad + retryAttempts;
    const activeRetryPolicies = retryPolicies.filter((policy) => policy.attempts > 0);
    if (retryAttempts > 0 && !retriesWereActive) {
      const retrySource = activeRetryPolicies[0]!.node;
      events.push({
        second,
        type: "retry-amplification",
        nodeId: retrySource.id,
        message: `${activeRetryPolicies.map((policy) => policy.node.label).join(", ")} issue ${retryAttempts.toLocaleString()} retries, amplifying database load to ${amplifiedLoad.toLocaleString()} attempts.`,
      });
    }
    retriesWereActive = retryAttempts > 0;
    const retryMultiplier = originLoad === 0 ? 1 : amplifiedLoad / originLoad;
    const originRequestCapacity = Math.floor(databaseCapacity / retryMultiplier);
    const synchronousCapacity =
      databaseFailed && cacheHitRate === 0
        ? 0
        : Math.max(
            1,
            Math.floor(
              Math.min(transportCapacity, originRequestCapacity + cacheCapacity * cacheHitRate),
            ),
          );
    const requestCapacity = synchronousCapacity;
    const admittedRequests = Math.min(requestDemand, requestCapacity);
    const remainingSharedCapacity = Math.max(0, synchronousCapacity - admittedRequests);
    const admittedMessages = Math.min(messageDemand, workerCapacity, remainingSharedCapacity);
    const admitted = admittedRequests + admittedMessages;
    const bottleneck =
      amplifiedLoad > databaseCapacity
        ? database
        : queueNode && queueTrafficShare > 0 && messageDemand > admittedMessages
          ? (workerNodes[0] ?? queueNode)
          : transportNodes.reduce(
              (lowest, node) =>
                effectiveCapacity(node) < effectiveCapacity(lowest) ? node : lowest,
              transportNodes[0] ?? database,
            );
    const inFlight = Math.min(Math.ceil(admitted * 0.1), admitted);
    const successful = admitted - inFlight;
    const requestExcess = Math.max(0, requestDemand - admittedRequests);
    const messageExcess = Math.max(0, messageDemand - admittedMessages);
    const excess = requestExcess + messageExcess;
    const timeoutQueueBudget = Math.max(
      0,
      Math.floor(requestCapacity * (requestTimeoutMs / 1000)),
    );
    const timedOut = Math.min(
      requestExcess,
      Math.max(0, previousRequestBacklog - timeoutQueueBudget),
    );
    const queueBudget = queueNode && queueTrafficShare > 0
      ? queueNode.config.queueCapacity * queueNode.config.replicas
      : 20_000;
    const droppedMessages =
      queueNode && queueTrafficShare > 0 ? Math.max(0, messageExcess - queueBudget) : 0;
    const droppedRequests = Math.max(0, requestExcess - timedOut - 20_000);
    const dropped = networkDropped + droppedMessages + droppedRequests;
    requestBacklog = Math.max(0, requestExcess - timedOut - droppedRequests);
    messageBacklog = Math.max(0, messageExcess - droppedMessages);
    const queue = requestBacklog + messageBacklog;
    const currentWorkAdmitted =
      Math.min(freshRequests, Math.max(0, admittedRequests - previousRequestBacklog)) +
      Math.min(freshMessages, Math.max(0, admittedMessages - previousMessageBacklog));
    const availability = offered === 0 ? 1 : currentWorkAdmitted / offered;
    const p95LatencyMs = Math.round(
      42 +
        (queue / Math.max(1, synchronousCapacity)) * 420 +
        databaseServiceTimeMs +
        networkLatencyMs +
        activeRetryPolicies.reduce(
          (delay, policy) => delay + policy.node.config.retries * policy.node.config.timeoutMs,
          0,
        ),
    );
    const regionalCost = Number(
      routeAllocations
        .reduce((total, route) => {
          const source = architecture.nodes.find((node) => node.id === route.sourceNodeId)!;
          const target = architecture.nodes.find((node) => node.id === route.targetNodeId)!;
          return (
            total +
            route.offered *
              networkLatencyBetween(source.config.region, target.config.region, affectedRegions) *
              REGIONAL_COST_PER_RPS_MS
          );
        }, 0)
        .toFixed(2),
    );
    const cost = Number(
      (nodes.reduce((sum, node) => sum + componentCost(node), 0) + regionalCost).toFixed(2),
    );
    if (excess > 0 && !firstSaturatedNodeId) {
      firstSaturatedNodeId = bottleneck.id;
      events.push({
        second,
        type: "saturation",
        nodeId: bottleneck.id,
        message: `${bottleneck.label} reaches finite capacity.`,
      });
    }
    if (droppedMessages > 0)
      events.push({
        second,
        type: "queue-overflow",
        nodeId: queueNode?.id,
        message: `${droppedMessages.toLocaleString()} messages are dropped after the queue reaches its ${queueBudget.toLocaleString()} message limit.`,
      });
    const databaseConnections = databaseFailed
      ? 0
      : Math.min(
          database.config.connectionLimit * database.config.replicas,
          Math.ceil((amplifiedLoad * databaseServiceTimeMs) / 4000),
        );
    const databaseQueue = Math.max(0, amplifiedLoad - databaseCapacity);
    const nodeDemand = Object.fromEntries(
      nodes.map((node) => [
        node.id,
        node.type === "queue"
          ? messageDemand
          : node.type === "worker"
            ? messageDemand * (workerTrafficShares.get(node.id) ?? 0)
            : node.type === "cache" || node.type === "primary-database"
              ? amplifiedLoad
              : offered * trafficShareReachingNode(architecture, node.id),
      ]),
    );
    const nodeHealth = buildNodeHealth({
      nodes,
      cache,
      database,
      queueNode,
      workerNodes,
      cacheFailed,
      hotKeyPressure,
      databaseFailed,
      databaseSlowed,
      affectedRegions,
      databaseQueue,
      queueBacklog: queueNode && queueTrafficShare > 0 ? messageBacklog : 0,
      droppedMessages,
      recoveredDatabase: Boolean(
        recoveredIncident &&
          ["database-slowdown", "database-failure"].includes(recoveredIncident.type),
      ),
      recoveredRegion:
        recoveredIncident?.type === "regional-latency" ? recoveredIncident.region : undefined,
      bottleneckId: excess > 0 ? bottleneck.id : undefined,
      nodeDemand,
    });
    const systemHealth = overallHealth(Object.values(nodeHealth));
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
      networkLatencyMs,
      regionalCost,
      routeAllocations,
      cacheHitRate,
      originLoad,
      hotKeyPressure,
      cacheMisses,
      cacheEvictions,
      cacheHealth,
      retryAttempts,
      amplifiedLoad,
      databaseConnections,
      databaseQueue,
      queueBacklog: queueNode && queueTrafficShare > 0 ? messageBacklog : 0,
      droppedMessages,
      nodeHealth,
      systemHealth,
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
      objectiveBreached = true;
      if (!scenario.observeRecovery)
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
    objectiveBreached ? "failed" : "passed",
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

const DATABASE_SLOWDOWN_FACTOR = 4;
const REGIONAL_COST_PER_RPS_MS = 0.000002;

function effectiveCapacity(
  node: Architecture["nodes"][number],
  serviceTimeMs = node.config.serviceTimeMs,
) {
  const serviceLimit = (node.config.concurrency * 1000) / serviceTimeMs;
  return Math.max(
    1,
    Math.floor(Math.min(node.config.capacity, serviceLimit) * node.config.replicas),
  );
}

function incidentDuration(incident: ScenarioIncident) {
  if (incident.durationSeconds !== undefined) return Math.max(1, incident.durationSeconds);
  if (incident.type === "database-slowdown") return 5;
  if (incident.type === "database-failure") return 4;
  if (incident.type === "regional-latency") return 3;
  return Number.POSITIVE_INFINITY;
}

function incidentIsActive(incident: ScenarioIncident, second: number) {
  return second >= incident.atSecond && second < incident.atSecond + incidentDuration(incident);
}

function incidentStarts(scenario: Scenario, type: ScenarioIncident["type"], second: number) {
  return scenario.incidents?.some(
    (incident) => incident.type === type && incident.atSecond === second,
  );
}

type NodeHealthInput = {
  nodes: Architecture["nodes"];
  cache: Architecture["nodes"][number] | undefined;
  database: Architecture["nodes"][number];
  queueNode: Architecture["nodes"][number] | undefined;
  workerNodes: Architecture["nodes"];
  cacheFailed: boolean;
  hotKeyPressure: number;
  databaseFailed: boolean;
  databaseSlowed: boolean;
  affectedRegions: Set<Region>;
  databaseQueue: number;
  queueBacklog: number;
  droppedMessages: number;
  recoveredDatabase: boolean;
  recoveredRegion: Region | undefined;
  bottleneckId: string | undefined;
  nodeDemand: Record<string, number>;
};

function buildNodeHealth(input: NodeHealthInput): Record<string, SemanticHealth> {
  const health = Object.fromEntries(
    input.nodes.map((node) => [node.id, "healthy" as SemanticHealth]),
  );
  for (const node of input.nodes) {
    const utilization = (input.nodeDemand[node.id] ?? 0) / Math.max(1, effectiveCapacity(node));
    if (utilization >= 0.75) health[node.id] = "heating";
  }
  for (const node of input.nodes) {
    if (input.affectedRegions.has(node.config.region)) health[node.id] = "heating";
    if (input.recoveredRegion === node.config.region) health[node.id] = "recovered";
  }
  if (input.cache) {
    if (input.cacheFailed) health[input.cache.id] = "failed";
    else if (input.hotKeyPressure > 0) health[input.cache.id] = "heating";
  }
  if (input.databaseFailed) health[input.database.id] = "failed";
  else if (input.databaseQueue > 0) health[input.database.id] = "saturated";
  else if (input.databaseSlowed) health[input.database.id] = "heating";
  else if (input.recoveredDatabase) health[input.database.id] = "recovered";
  if (input.queueNode && input.queueBacklog > 0) health[input.queueNode.id] = "queued";
  if (input.queueNode && input.droppedMessages > 0) health[input.queueNode.id] = "saturated";
  if (input.queueBacklog > 0) {
    for (const worker of input.workerNodes) health[worker.id] = "queued";
  }
  if (input.bottleneckId && health[input.bottleneckId] !== "failed") {
    health[input.bottleneckId] = "saturated";
  }
  return health;
}

function overallHealth(states: SemanticHealth[]): SemanticHealth {
  const precedence: SemanticHealth[] = [
    "failed",
    "saturated",
    "queued",
    "heating",
    "recovered",
    "healthy",
  ];
  return precedence.find((state) => states.includes(state)) ?? "healthy";
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

function calculateRouteAllocations(
  architecture: Architecture,
  offered: number,
  affectedRegions: Set<Region>,
): RouteAllocation[] {
  const clients = architecture.nodes.filter((node) => node.type === "client");
  if (clients.length === 0) return [];
  return architecture.edges
    .map((edge) => {
      const outgoing = architecture.edges.filter((candidate) => candidate.source === edge.source);
      const totalWeight = outgoing.reduce((sum, candidate) => sum + candidate.weight, 0);
      const sourceShare =
        clients.reduce(
          (share, client) =>
            share + trafficShareBetweenNodes(architecture, client.id, edge.source),
          0,
        ) / clients.length;
      const normalizedWeight = edge.weight / totalWeight;
      const source = architecture.nodes.find((node) => node.id === edge.source)!;
      const target = architecture.nodes.find((node) => node.id === edge.target)!;
      return {
        sourceNodeId: edge.source,
        targetNodeId: edge.target,
        weight: Math.round(normalizedWeight * 100),
        offered: Math.round(offered * sourceShare * normalizedWeight),
        latencyMs: networkLatencyBetween(
          source.config.region,
          target.config.region,
          affectedRegions,
        ),
        affected:
          affectedRegions.has(source.config.region) || affectedRegions.has(target.config.region),
      };
    })
    .filter((route) => route.offered > 0);
}

function calculatePathNetwork(architecture: Architecture, affectedRegions: Set<Region>) {
  const clients = architecture.nodes.filter((node) => node.type === "client");
  const paths = clients.flatMap((client) =>
    pathNetworkFromNode(architecture, client.id, affectedRegions).map((path) => ({
      ...path,
      share: path.share / Math.max(1, clients.length),
    })),
  );
  const sorted = [...paths].sort((left, right) => left.latencyMs - right.latencyMs);
  let cumulativeShare = 0;
  let p95LatencyMs = 0;
  for (const path of sorted) {
    cumulativeShare += path.share;
    p95LatencyMs = path.latencyMs;
    if (cumulativeShare >= 0.95) break;
  }
  return {
    p95LatencyMs,
    affectedShare: Math.min(
      1,
      paths.filter((path) => path.affected).reduce((sum, path) => sum + path.share, 0),
    ),
  };
}

function pathNetworkFromNode(
  architecture: Architecture,
  nodeId: string,
  affectedRegions: Set<Region>,
  visited = new Set<string>(),
): Array<{ share: number; latencyMs: number; affected: boolean }> {
  if (visited.has(nodeId)) return [];
  const outgoing = architecture.edges.filter((edge) => edge.source === nodeId);
  if (outgoing.length === 0) return [{ share: 1, latencyMs: 0, affected: false }];
  const source = architecture.nodes.find((node) => node.id === nodeId)!;
  const totalWeight = outgoing.reduce((sum, edge) => sum + edge.weight, 0);
  const nextVisited = new Set(visited).add(nodeId);
  return outgoing.flatMap((edge) => {
    const target = architecture.nodes.find((node) => node.id === edge.target)!;
    const edgeAffected =
      affectedRegions.has(source.config.region) || affectedRegions.has(target.config.region);
    const edgeLatency = networkLatencyBetween(
      source.config.region,
      target.config.region,
      affectedRegions,
    );
    return pathNetworkFromNode(architecture, edge.target, affectedRegions, nextVisited).map(
      (path) => ({
        share: (edge.weight / totalWeight) * path.share,
        latencyMs: edgeLatency + path.latencyMs,
        affected: edgeAffected || path.affected,
      }),
    );
  });
}

function networkLatencyBetween(
  source: Region,
  target: Region,
  affectedRegions: Set<Region>,
) {
  const baseLatency = REGION_LATENCY_MS[source][target];
  return baseLatency + (affectedRegions.has(source) || affectedRegions.has(target) ? 120 : 0);
}

const REGION_LATENCY_MS: Record<Region, Record<Region, number>> = {
  "us-east": { "us-east": 2, "us-west": 72, "eu-west": 82, "ap-south": 185 },
  "us-west": { "us-east": 72, "us-west": 2, "eu-west": 145, "ap-south": 225 },
  "eu-west": { "us-east": 82, "us-west": 145, "eu-west": 2, "ap-south": 130 },
  "ap-south": { "us-east": 185, "us-west": 225, "eu-west": 130, "ap-south": 2 },
};

function trafficShareReachingNode(architecture: Architecture, targetId: string) {
  const clients = architecture.nodes.filter((node) => node.type === "client");
  if (clients.length === 0) return 0;
  return (
    clients.reduce(
      (share, client) =>
        share + trafficShareBetweenNodes(architecture, client.id, targetId),
      0,
    ) /
    clients.length
  );
}

function trafficShareBetweenNodes(
  architecture: Architecture,
  sourceId: string,
  targetId: string,
  visited = new Set<string>(),
): number {
  if (sourceId === targetId) return 1;
  if (visited.has(sourceId)) return 0;
  const outgoing = architecture.edges.filter((edge) => edge.source === sourceId);
  if (outgoing.length === 0) return 0;
  const totalWeight = outgoing.reduce((sum, edge) => sum + edge.weight, 0);
  const nextVisited = new Set(visited).add(sourceId);
  return outgoing.reduce(
    (share, edge) =>
      share +
      (edge.weight / totalWeight) *
        trafficShareBetweenNodes(architecture, edge.target, targetId, nextVisited),
    0,
  );
}

function descendantNodeIds(architecture: Architecture, sourceId: string) {
  const descendants = new Set<string>();
  const pending = architecture.edges
    .filter((edge) => edge.source === sourceId)
    .map((edge) => edge.target);
  while (pending.length > 0) {
    const nodeId = pending.shift()!;
    if (descendants.has(nodeId)) continue;
    descendants.add(nodeId);
    pending.push(
      ...architecture.edges
        .filter((edge) => edge.source === nodeId)
        .map((edge) => edge.target),
    );
  }
  return descendants;
}

function routedCapacityFromNode(
  architecture: Architecture,
  nodeId: string,
  visited = new Set<string>(),
): number {
  return routedCapacityWith(
    architecture,
    nodeId,
    (node) => (node.type === "worker" ? effectiveCapacity(node) : Number.POSITIVE_INFINITY),
    visited,
  );
}

function routedCapacityWith(
  architecture: Architecture,
  nodeId: string,
  capacityFor: (node: Architecture["nodes"][number]) => number,
  visited = new Set<string>(),
): number {
  if (visited.has(nodeId)) return 0;
  const node = architecture.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return 0;
  const ownCapacity = capacityFor(node);
  const outgoing = architecture.edges.filter((edge) => edge.source === nodeId);
  if (outgoing.length === 0) return ownCapacity;

  const nextVisited = new Set(visited).add(nodeId);
  const totalWeight = outgoing.reduce((sum, edge) => sum + edge.weight, 0);
  const downstreamCapacity = Math.min(
    ...outgoing.map((edge) => {
      const routeShare = edge.weight / totalWeight;
      return routedCapacityWith(architecture, edge.target, capacityFor, nextVisited) / routeShare;
    }),
  );
  return Math.min(ownCapacity, downstreamCapacity);
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
  const firstBreachSecond = result.events.find((event) => event.type === "slo-breach")?.second;
  const frozen =
    result.snapshots.find((snapshot) => snapshot.second === firstBreachSecond) ??
    result.snapshots.at(-1)!;
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
