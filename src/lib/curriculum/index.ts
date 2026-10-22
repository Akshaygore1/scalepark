import { features, nodeTypes } from "../model";
import type { Scenario } from "../simulation";
import { foundations } from "./m01-foundations";
import { simpleSystem } from "./m02-simple-system";
import { caching } from "./m03-caching";
import { scalingServers } from "./m04-scaling-servers";
import { scalingDatabases } from "./m05-scaling-databases";
import { liveUpdates } from "./m06-live-updates";
import { backgroundJobs } from "./m07-background-jobs";
import { rateLimiting } from "./m08-rate-limiting";
import { growingBig } from "./m09-growing-big";
import { capstone } from "./m10-capstone";
import { clientsOnly } from "./parks";
import type { CurriculumModule, Level, SimLevel } from "./types";

export const curriculum: CurriculumModule[] = [
  foundations,
  simpleSystem,
  caching,
  scalingServers,
  scalingDatabases,
  liveUpdates,
  backgroundJobs,
  rateLimiting,
  growingBig,
  capstone,
];

export const levels: Level[] = curriculum.flatMap((module) => module.levels);

export const sandboxScenario: Scenario = {
  durationSeconds: 60,
  traffic: { redirects: [[0, 1_000]], creates: [[0, 20]], edits: [[0, 5]] },
  clicks: false,
  data: { linkRows: 5_000_000 },
};

export const sandboxLevel: SimLevel = {
  kind: "sim",
  id: "sandbox",
  module: 0,
  code: "Sandbox",
  title: "Sandbox Park",
  strapline: "Every building is unlocked. Make traffic, then make trouble.",
  concept: "Free experiment",
  brief: "Build anything, set the traffic, inject incidents, and watch what happens.",
  refresher: [],
  journal: { title: "", body: "", note: "" },
  unlocks: { nodes: nodeTypes.filter((type) => type !== "client"), features: [...features] },
  start: clientsOnly,
  scenario: sandboxScenario,
  targets: [],
  par: { monthly: Infinity, complexity: Infinity },
  hints: ["", "", ""],
};

export function levelById(id: string): Level | undefined {
  return id === sandboxLevel.id ? sandboxLevel : levels.find((level) => level.id === id);
}

export function nextLevel(id: string): Level | undefined {
  const index = levels.findIndex((level) => level.id === id);
  return index >= 0 ? levels[index + 1] : undefined;
}

export function moduleFor(level: Level) {
  return curriculum.find((module) => module.number === level.module);
}

export type { CurriculumModule, Level, SimLevel, QuizLevel, QuizStep, Lesson, Target } from "./types";
