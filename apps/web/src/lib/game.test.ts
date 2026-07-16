import assert from "node:assert/strict";
import test from "node:test";

import { starterArchitecture } from "./architecture";
import {
  advanceTycoonState,
  campaignChapters,
  createTycoonState,
  demandForReputation,
  emptyGameProgress,
  gameProgressStorageKey,
  isGameLevelUnlocked,
  restoreGameProgress,
  saveGameProgress,
} from "./game";
import { runSimulation } from "./simulation";

test("campaign chapters progressively unlock the complete component catalog", () => {
  assert.equal(campaignChapters.length, 5);
  assert.deepEqual(campaignChapters[0]?.unlocked, ["client", "api-server", "primary-database"]);
  assert.ok(campaignChapters[4]?.unlocked.includes("read-replica"));
  assert.equal(campaignChapters[4]?.scenario.spikeRps, 18_000);
});

test("game levels share one progression-aware unlock contract", () => {
  const progress = emptyGameProgress();
  assert.equal(isGameLevelUnlocked("opening-day", progress), true);
  assert.equal(isGameLevelUnlocked("sandbox", progress), true);
  assert.equal(isGameLevelUnlocked("first-spike", progress), false);
  assert.equal(isGameLevelUnlocked("missing-level", progress), false);

  assert.equal(
    isGameLevelUnlocked("first-spike", {
      ...progress,
      completedChapterIds: ["opening-day"],
    }),
    true,
  );
});

test("economy and reputation advance deterministically from snapshots", () => {
  const current = campaignChapters[0]!;
  const result = runSimulation(starterArchitecture(), current.scenario, [], 1);
  const initial = { ...createTycoonState("campaign"), phase: "running" as const };
  const first = advanceTycoonState(initial, result.snapshots[0]!);
  const replay = advanceTycoonState(initial, result.snapshots[0]!);
  assert.deepEqual(first, replay);
  assert.ok(first.cash > initial.cash);
  assert.equal(first.activeUsers, result.snapshots[0]!.offered);
});

test("service reputation deterministically changes future simulated demand", () => {
  const current = campaignChapters[0]!;
  const snapshot = runSimulation(starterArchitecture(), current.scenario, [], 1).snapshots[0]!;
  const initial = { ...createTycoonState("campaign"), phase: "running" as const };
  const damaged = advanceTycoonState(initial, {
    ...snapshot,
    availability: 0.5,
    p95LatencyMs: 4_000,
  });
  assert.ok(damaged.reputation < initial.reputation);
  assert.ok(
    demandForReputation(current, snapshot.second + 1, damaged.reputation) <
      demandForReputation(current, snapshot.second + 1, initial.reputation),
  );
  assert.ok(
    demandForReputation(current, snapshot.second + 1, initial.reputation) > snapshot.offered,
  );
});

test("reaching the chapter clock does not bypass objective validation", () => {
  const current = campaignChapters[0]!;
  const snapshot = runSimulation(starterArchitecture(), current.scenario, [], 1).snapshots.at(-1)!;
  const running = { ...createTycoonState("campaign"), phase: "running" as const };
  const atFinalTick = advanceTycoonState(running, snapshot);
  assert.equal(atFinalTick.phase, "running");
});

test("progress round trips and imports an existing architecture as a legacy sandbox", () => {
  const architecture = starterArchitecture();
  const data = new Map<string, string>([["scalelab:architecture", JSON.stringify(architecture)]]);
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
  const restored = restoreGameProgress(storage);
  assert.equal(restored.legacyArchitecture?.name, "Underpowered starter");
  saveGameProgress(storage, { ...restored, completedChapterIds: ["opening-day"] });
  assert.deepEqual(JSON.parse(data.get(gameProgressStorageKey)!).completedChapterIds, [
    "opening-day",
  ]);
});
