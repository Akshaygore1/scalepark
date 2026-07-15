import assert from "node:assert/strict";
import test from "node:test";

import { createNode, starterArchitecture } from "./architecture";
import { runScoredChallenge, scoredChallengeScenario } from "./challenge";
import { runSimulation } from "./simulation";

test("the calibrated scored challenge breaks the starter but admits two bounded repairs", () => {
  const starter = runScoredChallenge(starterArchitecture());
  const cachedRepair = runScoredChallenge(repairWithCache());
  const capacityRepair = runScoredChallenge(repairWithCapacity());

  assert.equal(starter.simulation.outcome, "failed");
  assert.ok(starter.simulation.events.some((event) => event.type === "saturation"));
  for (const repair of [cachedRepair, capacityRepair]) {
    assert.equal(repair.simulation.outcome, "passed");
    assert.ok(repair.score.total > 0);
    assert.equal(repair.score.penalties.overprovisioning, 0);
  }
  assert.notDeepEqual(
    cachedRepair.simulation.snapshots.map((snapshot) => snapshot.cacheHitRate),
    capacityRepair.simulation.snapshots.map((snapshot) => snapshot.cacheHitRate),
  );
});

test("complete challenge is deterministic and conserves every request through all incidents", () => {
  const architecture = repairWithCache();
  const api = architecture.nodes.find((node) => node.type === "api-server")!;
  const first = runScoredChallenge(architecture);
  const second = runScoredChallenge(architecture);

  assert.deepEqual(first, second);
  assert.deepEqual(
    scoredChallengeScenario.incidents?.map((incident) => incident.type),
    ["hot-key", "cache-failure", "database-slowdown", "regional-latency"],
  );
  assert.equal(first.simulation.snapshots.length, scoredChallengeScenario.durationSeconds);
  assert.ok(first.score.total >= 0 && first.score.total <= 1_000);
  for (const [index, snapshot] of first.simulation.snapshots.entries()) {
    const priorQueue = index === 0 ? 0 : first.simulation.snapshots[index - 1]!.queued;
    assert.equal(
      snapshot.offered + priorQueue,
      snapshot.successful +
        snapshot.queued +
        snapshot.dropped +
        snapshot.timedOut +
        snapshot.inFlight,
    );
    assert.ok(snapshot.throughput <= snapshot.offered + priorQueue);
    assert.ok(snapshot.throughput <= snapshot.nodeCapacity[api.id]!);
  }
});

test("database failure remains a deterministic golden outside the winnable score schedule", () => {
  const result = runSimulation(repairWithCapacity(), {
    ...scoredChallengeScenario,
    durationSeconds: 4,
    incidents: [{ atSecond: 1, type: "database-failure", durationSeconds: 2 }],
  });

  assert.equal(result.outcome, "failed");
  assert.ok(result.events.some((event) => event.type === "database-failure"));
  assert.equal(result.snapshots[1]?.throughput, 0);
});

function repairWithCache() {
  const architecture = starterArchitecture();
  const api = architecture.nodes.find((node) => node.type === "api-server")!;
  const database = architecture.nodes.find((node) => node.type === "primary-database")!;
  const cache = createNode("cache", architecture.nodes.length);
  architecture.nodes.push(cache);
  architecture.edges = architecture.edges.filter(
    (edge) => !(edge.source === api.id && edge.target === database.id),
  );
  architecture.edges.push(
    { id: crypto.randomUUID(), source: api.id, target: cache.id, weight: 100 },
    { id: crypto.randomUUID(), source: cache.id, target: database.id, weight: 100 },
  );
  provision(architecture);
  cache.config.cacheSize = 50_000;
  cache.config.ttlSeconds = 900;
  return architecture;
}

function repairWithCapacity() {
  const architecture = starterArchitecture();
  provision(architecture);
  return architecture;
}

function provision(architecture: ReturnType<typeof starterArchitecture>) {
  for (const node of architecture.nodes.filter((node) => node.type !== "client")) {
    node.config.replicas = 3;
    node.config.capacity = 6_100;
    node.config.concurrency = 300;
    node.config.serviceTimeMs = 16;
    node.config.connectionLimit = 500;
    node.config.region = "us-west";
  }
  architecture.nodes.find((node) => node.type === "client")!.config.region = "us-west";
}
