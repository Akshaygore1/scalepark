import type { Architecture } from "./architecture";
import {
  runSimulation,
  type Scenario,
  type SimulationCommand,
  type SimulationResult,
} from "./simulation";

export const SCORED_CHALLENGE_SEED = 730_241;

export const scoredChallengeScenario: Scenario = {
  version: 1,
  durationSeconds: 72,
  normalRps: 2_100,
  spikeRps: 18_000,
  spikeAtSecond: 12,
  availabilityTarget: 0.9995,
  p95TargetMs: 180,
  throughputTarget: 17_100,
  costCeiling: 42,
  observeRecovery: true,
  incidents: [
    { atSecond: 18, type: "hot-key", durationSeconds: 6 },
    { atSecond: 28, type: "cache-failure", durationSeconds: 5 },
    { atSecond: 38, type: "database-slowdown", durationSeconds: 5 },
    {
      atSecond: 52,
      type: "regional-latency",
      region: "us-east",
      durationSeconds: 5,
    },
  ],
};

export const scoredChallengeCommands: SimulationCommand[] = [
  { atSecond: 0, type: "traffic", rps: 2_100 },
  { atSecond: 12, type: "traffic", rps: 18_000 },
  { atSecond: 24, type: "traffic", rps: 8_000 },
  { atSecond: 34, type: "traffic", rps: 14_000 },
  { atSecond: 44, type: "traffic", rps: 18_000 },
  { atSecond: 54, type: "traffic", rps: 12_000 },
  { atSecond: 66, type: "traffic", rps: 18_000 },
];

export type ScoreFactorKey = "availability" | "latency" | "throughput" | "recovery" | "cost";

export type ScoreFactor = {
  key: ScoreFactorKey;
  label: string;
  earned: number;
  possible: number;
  measured: string;
  target: string;
};

export type ChallengeScore = {
  total: number;
  factors: ScoreFactor[];
  penalties: { overprovisioning: number; hints: number };
  estimatedCost: number;
  disclaimer: string;
};

export type ScoredChallengeResult = {
  simulation: SimulationResult;
  score: ChallengeScore;
  seed: number;
};

const SCORE_RUBRIC: Record<ScoreFactorKey, { label: string; possible: number }> = {
  availability: { label: "Availability", possible: 250 },
  latency: { label: "p95 latency", possible: 200 },
  throughput: { label: "Successful throughput", possible: 200 },
  recovery: { label: "Incident recovery", possible: 150 },
  cost: { label: "Cost discipline", possible: 200 },
};
const RECOVERY_TARGET = (scoredChallengeScenario.incidents ?? []).filter((incident) =>
  ["database-slowdown", "database-failure", "regional-latency"].includes(incident.type),
).length;
const MAX_OVERPROVISIONING_PENALTY = 200;

export function runScoredChallenge(
  architecture: Architecture,
  seed = SCORED_CHALLENGE_SEED,
): ScoredChallengeResult {
  const simulation = runSimulation(
    architecture,
    scoredChallengeScenario,
    scoredChallengeCommands,
    seed,
  );
  return { simulation, score: scoreChallenge(simulation, architecture), seed };
}

export function scoreChallenge(
  simulation: SimulationResult,
  architecture: Architecture,
): ChallengeScore {
  const snapshots = simulation.snapshots;
  const averageAvailability = average(snapshots.map((snapshot) => snapshot.availability));
  const averageLatency = average(snapshots.map((snapshot) => snapshot.p95LatencyMs));
  const peakSnapshots = snapshots.filter(
    (snapshot) => snapshot.offered >= scoredChallengeScenario.throughputTarget,
  );
  const averageThroughput = average(
    (peakSnapshots.length > 0 ? peakSnapshots : snapshots).map((snapshot) => snapshot.throughput),
  );
  const hourlyCosts = snapshots.map(
    (snapshot) => snapshot.cost * architectureCostMultiplier(architecture, snapshot.activeReplicas),
  );
  const averageHourlyCost = average(hourlyCosts);
  const recoveries = Math.min(
    RECOVERY_TARGET,
    simulation.events.filter((event) => {
      if (event.type !== "recovery") return false;
      const health = snapshots.find((snapshot) => snapshot.second === event.second)?.systemHealth;
      return health === "healthy" || health === "recovered";
    }).length,
  );

  const factors: ScoreFactor[] = [
    factor(
      "availability",
      averageAvailability / scoredChallengeScenario.availabilityTarget,
      `${(averageAvailability * 100).toFixed(2)}%`,
      `${(scoredChallengeScenario.availabilityTarget * 100).toFixed(2)}%`,
    ),
    factor(
      "latency",
      averageLatency === 0 ? 1 : scoredChallengeScenario.p95TargetMs / averageLatency,
      `${Math.round(averageLatency)}ms`,
      `≤ ${scoredChallengeScenario.p95TargetMs}ms`,
    ),
    factor(
      "throughput",
      averageThroughput / scoredChallengeScenario.throughputTarget,
      `${Math.round(averageThroughput).toLocaleString()}/s`,
      `${scoredChallengeScenario.throughputTarget.toLocaleString()}/s`,
    ),
    factor(
      "recovery",
      recoveries / RECOVERY_TARGET,
      `${recoveries}/${RECOVERY_TARGET} recoveries`,
      `${RECOVERY_TARGET}/${RECOVERY_TARGET} recoveries`,
    ),
    factor(
      "cost",
      averageHourlyCost === 0 ? 1 : scoredChallengeScenario.costCeiling / averageHourlyCost,
      `$${averageHourlyCost.toFixed(2)}/h`,
      `≤ $${scoredChallengeScenario.costCeiling}/h`,
    ),
  ];
  const overprovisioning = Math.round(
    clamp(
      ((averageHourlyCost - scoredChallengeScenario.costCeiling) /
        scoredChallengeScenario.costCeiling) *
        MAX_OVERPROVISIONING_PENALTY,
      0,
      MAX_OVERPROVISIONING_PENALTY,
    ),
  );
  const factorTotal = factors.reduce((total, item) => total + item.earned, 0);

  return {
    total: Math.round(clamp(factorTotal - overprovisioning, 0, 1000)),
    factors,
    penalties: { overprovisioning, hints: 0 },
    estimatedCost: Number((hourlyCosts.reduce((total, cost) => total + cost, 0) / 3600).toFixed(2)),
    disclaimer:
      "Provider-neutral educational estimate based on active components and simulated runtime; not a current cloud quote.",
  };
}

export function applyHintPenalty(score: ChallengeScore, hintPenalty: number): ChallengeScore {
  const hints = Math.max(0, hintPenalty);
  const factorTotal = score.factors.reduce((total, factor) => total + factor.earned, 0);
  return {
    ...score,
    total: Math.max(0, factorTotal - score.penalties.overprovisioning - hints),
    penalties: { ...score.penalties, hints },
  };
}

function architectureCostMultiplier(
  architecture: Architecture,
  activeReplicas: Record<string, number>,
) {
  const reachable = reachableNodeIds(architecture);
  const billableNodes = architecture.nodes.filter(
    (node) => node.type !== "client" && reachable.has(node.id),
  );
  if (billableNodes.length === 0) return 1;
  const typeMultiplier: Record<Architecture["nodes"][number]["type"], number> = {
    client: 0,
    cdn: 1,
    "load-balancer": 0.8,
    "api-server": 1,
    cache: 1.15,
    "primary-database": 1,
    "read-replica": 0.9,
    queue: 0.7,
    worker: 0.85,
  };
  const regionMultiplier: Record<Architecture["nodes"][number]["config"]["region"], number> = {
    "us-east": 1,
    "us-west": 1.08,
    "eu-west": 1.12,
    "ap-south": 0.92,
  };
  const baseCost = billableNodes.reduce(
    (total, node) => total + provisionedNodeCost(node, activeReplicas[node.id]),
    0,
  );
  const adjustedCost = billableNodes.reduce(
    (total, node) =>
      total +
      provisionedNodeCost(node, activeReplicas[node.id]) *
        typeMultiplier[node.type] *
        regionMultiplier[node.config.region],
    0,
  );
  return baseCost === 0 ? 1 : adjustedCost / baseCost;
}

function provisionedNodeCost(node: Architecture["nodes"][number], activeReplicas?: number) {
  const config = node.config;
  return (
    (activeReplicas ?? config.replicas) *
    (config.capacity * 0.00015 + config.concurrency * 0.001 + (1000 / config.serviceTimeMs) * 0.01)
  );
}

function reachableNodeIds(architecture: Architecture) {
  const reachable = new Set(
    architecture.nodes.filter((node) => node.type === "client").map((node) => node.id),
  );
  const pending = [...reachable];
  while (pending.length > 0) {
    const source = pending.shift()!;
    for (const edge of architecture.edges.filter((candidate) => candidate.source === source)) {
      if (reachable.has(edge.target)) continue;
      reachable.add(edge.target);
      pending.push(edge.target);
    }
  }
  return reachable;
}

function factor(key: ScoreFactorKey, ratio: number, measured: string, target: string): ScoreFactor {
  const rubric = SCORE_RUBRIC[key];
  return {
    key,
    label: rubric.label,
    possible: rubric.possible,
    earned: Math.round(rubric.possible * clamp(ratio, 0, 1)),
    measured,
    target,
  };
}

function average(values: number[]) {
  return values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
