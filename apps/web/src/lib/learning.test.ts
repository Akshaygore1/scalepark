import assert from "node:assert/strict";
import test from "node:test";

import { createNode, starterArchitecture } from "./architecture";
import {
  initialLearningState,
  learningScenario,
  reduceLearningState,
  regionalLearningIncident,
} from "./learning";
import { runSimulation } from "./simulation";

test("pause and step preserve the learning timeline and recorded inputs", () => {
  let state = reduceLearningState(initialLearningState, {
    type: "start",
    architecture: starterArchitecture(),
  });
  state = reduceLearningState(state, { type: "tick" });
  state = reduceLearningState(state, { type: "pause" });
  state = reduceLearningState(state, { type: "traffic", rps: 2600 });
  const paused = state;
  state = reduceLearningState(state, { type: "tick" });
  assert.deepEqual(state, paused);
  state = reduceLearningState(state, { type: "step" });
  assert.equal(state.second, 2);
  assert.equal(state.phase, "paused");
  assert.equal(state.commands[0]?.atSecond, 1);
});

test("manual incidents reuse scripted incident semantics", () => {
  const architecture = starterArchitecture();
  architecture.nodes.find((node) => node.type === "primary-database")!.config.region = "eu-west";
  let state = reduceLearningState(initialLearningState, { type: "start", architecture });
  state = reduceLearningState(state, {
    type: "incident",
    incident: regionalLearningIncident("eu-west"),
  });
  const result = runSimulation(
    state.baseArchitecture!,
    learningScenario(state),
    state.commands,
    1,
  );
  assert.equal(result.snapshots[0]!.availability < 1, true);
  assert.ok(result.events.some((event) => event.type === "regional-latency"));
});

test("traffic setpoints persist and delayed learning deployments retain their delay", () => {
  const architecture = starterArchitecture();
  const api = architecture.nodes.find((node) => node.type === "api-server")!;
  api.config.capacity = 100;
  let state = reduceLearningState(initialLearningState, { type: "start", architecture });
  state = reduceLearningState(state, { type: "traffic", rps: 250 });
  state = reduceLearningState(state, {
    type: "deployment",
    command: {
      type: "configure",
      nodeId: api.id,
      changes: { capacity: 300 },
      deploymentDelaySeconds: 2,
    },
  });
  const result = runSimulation(
    state.baseArchitecture!,
    learningScenario(state),
    state.commands,
    1,
  );
  assert.equal(result.snapshots[0]!.offered, 251);
  assert.equal(result.snapshots[0]!.throughput, 100);
  assert.equal(result.snapshots[0]!.queued, 151);
  assert.equal(result.snapshots[1]!.offered, 251);
  assert.equal(result.snapshots[1]!.nodeCapacity[api.id], 100);
  assert.equal(result.snapshots[2]!.nodeCapacity[api.id], 300);
});

test("cache and database incidents retain scripted semantics and inject independently", () => {
  const cases = [
    {
      incident: { type: "cache-failure" as const, durationSeconds: 3 },
      prepare: (architecture: ReturnType<typeof starterArchitecture>) => {
        const cache = createNode("cache", architecture.nodes.length);
        const api = architecture.nodes.find((node) => node.type === "api-server")!;
        const database = architecture.nodes.find((node) => node.type === "primary-database")!;
        architecture.nodes.push(cache);
        architecture.edges.push(
          { id: crypto.randomUUID(), source: api.id, target: cache.id, weight: 100 },
          { id: crypto.randomUUID(), source: cache.id, target: database.id, weight: 100 },
        );
        return (result: ReturnType<typeof runSimulation>) => {
          assert.equal(result.snapshots[0]!.cacheHealth, "failed");
          assert.ok(result.events.some((event) => event.type === "cache-stampede"));
        };
      },
    },
    {
      incident: { type: "database-slowdown" as const, durationSeconds: 3 },
      prepare: (architecture: ReturnType<typeof starterArchitecture>) => {
        const database = architecture.nodes.find((node) => node.type === "primary-database")!;
        return (result: ReturnType<typeof runSimulation>) => {
          assert.equal(result.snapshots[0]!.nodeHealth[database.id], "heating");
          assert.ok(result.events.some((event) => event.type === "database-slowdown"));
        };
      },
    },
    {
      incident: { type: "database-failure" as const, durationSeconds: 3 },
      prepare: (architecture: ReturnType<typeof starterArchitecture>) => {
        const database = architecture.nodes.find((node) => node.type === "primary-database")!;
        return (result: ReturnType<typeof runSimulation>) => {
          assert.equal(result.snapshots[0]!.throughput, 0);
          assert.equal(result.snapshots[0]!.nodeHealth[database.id], "failed");
        };
      },
    },
  ];

  for (const fixture of cases) {
    const architecture = starterArchitecture();
    const verify = fixture.prepare(architecture);
    let state = reduceLearningState(initialLearningState, { type: "start", architecture });
    state = reduceLearningState(state, { type: "incident", incident: fixture.incident });
    verify(runSimulation(state.baseArchitecture!, learningScenario(state), state.commands, 1));
  }

  const architecture = starterArchitecture();
  let state = reduceLearningState(initialLearningState, { type: "start", architecture });
  state = reduceLearningState(state, {
    type: "incident",
    incident: { type: "database-slowdown", durationSeconds: 3 },
  });
  state = reduceLearningState(state, {
    type: "incident",
    incident: regionalLearningIncident("us-east"),
  });
  const combined = runSimulation(
    state.baseArchitecture!,
    learningScenario(state),
    state.commands,
    1,
  );
  assert.ok(combined.events.some((event) => event.type === "database-slowdown"));
  assert.ok(combined.events.some((event) => event.type === "regional-latency"));
});
