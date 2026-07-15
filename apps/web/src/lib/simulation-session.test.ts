import assert from "node:assert/strict";
import test from "node:test";

import { createNode, starterArchitecture } from "./architecture";
import {
  createSimulationSession,
  runSimulation,
  starterScenario,
  stepSimulation,
} from "./simulation";

test("stepping a deterministic session reproduces the complete run", () => {
  const architecture = starterArchitecture();
  const complete = runSimulation(architecture, starterScenario, [], 77);
  let session = createSimulationSession({ architecture, scenario: starterScenario, seed: 77 });
  const snapshots = [];
  while (snapshots.length < complete.snapshots.length) {
    const step = stepSimulation(session);
    session = step.session;
    if (step.snapshot) snapshots.push(step.snapshot);
    if (step.complete) break;
  }
  assert.deepEqual(snapshots, complete.snapshots);
});

test("session commands deterministically rebuild the remaining timeline", () => {
  const architecture = starterArchitecture();
  const session = createSimulationSession({ architecture, scenario: starterScenario, seed: 12 });
  const command = { atSecond: 0, type: "traffic" as const, rps: 900 };
  const first = stepSimulation(session, [command]);
  const replay = stepSimulation(
    createSimulationSession({ architecture, scenario: starterScenario, seed: 12 }),
    [command],
  );
  assert.deepEqual(first.snapshot, replay.snapshot);
});

test("topology commands activate after their deployment delay without rewriting history", () => {
  const architecture = starterArchitecture();
  const cache = createNode("cache", architecture.nodes.length);
  let session = createSimulationSession({ architecture, scenario: starterScenario, seed: 4 });
  session = stepSimulation(session, [
    {
      atSecond: 0,
      type: "add-node",
      node: cache,
      deploymentDelaySeconds: 2,
    },
  ]).session;
  const originalFirst = session.result.snapshots[0];
  session = stepSimulation(session).session;
  assert.ok(!session.architecture.nodes.some((node) => node.id === cache.id));
  session = stepSimulation(session).session;
  assert.ok(session.architecture.nodes.some((node) => node.id === cache.id));
  assert.deepEqual(session.result.snapshots[0], originalFirst);
});
