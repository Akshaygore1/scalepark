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
};
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
  saturatedNodeId?: string;
};
export type SimulationEvent = {
  second: number;
  type: "traffic" | "saturation" | "slo-breach";
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
  const nodes = architecture.nodes.filter((node) => node.type !== "client");
  const bottleneck = nodes.reduce(
    (lowest, node) => (effectiveCapacity(node) < effectiveCapacity(lowest) ? node : lowest),
    nodes[0]!,
  );
  const capacity = effectiveCapacity(bottleneck);
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
    if (second === scenario.spikeAtSecond)
      events.push({
        second,
        type: "traffic",
        message: `Traffic spike reaches ${offered.toLocaleString()} req/s.`,
      });
    const demand = offered + queue;
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
    const cost = Number(
      nodes
        .reduce((sum, node) => sum + node.config.replicas * node.config.capacity * 0.0007, 0)
        .toFixed(2),
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
