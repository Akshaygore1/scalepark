import assert from "node:assert/strict";
import test from "node:test";

import { createNode, starterArchitecture } from "./architecture";
import { explainFailure, runSimulation, starterScenario } from "./simulation";

test("starter scenario deterministically fails on its first spike", () => {
  const architecture = starterArchitecture();
  const first = runSimulation(architecture);
  const second = runSimulation(architecture);
  assert.deepEqual(first, second);
  assert.equal(first.outcome, "failed");
  assert.ok(first.events.some((event) => event.type === "saturation"));
});

test("failure explanation freezes numerical evidence without prescribing a repair", () => {
  const report = explainFailure(runSimulation(starterArchitecture()));
  assert.ok(report);
  assert.ok(report!.firstSaturatedNodeId);
  assert.ok(report!.queueGrowth >= 0);
  assert.ok(
    report!.cause.includes("capacity") ||
      report!.cause.includes("timeout") ||
      report!.cause.includes("queue"),
  );
});

test("each tick accounts for offered work through success, queue, drop, or timeout", () => {
  const result = runSimulation(starterArchitecture());
  for (const snapshot of result.snapshots) {
    assert.equal(
      snapshot.offered + (snapshot.second ? result.snapshots[snapshot.second - 1]!.queued : 0),
      snapshot.successful +
        snapshot.queued +
        snapshot.dropped +
        snapshot.timedOut +
        snapshot.inFlight,
    );
  }
});

test("a balanced capacity and cache repair survives the baseline challenge", () => {
  const architecture = starterArchitecture();
  attachCache(architecture);
  for (const node of architecture.nodes.filter((node) => node.type !== "client")) {
    node.config.replicas = 4;
    node.config.capacity = 8000;
    node.config.concurrency = 800;
  }
  assert.equal(runSimulation(architecture).outcome, "passed");
});

test("viral hot-key pressure is visible in cache and origin metrics", () => {
  const architecture = starterArchitecture();
  attachCache(architecture);
  const scenario = {
    ...starterScenario,
    durationSeconds: 5,
    spikeAtSecond: 99,
    incidents: [{ atSecond: 2, type: "hot-key" as const }],
  };
  const result = runSimulation(architecture, scenario);
  assert.ok(result.events.some((event) => event.type === "hot-key"));
  assert.ok(result.snapshots[2]!.hotKeyPressure > result.snapshots[1]!.hotKeyPressure);
  assert.ok(result.snapshots[2]!.originLoad > result.snapshots[1]!.originLoad);
});

test("cache failure creates a deterministic origin stampede", () => {
  const architecture = starterArchitecture();
  attachCache(architecture);
  const scenario = {
    ...starterScenario,
    durationSeconds: 5,
    spikeAtSecond: 99,
    incidents: [{ atSecond: 2, type: "cache-failure" as const }],
  };
  const first = runSimulation(architecture, scenario);
  const second = runSimulation(architecture, scenario);
  assert.deepEqual(first, second);
  assert.ok(first.events.some((event) => event.type === "cache-stampede"));
  assert.equal(first.snapshots[2]!.cacheHitRate, 0);
  assert.ok(first.snapshots[2]!.originLoad > first.snapshots[1]!.originLoad);
});

test("cache size and TTL produce observable misses, evictions, and expiry", () => {
  const architecture = starterArchitecture();
  const cache = attachCache(architecture);
  cache.config.cacheSize = 10;
  cache.config.ttlSeconds = 2;
  const scenario = { ...starterScenario, durationSeconds: 4, spikeAtSecond: 99, incidents: [] };
  const result = runSimulation(architecture, scenario);
  assert.ok(result.snapshots[0]!.cacheMisses > 0);
  assert.ok(result.snapshots[0]!.cacheEvictions > 0);
  assert.equal(result.snapshots[2]!.cacheHealth, "expired");
  assert.ok(result.events.some((event) => event.type === "cache-stampede"));
});

test("a disconnected cache cannot change simulation results", () => {
  const withoutCache = starterArchitecture();
  const withDisconnectedCache = structuredClone(withoutCache);
  withDisconnectedCache.nodes.push(createNode("cache", withDisconnectedCache.nodes.length));
  assert.deepEqual(runSimulation(withDisconnectedCache), runSimulation(withoutCache));
});

test("capacity levers independently change throughput, queueing, latency, and cost", () => {
  const pairs = [
    [
      (node: ReturnType<typeof starterArchitecture>["nodes"][number]) => (node.config.replicas = 1),
      (node: ReturnType<typeof starterArchitecture>["nodes"][number]) => (node.config.replicas = 2),
    ],
    [
      (node: ReturnType<typeof starterArchitecture>["nodes"][number]) =>
        (node.config.capacity = 1000),
      (node: ReturnType<typeof starterArchitecture>["nodes"][number]) =>
        (node.config.capacity = 2000),
    ],
    [
      (node: ReturnType<typeof starterArchitecture>["nodes"][number]) =>
        (node.config.concurrency = 10),
      (node: ReturnType<typeof starterArchitecture>["nodes"][number]) =>
        (node.config.concurrency = 20),
    ],
    [
      (node: ReturnType<typeof starterArchitecture>["nodes"][number]) =>
        (node.config.serviceTimeMs = 64),
      (node: ReturnType<typeof starterArchitecture>["nodes"][number]) =>
        (node.config.serviceTimeMs = 32),
    ],
  ] as const;
  for (const [lower, higher] of pairs) {
    const low = capacitySnapshot(lower);
    const high = capacitySnapshot(higher);
    assert.notEqual(low.throughput, high.throughput);
    assert.notEqual(low.queued, high.queued);
    assert.notEqual(low.p95LatencyMs, high.p95LatencyMs);
    assert.notEqual(low.cost, high.cost);
  }
});

function attachCache(architecture: ReturnType<typeof starterArchitecture>) {
  const cache = createNode("cache", architecture.nodes.length);
  const api = architecture.nodes.find((node) => node.type === "api-server")!;
  const database = architecture.nodes.find((node) => node.type === "primary-database")!;
  architecture.nodes.push(cache);
  architecture.edges.push(
    { id: crypto.randomUUID(), source: api.id, target: cache.id, weight: 100 },
    { id: crypto.randomUUID(), source: cache.id, target: database.id, weight: 100 },
  );
  return cache;
}

function capacitySnapshot(
  change: (node: ReturnType<typeof starterArchitecture>["nodes"][number]) => unknown,
) {
  const architecture = starterArchitecture();
  for (const node of architecture.nodes.filter((node) => node.type !== "client")) {
    node.config.replicas = 1;
    node.config.capacity = 10_000;
    node.config.concurrency = 100;
    node.config.serviceTimeMs = 32;
    change(node);
  }
  const scenario = {
    ...starterScenario,
    durationSeconds: 1,
    normalRps: 5000,
    spikeAtSecond: 99,
    availabilityTarget: 0,
    p95TargetMs: 1_000_000,
    throughputTarget: 0,
    costCeiling: 1000,
    incidents: [],
  };
  return runSimulation(architecture, scenario).snapshots[0]!;
}
