import assert from "node:assert/strict";
import test from "node:test";

import { starterArchitecture } from "./architecture";
import {
  ATTEMPT_HISTORY_VERSION,
  attemptHistoryStorageKey,
  createAttempt,
  emptyAttemptHistory,
  recordAttempt,
  requestNextHint,
  restoreAttemptHistory,
  saveAttemptHistory,
} from "./attempts";
import { runScoredChallenge } from "./challenge";

test("progressive hints apply each published penalty exactly once", () => {
  const architecture = starterArchitecture();
  const result = runScoredChallenge(architecture);
  const base = result.score.total;
  let attempt = createAttempt({
    id: "attempt-1",
    completedAt: "2026-07-15T12:00:00.000Z",
    architecture,
    result,
  });

  attempt = requestNextHint(attempt);
  assert.deepEqual(attempt.requestedHints, ["symptom"]);
  assert.equal(attempt.score.penalties.hints, 25);
  assert.equal(attempt.score.total, Math.max(0, base - 25));

  attempt = requestNextHint(attempt);
  assert.deepEqual(attempt.requestedHints, ["symptom", "subsystem"]);
  assert.equal(attempt.score.penalties.hints, 75);
  assert.equal(attempt.score.total, Math.max(0, base - 75));

  attempt = requestNextHint(attempt);
  assert.deepEqual(attempt.requestedHints, ["symptom", "subsystem", "strategy"]);
  assert.equal(attempt.score.penalties.hints, 175);
  assert.equal(attempt.score.total, Math.max(0, base - 175));

  assert.deepEqual(requestNextHint(attempt), attempt);
});

test("attempt history restores complete replay data and recalculates the best score", () => {
  const storage = memoryStorage();
  const first = completedAttempt("attempt-1", "2026-07-15T12:00:00.000Z");
  const hinted = requestNextHint(completedAttempt("attempt-2", "2026-07-15T12:01:00.000Z"));
  const history = recordAttempt(recordAttempt(emptyAttemptHistory(), first), hinted);

  saveAttemptHistory(storage, history);
  const restored = restoreAttemptHistory(storage);

  assert.equal(restored.version, ATTEMPT_HISTORY_VERSION);
  assert.equal(restored.attempts.length, 2);
  assert.equal(restored.bestScore, Math.max(first.score.total, hinted.score.total));
  assert.deepEqual(restored.attempts[0]?.architecture, hinted.architecture);
  assert.deepEqual(restored.attempts[0]?.score, hinted.score);
  assert.deepEqual(restored.attempts[0]?.requestedHints, hinted.requestedHints);
  assert.equal(JSON.stringify(restored.attempts[0]?.replay), JSON.stringify(hinted.replay));
  assert.equal(restored.attempts[0]?.architectureVersion, 1);
  assert.equal(restored.attempts[0]?.scenarioVersion, 1);
  assert.equal(restored.attempts[0]?.seed, hinted.seed);
  assert.equal(restored.attempts[0]?.outcome, hinted.outcome);
});

test("a retry inherits revealed hints and applies their penalties once", () => {
  const architecture = starterArchitecture();
  const result = runScoredChallenge(architecture);
  let source = createAttempt({
    id: "source",
    completedAt: "2026-07-15T12:00:00.000Z",
    architecture,
    result,
  });
  source = requestNextHint(requestNextHint(source));

  const retry = createAttempt({
    id: "retry",
    completedAt: "2026-07-15T12:01:00.000Z",
    architecture,
    result,
    requestedHints: source.requestedHints,
  });

  assert.deepEqual(retry.requestedHints, ["symptom", "subsystem"]);
  assert.equal(retry.score.penalties.hints, 75);
  assert.equal(retry.score.total, Math.max(0, result.score.total - 75));
});

test("updating an existing attempt applies a hint once without duplicating history", () => {
  const original = completedAttempt("attempt-1", "2026-07-15T12:00:00.000Z");
  const history = recordAttempt(emptyAttemptHistory(), original);
  const updated = requestNextHint(original);
  const next = recordAttempt(history, updated);

  assert.equal(next.attempts.length, 1);
  assert.equal(next.attempts[0]?.score.penalties.hints, 25);
  assert.equal(next.bestScore, updated.score.total);
});

test("invalid stored history is ignored without replacing the local contract", () => {
  const storage = memoryStorage();
  storage.setItem(attemptHistoryStorageKey, JSON.stringify({ version: 999, attempts: [] }));
  assert.deepEqual(restoreAttemptHistory(storage), emptyAttemptHistory());
});

function completedAttempt(id: string, completedAt: string) {
  const architecture = starterArchitecture();
  return createAttempt({
    id,
    completedAt,
    architecture,
    result: runScoredChallenge(architecture),
  });
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}
