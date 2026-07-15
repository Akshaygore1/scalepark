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

test("weighted load-balancer routes expose branch capacity with a fixed seed", () => {
  const mostlySlow = weightedApiArchitecture(90);
  const mostlyFast = weightedApiArchitecture(10);
  const scenario = permissiveScenario(1, 1000);

  const slowSnapshot = runSimulation(mostlySlow, scenario, [], 7).snapshots[0]!;
  const fastSnapshot = runSimulation(mostlyFast, scenario, [], 7).snapshots[0]!;

  assert.equal(slowSnapshot.throughput, 111);
  assert.equal(slowSnapshot.queued, 890);
  assert.equal(slowSnapshot.p95LatencyMs, 3448);
  assert.equal(fastSnapshot.throughput, 1000);
  assert.equal(fastSnapshot.queued, 1);
  assert.equal(fastSnapshot.p95LatencyMs, 80);
  assert.deepEqual(
    fastSnapshot.routeAllocations
      .filter((route) => route.weight !== 100)
      .map((route) => [route.weight, route.offered]),
    [
      [10, 100],
      [90, 901],
    ],
  );
  const slowApi = mostlyFast.nodes.find((node) => node.type === "api-server")!;
  const fastApi = mostlyFast.nodes.filter((node) => node.type === "api-server")[1]!;
  assert.equal(fastSnapshot.nodeHealth[slowApi.id], "saturated");
  assert.equal(fastSnapshot.nodeHealth[fastApi.id], "healthy");
});

test("cross-region paths add deterministic latency and educational routing cost", () => {
  const local = starterArchitecture();
  const remote = structuredClone(local);
  remote.nodes.find((node) => node.type === "primary-database")!.config.region = "ap-south";
  const scenario = permissiveScenario(1, 500);

  const localSnapshot = runSimulation(local, scenario, [], 11).snapshots[0]!;
  const firstRemote = runSimulation(remote, scenario, [], 11).snapshots[0]!;
  const secondRemote = runSimulation(remote, scenario, [], 11).snapshots[0]!;

  assert.deepEqual(firstRemote, secondRemote);
  assert.deepEqual(
    {
      networkLatencyMs: localSnapshot.networkLatencyMs,
      p95LatencyMs: localSnapshot.p95LatencyMs,
      regionalCost: localSnapshot.regionalCost,
      cost: localSnapshot.cost,
    },
    { networkLatencyMs: 6, p95LatencyMs: 80, regionalCost: 0.01, cost: 4.04 },
  );
  assert.deepEqual(
    {
      networkLatencyMs: firstRemote.networkLatencyMs,
      p95LatencyMs: firstRemote.p95LatencyMs,
      regionalCost: firstRemote.regionalCost,
      cost: firstRemote.cost,
    },
    { networkLatencyMs: 189, p95LatencyMs: 263, regionalCost: 0.19, cost: 4.22 },
  );
});

test("regional latency incidents affect routed paths and emit recovery evidence", () => {
  const architecture = starterArchitecture();
  architecture.nodes.find((node) => node.type === "primary-database")!.config.region = "eu-west";
  const scenario = {
    ...permissiveScenario(5, 500),
    p95TargetMs: 180,
    observeRecovery: true,
    incidents: [
      {
        atSecond: 1,
        type: "regional-latency" as const,
        region: "eu-west" as const,
        durationSeconds: 2,
      },
    ],
  };

  const result = runSimulation(architecture, scenario, [], 5);
  assert.equal(result.outcome, "failed");
  assert.deepEqual(
    {
      networkLatencyMs: result.snapshots[0]!.networkLatencyMs,
      availability: result.snapshots[0]!.availability,
      dropped: result.snapshots[0]!.dropped,
    },
    { networkLatencyMs: 86, availability: 1, dropped: 0 },
  );
  assert.deepEqual(
    {
      networkLatencyMs: result.snapshots[1]!.networkLatencyMs,
      availability: Number(result.snapshots[1]!.availability.toFixed(6)),
      dropped: result.snapshots[1]!.dropped,
      p95LatencyMs: result.snapshots[1]!.p95LatencyMs,
    },
    { networkLatencyMs: 206, availability: 0.978088, dropped: 11, p95LatencyMs: 280 },
  );
  assert.equal(result.snapshots[3]!.networkLatencyMs, 86);
  assert.ok(result.events.some((event) => event.type === "regional-latency"));
  assert.ok(result.events.some((event) => event.type === "slo-breach"));
  assert.ok(
    result.events.some(
      (event) => event.type === "recovery" && event.message.includes("eu-west"),
    ),
  );
  assert.ok(result.snapshots[1]!.routeAllocations.some((route) => route.affected));
});

test("reconverging weighted routes cannot exceed their shared database capacity", () => {
  const architecture = weightedApiArchitecture(50);
  const database = architecture.nodes.find((node) => node.type === "primary-database")!;
  database.config.capacity = 100;
  database.config.concurrency = 100;
  const snapshot = runSimulation(architecture, permissiveScenario(1, 1000), [], 7).snapshots[0]!;
  assert.equal(snapshot.throughput, 100);
  assert.equal(snapshot.databaseQueue, 901);
});

test("independent client request paths combine their routed capacity", () => {
  const architecture = starterArchitecture();
  const firstApi = architecture.nodes.find((node) => node.type === "api-server")!;
  const database = architecture.nodes.find((node) => node.type === "primary-database")!;
  const secondClient = createNode("client", architecture.nodes.length);
  const secondApi = createNode("api-server", architecture.nodes.length + 1);
  firstApi.config.capacity = 100;
  firstApi.config.concurrency = 100;
  secondApi.config.capacity = 100;
  secondApi.config.concurrency = 100;
  database.config.capacity = 20_000;
  database.config.concurrency = 1000;
  database.config.connectionLimit = 1000;
  architecture.nodes.push(secondClient, secondApi);
  architecture.edges.push(
    { id: crypto.randomUUID(), source: secondClient.id, target: secondApi.id, weight: 100 },
    { id: crypto.randomUUID(), source: secondApi.id, target: database.id, weight: 100 },
  );

  const snapshot = runSimulation(architecture, permissiveScenario(1, 1000), [], 7).snapshots[0]!;
  assert.equal(snapshot.throughput, 200);
  assert.equal(snapshot.queued, 801);
});

test("client paths that reconverge do not double-count shared API capacity", () => {
  const architecture = starterArchitecture();
  const sharedApi = architecture.nodes.find((node) => node.type === "api-server")!;
  const secondClient = createNode("client", architecture.nodes.length);
  sharedApi.config.capacity = 100;
  sharedApi.config.concurrency = 100;
  architecture.nodes.push(secondClient);
  architecture.edges.push({
    id: crypto.randomUUID(),
    source: secondClient.id,
    target: sharedApi.id,
    weight: 100,
  });

  const snapshot = runSimulation(architecture, permissiveScenario(1, 1000), [], 7).snapshots[0]!;
  assert.equal(snapshot.throughput, 100);
  assert.equal(snapshot.queued, 901);
});

test("cache hits can bypass a constrained database without bypassing transport limits", () => {
  const architecture = starterArchitecture();
  const cache = attachCache(architecture);
  const database = architecture.nodes.find((node) => node.type === "primary-database")!;
  cache.config.cacheSize = 1_000_000;
  cache.config.ttlSeconds = 1000;
  database.config.capacity = 100;
  database.config.concurrency = 100;
  database.config.connectionLimit = 1000;

  const snapshot = runSimulation(architecture, permissiveScenario(1, 1000), [], 7).snapshots[0]!;
  assert.ok(snapshot.cacheHitRate > 0.8);
  assert.ok(snapshot.throughput > database.config.capacity);
});

test("autoscaling capacity becomes active only after startup delay", () => {
  const architecture = autoscalingArchitecture({ startupDelaySeconds: 2, cooldownSeconds: 10 });
  const api = architecture.nodes.find((node) => node.type === "api-server")!;
  const result = runSimulation(architecture, permissiveScenario(4, 200), [], 3);

  assert.equal(result.snapshots[0]!.activeReplicas[api.id], 1);
  assert.equal(result.snapshots[0]!.throughput, 100);
  assert.equal(result.snapshots[0]!.pendingDeployments[0]?.readyAtSecond, 2);
  assert.equal(result.snapshots[1]!.activeReplicas[api.id], 1);
  assert.equal(result.snapshots[2]!.activeReplicas[api.id], 2);
  assert.equal(result.snapshots[2]!.throughput, 200);
  assert.ok(result.events.some((event) => event.type === "scale-out-requested"));
  assert.ok(result.events.some((event) => event.type === "deployment-applied"));
});

test("autoscaling reconciles initial replicas into configured minimum and maximum bounds", () => {
  const belowMinimum = autoscalingArchitecture({ startupDelaySeconds: 2, cooldownSeconds: 10 });
  const belowApi = belowMinimum.nodes.find((node) => node.type === "api-server")!;
  belowApi.config.autoscaling.minReplicas = 2;
  belowApi.config.autoscaling.maxReplicas = 3;
  const aboveMaximum = structuredClone(belowMinimum);
  const aboveApi = aboveMaximum.nodes.find((node) => node.id === belowApi.id)!;
  aboveApi.config.replicas = 5;

  assert.equal(
    runSimulation(belowMinimum, permissiveScenario(1, 10), [], 3).snapshots[0]!
      .activeReplicas[belowApi.id],
    2,
  );
  assert.equal(
    runSimulation(aboveMaximum, permissiveScenario(1, 10), [], 3).snapshots[0]!
      .activeReplicas[aboveApi.id],
    3,
  );
});

test("aggressive autoscaling deterministically oscillates with changing traffic", () => {
  const architecture = autoscalingArchitecture({ startupDelaySeconds: 1, cooldownSeconds: 0 });
  const api = architecture.nodes.find((node) => node.type === "api-server")!;
  const commands = [
    { atSecond: 0, type: "traffic" as const, rps: 60 },
    { atSecond: 1, type: "traffic" as const, rps: 10 },
    { atSecond: 2, type: "traffic" as const, rps: 60 },
    { atSecond: 3, type: "traffic" as const, rps: 10 },
  ];
  const result = runSimulation(architecture, permissiveScenario(4, 10), commands, 3);

  assert.deepEqual(
    result.snapshots.map((snapshot) => snapshot.activeReplicas[api.id]),
    [1, 2, 1, 2],
  );
  assert.deepEqual(
    result.events
      .filter((event) => ["scale-out-requested", "scale-in-requested"].includes(event.type))
      .map((event) => event.type),
    ["scale-out-requested", "scale-in-requested", "scale-out-requested", "scale-in-requested"],
  );
});

test("runtime configuration changes wait for their deployment delay", () => {
  const architecture = starterArchitecture();
  const api = architecture.nodes.find((node) => node.type === "api-server")!;
  api.config.capacity = 100;
  api.config.concurrency = 100;
  const commands = [
    {
      atSecond: 0,
      type: "configure" as const,
      nodeId: api.id,
      changes: { capacity: 300 },
      deploymentDelaySeconds: 2,
    },
  ];
  const result = runSimulation(architecture, permissiveScenario(3, 250), commands, 3);

  assert.equal(result.snapshots[0]!.nodeCapacity[api.id], 100);
  assert.equal(result.snapshots[1]!.nodeCapacity[api.id], 100);
  assert.equal(result.snapshots[2]!.nodeCapacity[api.id], 300);
  assert.equal(result.snapshots[2]!.throughput, 300);
  assert.ok(result.snapshots[2]!.queued < result.snapshots[1]!.queued);
});

test("removing active capacity after deployment attributes in-flight impact", () => {
  const architecture = starterArchitecture();
  const api = architecture.nodes.find((node) => node.type === "api-server")!;
  api.config.replicas = 2;
  api.config.capacity = 100;
  api.config.concurrency = 100;
  const commands = [
    {
      atSecond: 0,
      type: "capacity" as const,
      nodeId: api.id,
      replicaDelta: -1,
      deploymentDelaySeconds: 1,
    },
  ];
  const result = runSimulation(architecture, permissiveScenario(2, 150), commands, 3);

  assert.equal(result.snapshots[0]!.activeReplicas[api.id], 2);
  assert.equal(result.snapshots[0]!.throughput, 150);
  assert.equal(result.snapshots[1]!.activeReplicas[api.id], 1);
  assert.equal(result.snapshots[1]!.throughput, 100);
  assert.equal(result.snapshots[1]!.queued, 45);
  assert.equal(result.snapshots[1]!.dropped, 5);
  assert.ok(
    result.events.some(
      (event) =>
        event.type === "capacity-removed" &&
        event.nodeId === api.id &&
        event.message.includes("5 routed in-flight requests fail"),
    ),
  );
});

test("removing the final replica leaves the routed component with zero capacity", () => {
  const architecture = starterArchitecture();
  const api = architecture.nodes.find((node) => node.type === "api-server")!;
  const commands = [
    {
      atSecond: 0,
      type: "capacity" as const,
      nodeId: api.id,
      replicaDelta: -1,
      deploymentDelaySeconds: 1,
    },
  ];
  const result = runSimulation(architecture, permissiveScenario(2, 100), commands, 3);
  assert.equal(result.snapshots[1]!.activeReplicas[api.id], 0);
  assert.equal(result.snapshots[1]!.nodeCapacity[api.id], 0);
  assert.equal(result.snapshots[1]!.throughput, 0);
});

test("removing surplus capacity does not fabricate in-flight failures", () => {
  const architecture = starterArchitecture();
  const api = architecture.nodes.find((node) => node.type === "api-server")!;
  api.config.replicas = 10;
  api.config.capacity = 100;
  api.config.concurrency = 100;
  const commands = [
    {
      atSecond: 0,
      type: "capacity" as const,
      nodeId: api.id,
      replicaDelta: -1,
      deploymentDelaySeconds: 1,
    },
  ];
  const result = runSimulation(architecture, permissiveScenario(2, 100), commands, 3);
  assert.equal(result.snapshots[1]!.activeReplicas[api.id], 9);
  assert.equal(result.snapshots[1]!.dropped, 0);
  assert.ok(
    result.events.some(
      (event) =>
        event.type === "capacity-removed" &&
        event.message.includes("0 routed in-flight requests fail"),
    ),
  );
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

function weightedApiArchitecture(slowWeight: number) {
  const architecture = starterArchitecture();
  const cdn = architecture.nodes.find((node) => node.type === "cdn")!;
  const slowApi = architecture.nodes.find((node) => node.type === "api-server")!;
  const database = architecture.nodes.find((node) => node.type === "primary-database")!;
  const fastApi = createNode("api-server", architecture.nodes.length);
  const existingRoute = architecture.edges.find(
    (edge) => edge.source === cdn.id && edge.target === slowApi.id,
  )!;
  existingRoute.weight = slowWeight;
  slowApi.config.capacity = 100;
  slowApi.config.concurrency = 100;
  fastApi.config.capacity = 2000;
  fastApi.config.concurrency = 1000;
  database.config.capacity = 20_000;
  database.config.concurrency = 1000;
  database.config.connectionLimit = 1000;
  architecture.nodes.push(fastApi);
  architecture.edges.push(
    { id: crypto.randomUUID(), source: cdn.id, target: fastApi.id, weight: 100 - slowWeight },
    { id: crypto.randomUUID(), source: fastApi.id, target: database.id, weight: 100 },
  );
  return architecture;
}

function autoscalingArchitecture({
  startupDelaySeconds,
  cooldownSeconds,
}: {
  startupDelaySeconds: number;
  cooldownSeconds: number;
}) {
  const architecture = starterArchitecture();
  for (const node of architecture.nodes.filter((node) => node.type !== "client")) {
    node.config.capacity = 20_000;
    node.config.concurrency = 1000;
  }
  const api = architecture.nodes.find((node) => node.type === "api-server")!;
  api.config.capacity = 100;
  api.config.concurrency = 100;
  api.config.autoscaling = {
    enabled: true,
    threshold: 50,
    minReplicas: 1,
    maxReplicas: 2,
    startupDelaySeconds,
    cooldownSeconds,
  };
  return architecture;
}
