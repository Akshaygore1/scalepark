import type { Architecture, Feature, NodeType } from "../model";
import type { ServiceScenario } from "../services";
import type { Scenario } from "../simulation";

/** A short explanation from Mina, the park's systems coach. */
export type Lesson = { title: string; body: string; note: string };

export type QuizOption = { label: string; correct: boolean; explanation: string };
export type QuizStep = {
  prompt: string;
  context?: string;
  table?: { headers: string[]; rows: string[][] };
  options: QuizOption[];
};

export type Target =
  | { kind: "availability"; min: number }
  | { kind: "p95"; maxMs: number }
  | { kind: "peak-p95"; maxMs: number }
  | { kind: "budget"; maxMonthly: number }
  | { kind: "stale-reads"; max: number }
  | { kind: "not-found"; max: number }
  | { kind: "lost-writes"; max: number }
  | { kind: "lost-links"; max: number }
  | { kind: "duplicates"; max: number }
  | { kind: "logged-out"; max: number }
  | { kind: "bots-passed"; maxRps: number }
  | { kind: "viewers-connected"; min: number }
  | { kind: "freshness"; maxSeconds: number }
  | { kind: "missed-updates"; max: number }
  | { kind: "analytics-delay"; maxSeconds: number }
  | { kind: "backlog-drained" }
  /** Availability of one operation in a park of services, such as redirects or sign-ups. */
  | { kind: "operation-availability"; operation: string; label: string; min: number }
  | { kind: "clicks-lost"; max: number }
  | { kind: "double-claims"; max: number };

type LevelBase = {
  id: string;
  module: number;
  code: string;
  title: string;
  strapline: string;
  concept: string;
  /** Mina's refresher before the level, one card at a time. */
  refresher: Lesson[];
  /** The note added to the journal when the level is passed. */
  journal: Lesson;
};

export type SimLevel = LevelBase & {
  kind: "sim";
  brief: string;
  unlocks: { nodes: NodeType[]; features: Feature[] };
  start: () => Architecture;
  scenario: Scenario | ServiceScenario;
  targets: Target[];
  /** Stars two and three: stay within the cost and complexity of a lean solution. */
  par: { monthly: number; complexity: number };
  hints: [symptom: string, subsystem: string, strategy: string];
  /** Exact steps from the starting park, revealed only after all three hints. */
  finalHint: string[];
  /** Design questions answered before the first run. */
  before?: QuizStep[];
  /** Questions answered after passing, scored on the capstone. */
  after?: QuizStep[];
  capstone?: boolean;
};

export type QuizLevel = LevelBase & { kind: "quiz"; steps: QuizStep[] };

export type Level = SimLevel | QuizLevel;

export type CurriculumModule = { number: number; title: string; summary: string; levels: Level[] };
