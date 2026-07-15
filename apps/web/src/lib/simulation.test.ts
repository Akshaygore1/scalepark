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

test("retries deterministically amplify database pressure after connection saturation", () => {
  const withoutRetries = starterArchitecture();
  const api = withoutRetries.nodes.find((node) => node.type === "api-server")!;
  const database = withoutRetries.nodes.find((node) => node.type === "primary-database")!;
  api.config.capacity = 20_000;
  api.config.concurrency = 1000;
  api.config.timeoutMs = 100;
  database.config.capacity = 20_000;
  database.config.concurrency = 1000;
  database.config.connectionLimit = 2;
  const withRetries = structuredClone(withoutRetries);
  withRetries.nodes.find((node) => node.type === "api-server")!.config.retries = 2;
  const scenario = permissiveScenario(1, 25_000);

  const baseline = runSimulation(withoutRetries, scenario).snapshots[0]!;
  const retried = runSimulation(withRetries, scenario).snapshots[0]!;
  assert.equal(retried.retryAttempts, baseline.databaseQueue * 2);
  assert.equal(retried.amplifiedLoad, retried.originLoad + retried.retryAttempts);
  assert.ok(retried.amplifiedLoad > baseline.amplifiedLoad);
  assert.ok(retried.p95LatencyMs > baseline.p95LatencyMs);
  assert.ok(retried.throughput < baseline.throughput);
  assert.ok(retried.dropped > baseline.dropped);
  assert.equal(retried.databaseConnections, 2);
});

test("shorter timeouts deterministically turn queued requests into attributed timeouts", () => {
  const shortTimeout = starterArchitecture();
  const api = shortTimeout.nodes.find((node) => node.type === "api-server")!;
  api.config.timeoutMs = 50;
  const longTimeout = structuredClone(shortTimeout);
  longTimeout.nodes.find((node) => node.type === "api-server")!.config.timeoutMs = 5000;
  const scenario = permissiveScenario(3, 5000);

  const shortResult = runSimulation(shortTimeout, scenario);
  const longResult = runSimulation(longTimeout, scenario);
  assert.ok(shortResult.snapshots[1]!.timedOut > longResult.snapshots[1]!.timedOut);
  assert.notEqual(shortResult.snapshots[1]!.p95LatencyMs, longResult.snapshots[1]!.p95LatencyMs);
});

test("database connection limits bound completions and expose a wait queue", () => {
  const constrained = starterArchitecture();
  const database = constrained.nodes.find((node) => node.type === "primary-database")!;
  database.config.connectionLimit = 2;
  database.config.capacity = 20_000;
  database.config.concurrency = 1000;
  const api = constrained.nodes.find((node) => node.type === "api-server")!;
  api.config.capacity = 20_000;
  api.config.concurrency = 1000;
  const roomy = structuredClone(constrained);
  roomy.nodes.find((node) => node.type === "primary-database")!.config.connectionLimit = 100;

  const low = runSimulation(constrained, permissiveScenario(1, 2000)).snapshots[0]!;
  const high = runSimulation(roomy, permissiveScenario(1, 2000)).snapshots[0]!;
  assert.ok(low.databaseQueue > high.databaseQueue);
  assert.ok(low.throughput < high.throughput);
  assert.equal(low.databaseConnections, 2);
});

test("database slowdown and failure propagate health transitions and recover", () => {
  const architecture = starterArchitecture();
  for (const node of architecture.nodes.filter((node) => node.type !== "client")) {
    node.config.capacity = 20_000;
    node.config.concurrency = 1000;
  }
  const database = architecture.nodes.find((node) => node.type === "primary-database")!;
  const scenario = {
    ...permissiveScenario(8, 500),
    incidents: [
      { atSecond: 1, type: "database-slowdown" as const, durationSeconds: 2 },
      { atSecond: 4, type: "database-failure" as const, durationSeconds: 2 },
    ],
  };
  const first = runSimulation(architecture, scenario);
  const second = runSimulation(architecture, scenario);

  assert.deepEqual(first, second);
  assert.equal(first.snapshots[1]!.nodeHealth[database.id], "heating");
  assert.equal(first.snapshots[4]!.nodeHealth[database.id], "failed");
  assert.equal(first.snapshots[4]!.throughput, 0);
  assert.equal(first.snapshots[6]!.nodeHealth[database.id], "recovered");
  assert.ok(first.snapshots[4]!.databaseQueue > first.snapshots[0]!.databaseQueue);
  assert.ok(first.snapshots[4]!.availability < first.snapshots[0]!.availability);
  assert.ok(first.events.some((event) => event.type === "database-slowdown"));
  assert.ok(first.events.some((event) => event.type === "database-failure"));
  assert.ok(first.events.some((event) => event.type === "recovery"));
});

test("finite queue and worker throughput create backlog and deterministic overflow", () => {
  const architecture = starterArchitecture();
  const api = architecture.nodes.find((node) => node.type === "api-server")!;
  const database = architecture.nodes.find((node) => node.type === "primary-database")!;
  const queue = createNode("queue", architecture.nodes.length);
  const worker = createNode("worker", architecture.nodes.length + 1);
  architecture.edges = architecture.edges.filter(
    (edge) => !(edge.source === api.id && edge.target === database.id),
  );
  architecture.nodes.push(queue, worker);
  architecture.edges.push(
    { id: crypto.randomUUID(), source: api.id, target: queue.id, weight: 100 },
    { id: crypto.randomUUID(), source: queue.id, target: worker.id, weight: 100 },
    { id: crypto.randomUUID(), source: worker.id, target: database.id, weight: 100 },
  );
  queue.config.queueCapacity = 50;
  worker.config.capacity = 100;
  worker.config.concurrency = 100;
  api.config.capacity = 20_000;
  api.config.concurrency = 1000;
  database.config.capacity = 20_000;
  database.config.concurrency = 1000;

  const result = runSimulation(architecture, permissiveScenario(2, 1000));
  const overflow = result.snapshots[0]!;
  assert.equal(overflow.queueBacklog, 50);
  assert.ok(overflow.droppedMessages > 0);
  assert.equal(overflow.dropped, overflow.droppedMessages);
  assert.equal(overflow.nodeHealth[queue.id], "saturated");
  assert.ok(result.events.some((event) => event.type === "queue-overflow"));
  assert.equal(
    overflow.offered,
    overflow.successful +
      overflow.queued +
      overflow.dropped +
      overflow.timedOut +
      overflow.inFlight,
  );
  for (let index = 1; index < result.snapshots.length; index += 1) {
    const current = result.snapshots[index]!;
    const previous = result.snapshots[index - 1]!;
    assert.equal(
      current.offered + previous.queued,
      current.successful +
        current.queued +
        current.dropped +
        current.timedOut +
        current.inFlight,
    );
    assert.ok(current.availability <= 1);
  }
});

test("a low-throughput async side branch does not throttle the direct request path", () => {
  const architecture = starterArchitecture();
  const api = architecture.nodes.find((node) => node.type === "api-server")!;
  const database = architecture.nodes.find((node) => node.type === "primary-database")!;
  const direct = architecture.edges.find(
    (edge) => edge.source === api.id && edge.target === database.id,
  )!;
  direct.weight = 99;
  const queue = createNode("queue", architecture.nodes.length);
  const worker = createNode("worker", architecture.nodes.length + 1);
  queue.config.queueCapacity = 1;
  worker.config.capacity = 1;
  worker.config.concurrency = 1;
  architecture.nodes.push(queue, worker);
  architecture.edges.push(
    { id: crypto.randomUUID(), source: api.id, target: queue.id, weight: 1 },
    { id: crypto.randomUUID(), source: queue.id, target: worker.id, weight: 100 },
    { id: crypto.randomUUID(), source: worker.id, target: database.id, weight: 100 },
  );

  const result = runSimulation(architecture, permissiveScenario(2, 1000));
  const snapshot = result.snapshots[0]!;
  assert.ok(snapshot.throughput > 900);
  assert.ok(snapshot.droppedMessages < 20);
  assert.equal(
    snapshot.offered,
    snapshot.successful +
      snapshot.queued +
      snapshot.dropped +
      snapshot.timedOut +
      snapshot.inFlight,
  );
  assert.ok(result.snapshots[1]!.availability > 0.9);
});

test("serial worker stages use the slowest path capacity instead of summing throughput", () => {
  const architecture = starterArchitecture();
  const api = architecture.nodes.find((node) => node.type === "api-server")!;
  const database = architecture.nodes.find((node) => node.type === "primary-database")!;
  const queue = createNode("queue", architecture.nodes.length);
  const slowWorker = createNode("worker", architecture.nodes.length + 1);
  const fastWorker = createNode("worker", architecture.nodes.length + 2);
  architecture.edges = architecture.edges.filter(
    (edge) => !(edge.source === api.id && edge.target === database.id),
  );
  queue.config.queueCapacity = 20_000;
  slowWorker.config.capacity = 1;
  slowWorker.config.concurrency = 1;
  fastWorker.config.capacity = 20_000;
  fastWorker.config.concurrency = 1000;
  architecture.nodes.push(queue, slowWorker, fastWorker);
  architecture.edges.push(
    { id: crypto.randomUUID(), source: api.id, target: queue.id, weight: 100 },
    { id: crypto.randomUUID(), source: queue.id, target: slowWorker.id, weight: 100 },
    { id: crypto.randomUUID(), source: slowWorker.id, target: fastWorker.id, weight: 100 },
    { id: crypto.randomUUID(), source: fastWorker.id, target: database.id, weight: 100 },
  );

  const snapshot = runSimulation(architecture, permissiveScenario(1, 1000)).snapshots[0]!;
  assert.equal(snapshot.throughput, 1);
  assert.ok(snapshot.queueBacklog > 900);
});

test("worker backpressure prevents queued messages from reappearing as database load", () => {
  const architecture = starterArchitecture();
  const api = architecture.nodes.find((node) => node.type === "api-server")!;
  const database = architecture.nodes.find((node) => node.type === "primary-database")!;
  const queue = createNode("queue", architecture.nodes.length);
  const worker = createNode("worker", architecture.nodes.length + 1);
  architecture.edges = architecture.edges.filter(
    (edge) => !(edge.source === api.id && edge.target === database.id),
  );
  worker.config.capacity = 1;
  worker.config.concurrency = 1;
  architecture.nodes.push(queue, worker);
  architecture.edges.push(
    { id: crypto.randomUUID(), source: api.id, target: queue.id, weight: 100 },
    { id: crypto.randomUUID(), source: queue.id, target: worker.id, weight: 100 },
    { id: crypto.randomUUID(), source: worker.id, target: database.id, weight: 100 },
  );

  const snapshots = runSimulation(architecture, permissiveScenario(2, 1000)).snapshots;
  assert.equal(snapshots[0]!.originLoad, 1);
  assert.equal(snapshots[1]!.originLoad, 1);
  assert.ok(snapshots[1]!.queueBacklog > 1000);
});

test("retry settings on each routed retry-capable stage affect amplification", () => {
  const architecture = starterArchitecture();
  const api = architecture.nodes.find((node) => node.type === "api-server")!;
  const database = architecture.nodes.find((node) => node.type === "primary-database")!;
  const queue = createNode("queue", architecture.nodes.length);
  const worker = createNode("worker", architecture.nodes.length + 1);
  architecture.edges = architecture.edges.filter(
    (edge) => !(edge.source === api.id && edge.target === database.id),
  );
  api.config.retries = 1;
  worker.config.retries = 1;
  architecture.nodes.push(queue, worker);
  architecture.edges.push(
    { id: crypto.randomUUID(), source: api.id, target: queue.id, weight: 100 },
    { id: crypto.randomUUID(), source: queue.id, target: worker.id, weight: 100 },
    { id: crypto.randomUUID(), source: worker.id, target: database.id, weight: 100 },
  );
  const moreApiRetries = structuredClone(architecture);
  moreApiRetries.nodes.find((node) => node.id === api.id)!.config.retries = 10;
  const scenario = {
    ...permissiveScenario(1, 100),
    incidents: [{ atSecond: 0, type: "database-failure" as const, durationSeconds: 1 }],
  };

  const baseline = runSimulation(architecture, scenario).snapshots[0]!;
  const amplified = runSimulation(moreApiRetries, scenario).snapshots[0]!;
  assert.ok(amplified.retryAttempts > baseline.retryAttempts);
  assert.ok(amplified.amplifiedLoad > baseline.amplifiedLoad);
  assert.ok(amplified.p95LatencyMs > baseline.p95LatencyMs);
});

test("parallel worker health uses each branch's routed demand", () => {
  const architecture = starterArchitecture();
  const api = architecture.nodes.find((node) => node.type === "api-server")!;
  const database = architecture.nodes.find((node) => node.type === "primary-database")!;
  const queue = createNode("queue", architecture.nodes.length);
  const firstWorker = createNode("worker", architecture.nodes.length + 1);
  const secondWorker = createNode("worker", architecture.nodes.length + 2);
  architecture.edges = architecture.edges.filter(
    (edge) => !(edge.source === api.id && edge.target === database.id),
  );
  architecture.nodes.push(queue, firstWorker, secondWorker);
  architecture.edges.push(
    { id: crypto.randomUUID(), source: api.id, target: queue.id, weight: 100 },
    { id: crypto.randomUUID(), source: queue.id, target: firstWorker.id, weight: 50 },
    { id: crypto.randomUUID(), source: queue.id, target: secondWorker.id, weight: 50 },
    { id: crypto.randomUUID(), source: firstWorker.id, target: database.id, weight: 100 },
    { id: crypto.randomUUID(), source: secondWorker.id, target: database.id, weight: 100 },
  );

  const snapshot = runSimulation(architecture, permissiveScenario(1, 1000)).snapshots[0]!;
  assert.equal(snapshot.queueBacklog, 0);
  assert.equal(snapshot.nodeHealth[firstWorker.id], "healthy");
  assert.equal(snapshot.nodeHealth[secondWorker.id], "healthy");
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

function permissiveScenario(durationSeconds: number, normalRps: number) {
  return {
    ...starterScenario,
    durationSeconds,
    normalRps,
    spikeAtSecond: 99,
    availabilityTarget: 0,
    p95TargetMs: 10_000_000,
    throughputTarget: 0,
    costCeiling: 1000,
    incidents: [],
  };
}
