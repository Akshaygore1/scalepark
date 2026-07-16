import { isArchitecture, type Architecture } from "./architecture";
import { applyHintPenalty, type ChallengeScore, type ScoredChallengeResult } from "./challenge";
import type { SimulationResult } from "./simulation";

export const ATTEMPT_HISTORY_VERSION = 1 as const;
export const attemptHistoryStorageKey = "scalelab:attempt-history";

export const hintLevels = ["symptom", "subsystem", "strategy"] as const;
export type HintLevel = (typeof hintLevels)[number];

export type Hint = {
  level: HintLevel;
  label: string;
  penalty: number;
  text: string;
};

export type Attempt = {
  id: string;
  completedAt: string;
  architectureVersion: number;
  scenarioVersion: number;
  seed: number;
  outcome: SimulationResult["outcome"];
  score: ChallengeScore;
  requestedHints: HintLevel[];
  architecture: Architecture;
  replay: SimulationResult;
};

export type AttemptHistory = {
  version: typeof ATTEMPT_HISTORY_VERSION;
  bestScore: number | null;
  attempts: Attempt[];
};

export type AttemptStorage = Pick<Storage, "getItem" | "setItem">;

const hintRubric: Record<HintLevel, Omit<Hint, "level" | "text">> = {
  symptom: { label: "Symptom", penalty: 25 },
  subsystem: { label: "Implicated subsystem", penalty: 50 },
  strategy: { label: "Possible strategy", penalty: 100 },
};

export function emptyAttemptHistory(): AttemptHistory {
  return { version: ATTEMPT_HISTORY_VERSION, bestScore: null, attempts: [] };
}

export function createAttempt(input: {
  id: string;
  completedAt: string;
  architecture: Architecture;
  result: ScoredChallengeResult;
  requestedHints?: HintLevel[];
}): Attempt {
  const requestedHints = input.requestedHints ?? [];
  return {
    id: input.id,
    completedAt: input.completedAt,
    architectureVersion: input.result.simulation.architectureVersion,
    scenarioVersion: input.result.simulation.scenarioVersion,
    seed: input.result.seed,
    outcome: input.result.simulation.outcome,
    score: scoreWithHints(input.result.score, requestedHints),
    requestedHints: [...requestedHints],
    architecture: structuredClone(input.architecture),
    replay: structuredClone(input.result.simulation),
  };
}

export function requestNextHint(attempt: Attempt): Attempt {
  const nextLevel = hintLevels.find((level) => !attempt.requestedHints.includes(level));
  if (!nextLevel) return attempt;
  const requestedHints = [...attempt.requestedHints, nextLevel];
  return {
    ...attempt,
    requestedHints,
    score: scoreWithHints(attempt.score, requestedHints),
  };
}

export function revealedHints(attempt: Attempt): Hint[] {
  return attempt.requestedHints.map((level) => ({
    level,
    ...hintRubric[level],
    text: hintText(attempt, level),
  }));
}

export function nextHintPreview(attempt: Attempt): Omit<Hint, "text"> | null {
  const level = hintLevels.find((candidate) => !attempt.requestedHints.includes(candidate));
  return level ? { level, ...hintRubric[level] } : null;
}

export function recordAttempt(history: AttemptHistory, attempt: Attempt): AttemptHistory {
  const attempts = [
    attempt,
    ...history.attempts.filter((candidate) => candidate.id !== attempt.id),
  ].sort((left, right) => right.completedAt.localeCompare(left.completedAt));
  return {
    version: ATTEMPT_HISTORY_VERSION,
    attempts,
    bestScore: attempts.length > 0 ? Math.max(...attempts.map((item) => item.score.total)) : null,
  };
}

export function saveAttemptHistory(storage: AttemptStorage, history: AttemptHistory) {
  storage.setItem(attemptHistoryStorageKey, JSON.stringify(history));
}

export function restoreAttemptHistory(storage: AttemptStorage): AttemptHistory {
  const serialized = storage.getItem(attemptHistoryStorageKey);
  if (!serialized) return emptyAttemptHistory();
  try {
    const candidate: unknown = JSON.parse(serialized);
    return isAttemptHistory(candidate) ? candidate : emptyAttemptHistory();
  } catch {
    return emptyAttemptHistory();
  }
}

function scoreWithHints(score: ChallengeScore, requestedHints: HintLevel[]): ChallengeScore {
  const hints = [...new Set(requestedHints)].reduce(
    (total, level) => total + hintRubric[level].penalty,
    0,
  );
  return applyHintPenalty(score, hints);
}

function hintText(attempt: Attempt, level: HintLevel) {
  const breach = attempt.replay.events.find((event) => event.type === "slo-breach");
  const snapshot =
    attempt.replay.snapshots.find((item) => item.second === breach?.second) ??
    attempt.replay.snapshots.at(-1);
  const saturated = attempt.architecture.nodes.find(
    (node) => node.id === attempt.replay.firstSaturatedNodeId,
  );
  if (level === "symptom") {
    return snapshot
      ? `At ${String(snapshot.second).padStart(2, "0")}:00, availability was ${(snapshot.availability * 100).toFixed(2)}%, p95 latency was ${snapshot.p95LatencyMs}ms, and ${snapshot.queued.toLocaleString()} requests were queued.`
      : "The run breached an objective before producing a usable snapshot.";
  }
  if (level === "subsystem") {
    return saturated
      ? `${saturated.label} was the first saturated component; downstream symptoms followed it.`
      : "No first saturated component was recorded; inspect network and incident evidence.";
  }
  return saturated
    ? `Test a bounded change to ${saturated.label}'s capacity, concurrency, routing, or upstream demand, then compare the replay and cost trade-off.`
    : "Test one bounded resilience or routing change at a time and compare the replay evidence.";
}

function isAttemptHistory(value: unknown): value is AttemptHistory {
  if (!value || typeof value !== "object") return false;
  const candidate = value as AttemptHistory;
  return (
    candidate.version === ATTEMPT_HISTORY_VERSION &&
    (candidate.bestScore === null || typeof candidate.bestScore === "number") &&
    Array.isArray(candidate.attempts) &&
    candidate.attempts.every(isAttempt)
  );
}

function isAttempt(value: unknown): value is Attempt {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Attempt;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.completedAt === "string" &&
    typeof candidate.architectureVersion === "number" &&
    typeof candidate.scenarioVersion === "number" &&
    typeof candidate.seed === "number" &&
    ["passed", "failed", "invalid"].includes(candidate.outcome) &&
    isArchitecture(candidate.architecture) &&
    isChallengeScore(candidate.score) &&
    Array.isArray(candidate.requestedHints) &&
    candidate.requestedHints.every((level) => hintLevels.includes(level)) &&
    isReplay(candidate.replay)
  );
}

function isChallengeScore(value: unknown): value is ChallengeScore {
  if (!value || typeof value !== "object") return false;
  const score = value as ChallengeScore;
  return (
    typeof score.total === "number" &&
    Array.isArray(score.factors) &&
    typeof score.penalties?.overprovisioning === "number" &&
    typeof score.penalties?.hints === "number" &&
    typeof score.estimatedCost === "number" &&
    typeof score.disclaimer === "string"
  );
}

function isReplay(value: unknown): value is SimulationResult {
  if (!value || typeof value !== "object") return false;
  const replay = value as SimulationResult;
  return (
    Array.isArray(replay.snapshots) &&
    Array.isArray(replay.events) &&
    ["passed", "failed", "invalid"].includes(replay.outcome) &&
    typeof replay.seed === "number" &&
    typeof replay.architectureVersion === "number" &&
    typeof replay.scenarioVersion === "number"
  );
}
