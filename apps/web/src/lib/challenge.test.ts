import assert from "node:assert/strict";
import test from "node:test";

import { createNode, starterArchitecture } from "./architecture";
import {
  runScoredChallenge,
  scoreChallenge,
  scoredChallengeCommands,
  scoredChallengeScenario,
} from "./challenge";
import type { SimulationResult, Snapshot } from "./simulation";

test("the scored challenge runs the complete fixed incident schedule deterministically", () => {
  const architecture = starterArchitecture();
  const first = runScoredChallenge(architecture);
  const second = runScoredChallenge(architecture);

  assert.deepEqual(first, second);
  assert.equal(first.simulation.snapshots.length, scoredChallengeScenario.durationSeconds);
  assert.deepEqual(
    scoredChallengeScenario.incidents?.map((incident) => incident.type),
    ["hot-key", "cache-failure", "database-slowdown", "regional-latency"],
  );
  assert.ok(scoredChallengeCommands.some((command) => command.type === "traffic"));
  assert.equal(first.score.total >= 0 && first.score.total <= 1000, true);
});

test("an ideal run earns every published score factor", () => {
  const architecture = starterArchitecture();
  const ideal = scoreChallenge(syntheticResult(), architecture);

  assert.deepEqual(Object.fromEntries(ideal.factors.map((factor) => [factor.key, factor.earned])), {
    availability: 250,
    latency: 200,
    throughput: 200,
    recovery: 150,
    cost: 200,
  });
  assert.deepEqual(ideal.penalties, { overprovisioning: 0, hints: 0 });
  assert.equal(ideal.total, 1000);
  assert.equal(ideal.estimatedCost, 0.02);
});

test("each score factor responds independently to its published measurement", () => {
  const architecture = starterArchitecture();
  const cases: Array<{
    key: "availability" | "latency" | "throughput" | "recovery" | "cost";
    result: SimulationResult;
    earned: number;
  }> = [
    {
      key: "availability",
      result: syntheticResult({ availability: 0.49975 }),
      earned: 125,
    },
    { key: "latency", result: syntheticResult({ p95LatencyMs: 360 }), earned: 100 },
    { key: "throughput", result: syntheticResult({ throughput: 8550 }), earned: 100 },
    {
      key: "recovery",
      result: syntheticResult({ systemHealth: "saturated" }),
      earned: 0,
    },
    { key: "cost", result: syntheticResult({ cost: 84 }), earned: 100 },
  ];

  for (const fixture of cases) {
    const factors = scoreChallenge(fixture.result, architecture).factors;
    assert.equal(factors.find((factor) => factor.key === fixture.key)?.earned, fixture.earned);
    assert.equal(
      factors
        .filter((factor) => factor.key !== fixture.key)
        .every((factor) => factor.earned === factor.possible),
      true,
    );
  }
});

test("cost above the ceiling applies the published overprovisioning penalty", () => {
  const score = scoreChallenge(syntheticResult({ cost: 84 }), starterArchitecture());
  assert.equal(score.penalties.overprovisioning, 200);
  assert.equal(score.total, 700);
});

test("unlimited capacity cannot win the challenge by brute-force provisioning", () => {
  const balanced = starterArchitecture();
  for (const node of balanced.nodes.filter((node) => node.type !== "client")) {
    node.config.replicas = 4;
    node.config.capacity = 20_000;
    node.config.concurrency = 1000;
  }
  const unlimited = structuredClone(balanced);
  for (const node of unlimited.nodes.filter((node) => node.type !== "client")) {
    node.config.replicas = 100;
    node.config.capacity = 1_000_000;
    node.config.concurrency = 100_000;
  }

  const balancedScore = runScoredChallenge(balanced).score;
  const unlimitedScore = runScoredChallenge(unlimited).score;
  assert.ok(unlimitedScore.penalties.overprovisioning > 0);
  assert.ok(unlimitedScore.total < balancedScore.total);
});

test("educational cost reflects component type as well as provisioned resources", () => {
  const cdnDesign = starterArchitecture();
  const cacheDesign = structuredClone(cdnDesign);
  cacheDesign.nodes.find((node) => node.type === "cdn")!.type = "cache";

  const cdnCost = scoreChallenge(syntheticResult(), cdnDesign).factors.find(
    (factor) => factor.key === "cost",
  );
  const cacheCost = scoreChallenge(syntheticResult(), cacheDesign).factors.find(
    (factor) => factor.key === "cost",
  );
  assert.notEqual(cdnCost?.measured, cacheCost?.measured);
  assert.notEqual(cdnCost?.earned, cacheCost?.earned);
});

test("disconnected cheap components cannot dilute the scored cost", () => {
  const architecture = starterArchitecture();
  const padded = structuredClone(architecture);
  padded.nodes.push(...Array.from({ length: 20 }, (_, index) => createNode("queue", index + 10)));

  assert.deepEqual(
    scoreChallenge(syntheticResult(), architecture),
    scoreChallenge(syntheticResult(), padded),
  );
});

function syntheticResult(overrides: Partial<Snapshot> = {}): SimulationResult {
  const snapshot = {
    second: 0,
    offered: 18_000,
    successful: 17_100,
    queued: 0,
    dropped: 0,
    timedOut: 0,
    inFlight: 0,
    availability: 0.9995,
    p95LatencyMs: 180,
    throughput: 17_100,
    cost: 42,
    networkLatencyMs: 0,
    regionalCost: 0,
    routeAllocations: [],
    activeReplicas: {},
    nodeCapacity: {},
    pendingDeployments: [],
    cacheHitRate: 0,
    originLoad: 0,
    hotKeyPressure: 0,
    cacheMisses: 0,
    cacheEvictions: 0,
    cacheHealth: "absent" as const,
    retryAttempts: 0,
    amplifiedLoad: 0,
    databaseConnections: 0,
    databaseQueue: 0,
    queueBacklog: 0,
    droppedMessages: 0,
    nodeHealth: {},
    systemHealth: "healthy" as const,
    ...overrides,
  };
  return {
    validation: { runnable: true, errors: [], warnings: [] },
    snapshots: [snapshot, { ...snapshot, second: 1 }],
    events: [
      { second: 0, type: "recovery", message: "Recovered" },
      { second: 0, type: "recovery", message: "Recovered" },
      { second: 0, type: "recovery", message: "Recovered" },
    ],
    outcome: "passed",
    seed: 1,
    architectureVersion: 1,
    scenarioVersion: 1,
  };
}
