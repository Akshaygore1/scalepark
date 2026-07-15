import assert from "node:assert/strict";
import test from "node:test";

import { starterArchitecture } from "./architecture";
import { explainFailure, runSimulation } from "./simulation";

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
