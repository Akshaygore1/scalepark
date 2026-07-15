import {
  architectureStorageKey,
  componentTypes,
  isArchitecture,
  starterArchitecture,
  type Architecture,
  type ComponentType,
} from "./architecture";
import type { Scenario, Snapshot } from "./simulation";

export const GAME_PROGRESS_VERSION = 1 as const;
export const gameProgressStorageKey = "scalelab:tycoon-progress";

export type GameMode = "campaign" | "sandbox";
export type GamePhase = "running" | "paused" | "failed" | "completed";
export type GameSpeed = 1 | 2 | 4;

export type AdvisorLesson = {
  concept: string;
  title: string;
  message: string;
  detail: string;
};

export type CampaignChapter = {
  id: string;
  number: number;
  name: string;
  strapline: string;
  concept: string;
  objective: string;
  startingCash: number;
  revenuePerRequest: number;
  economy: {
    reputationTarget: number;
    reputationGain: number;
    reliabilityLossMultiplier: number;
    latencyLossDivisor: number;
    minimumDemandMultiplier: number;
    maximumDemandMultiplier: number;
  };
  unlocked: ComponentType[];
  scenario: Scenario;
  lessons: AdvisorLesson[];
};

export type GameProgress = {
  version: typeof GAME_PROGRESS_VERSION;
  completedChapterIds: string[];
  encounteredConcepts: string[];
  legacyArchitecture?: Architecture;
};

export type TycoonState = {
  mode: GameMode;
  chapterId: string;
  phase: GamePhase;
  speed: GameSpeed;
  second: number;
  cash: number;
  reputation: number;
  activeUsers: number;
  revenue: number;
  operatingCost: number;
  eventLog: string[];
  encounteredConcepts: string[];
};

const baseTargets = {
  version: 1,
  availabilityTarget: 0.995,
  p95TargetMs: 240,
  throughputTarget: 0,
  costCeiling: 42,
  observeRecovery: true,
} as const;

export const campaignChapters: CampaignChapter[] = [
  chapter({
    id: "opening-day",
    number: 1,
    name: "Opening Day",
    strapline: "Your first links are leaving the building.",
    concept: "Capacity & queues",
    objective: "Keep 3,600 users moving through the park for 45 seconds.",
    startingCash: 18_000,
    revenuePerRequest: 0.018,
    unlocked: ["client", "api-server", "primary-database"],
    durationSeconds: 45,
    normalRps: 500,
    spikeRps: 3_600,
    spikeAtSecond: 18,
    throughputTarget: 3_200,
    lessons: [
      lesson(
        "queue",
        "A line is forming",
        "Requests arrived faster than one building could finish them.",
        "Capacity is work per second. Once demand exceeds it, requests wait in a queue and latency rises.",
      ),
    ],
  }),
  chapter({
    id: "first-spike",
    number: 2,
    name: "The First Spike",
    strapline: "A newsletter just found your tiny startup.",
    concept: "Horizontal scaling",
    objective: "Serve an 8,000 req/s spike without losing the crowd.",
    startingCash: 28_000,
    revenuePerRequest: 0.012,
    unlocked: ["client", "load-balancer", "api-server", "primary-database"],
    durationSeconds: 55,
    normalRps: 1_500,
    spikeRps: 8_000,
    spikeAtSecond: 20,
    throughputTarget: 7_300,
    lessons: [
      lesson(
        "scaling",
        "One server, one ceiling",
        "A second route can share the crowd, but new capacity takes time to deploy.",
        "Horizontal scaling adds replicas. A load balancer spreads requests so no single server carries the full spike.",
      ),
    ],
  }),
  chapter({
    id: "viral-link",
    number: 3,
    name: "The Viral Link",
    strapline: "Everyone wants the same short link at once.",
    concept: "Caching & hot keys",
    objective: "Absorb the hot-link wave and survive a cache interruption.",
    startingCash: 36_000,
    revenuePerRequest: 0.009,
    unlocked: ["client", "cdn", "load-balancer", "api-server", "cache", "primary-database"],
    durationSeconds: 64,
    normalRps: 3_000,
    spikeRps: 14_000,
    spikeAtSecond: 16,
    throughputTarget: 12_800,
    incidents: [
      { atSecond: 25, type: "hot-key", durationSeconds: 8 },
      { atSecond: 43, type: "cache-failure", durationSeconds: 5 },
    ],
    lessons: [
      lesson(
        "cache",
        "Popular data deserves a shortcut",
        "The database is repeating the same answer thousands of times.",
        "A cache serves repeated reads quickly, but expiry and failure can send the whole crowd back to the origin.",
      ),
    ],
  }),
  chapter({
    id: "cascading-trouble",
    number: 4,
    name: "Cascading Trouble",
    strapline: "Retries are turning a slowdown into a pile-up.",
    concept: "Backpressure & resilience",
    objective: "Control retries and drain the backlog after a database slowdown.",
    startingCash: 44_000,
    revenuePerRequest: 0.008,
    unlocked: [
      "client",
      "cdn",
      "load-balancer",
      "api-server",
      "cache",
      "primary-database",
      "queue",
      "worker",
    ],
    durationSeconds: 70,
    normalRps: 4_500,
    spikeRps: 16_000,
    spikeAtSecond: 18,
    throughputTarget: 14_800,
    incidents: [{ atSecond: 36, type: "database-slowdown", durationSeconds: 8 }],
    lessons: [
      lesson(
        "backpressure",
        "More retries, more pressure",
        "Failed work is returning faster than the database can recover.",
        "Timeouts, bounded retries, and queues protect a struggling dependency from an uncontrolled retry storm.",
      ),
    ],
  }),
  chapter({
    id: "global-launch",
    number: 5,
    name: "Global Launch",
    strapline: "Four regions. One launch. No quiet moments.",
    concept: "Regions & autoscaling",
    objective: "Complete the 18k req/s launch inside the reliability and cost targets.",
    startingCash: 58_000,
    revenuePerRequest: 0.007,
    unlocked: [...componentTypes],
    durationSeconds: 72,
    normalRps: 2_100,
    spikeRps: 18_000,
    spikeAtSecond: 12,
    throughputTarget: 17_100,
    availabilityTarget: 0.9995,
    p95TargetMs: 180,
    incidents: [
      { atSecond: 18, type: "hot-key", durationSeconds: 6 },
      { atSecond: 28, type: "cache-failure", durationSeconds: 5 },
      { atSecond: 38, type: "database-slowdown", durationSeconds: 5 },
      { atSecond: 52, type: "regional-latency", region: "us-east", durationSeconds: 5 },
    ],
    lessons: [
      lesson(
        "regions",
        "Distance is part of latency",
        "A healthy service can still feel slow when every request crosses an ocean.",
        "Regional placement and weighted routing trade cost and complexity for lower latency and better failure isolation.",
      ),
    ],
  }),
];

export const sandboxChapter: CampaignChapter = {
  ...campaignChapters[4]!,
  id: "sandbox",
  number: 0,
  name: "Sandbox Park",
  strapline: "Every building is unlocked. Make traffic, then make trouble.",
  concept: "Free experiment",
  objective: "Explore without a win condition.",
  startingCash: 250_000,
  unlocked: [...componentTypes],
  scenario: {
    ...campaignChapters[4]!.scenario,
    availabilityTarget: 0,
    throughputTarget: 0,
    costCeiling: 1_000_000,
  },
};

export const buildingCosts: Record<ComponentType, number> = {
  client: 0,
  cdn: 4_000,
  "load-balancer": 3_500,
  "api-server": 5_000,
  cache: 4_500,
  "primary-database": 7_000,
  "read-replica": 5_500,
  queue: 3_000,
  worker: 3_500,
};

export function chapterById(id: string): CampaignChapter {
  return id === sandboxChapter.id
    ? sandboxChapter
    : (campaignChapters.find((item) => item.id === id) ?? campaignChapters[0]!);
}

export function createTycoonState(mode: GameMode, chapterId?: string): TycoonState {
  const current = mode === "sandbox" ? sandboxChapter : chapterById(chapterId ?? "opening-day");
  return {
    mode,
    chapterId: current.id,
    phase: "paused",
    speed: 1,
    second: 0,
    cash: current.startingCash,
    reputation: 100,
    activeUsers: current.scenario.normalRps,
    revenue: 0,
    operatingCost: 0,
    eventLog: [mode === "sandbox" ? "Sandbox gates are open." : `${current.name} is ready.`],
    encounteredConcepts: [],
  };
}

export function advanceTycoonState(state: TycoonState, snapshot: Snapshot): TycoonState {
  if (state.phase !== "running") return state;
  const current = chapterById(state.chapterId);
  const earned = snapshot.throughput * current.revenuePerRequest;
  const spent = snapshot.cost / 60;
  const reliabilityLoss =
    Math.max(0, current.economy.reputationTarget - snapshot.availability) *
    current.economy.reliabilityLossMultiplier;
  const latencyLoss = Math.max(0, snapshot.p95LatencyMs - 300) / current.economy.latencyLossDivisor;
  const reputation = clamp(
    state.reputation +
      (reliabilityLoss + latencyLoss > 0
        ? -(reliabilityLoss + latencyLoss)
        : current.economy.reputationGain),
    0,
    100,
  );
  const second = Math.min(current.scenario.durationSeconds - 1, snapshot.second);
  const cash = state.cash + earned - spent;
  const failed = reputation <= 0 || cash < -2_000;
  return {
    ...state,
    second,
    cash,
    reputation,
    activeUsers: snapshot.offered,
    revenue: state.revenue + earned,
    operatingCost: state.operatingCost + spent,
    // The worker owns objective completion because it has the complete deterministic result.
    // Reaching the clock alone must never unlock a chapter that failed its SLOs.
    phase: failed ? "failed" : state.phase,
    eventLog: failed
      ? ["The park froze at the first critical business failure.", ...state.eventLog].slice(0, 8)
      : state.eventLog,
  };
}

export function demandForReputation(chapter: CampaignChapter, second: number, reputation: number) {
  const baseline =
    second >= chapter.scenario.spikeAtSecond
      ? chapter.scenario.spikeRps
      : chapter.scenario.normalRps;
  const qualityMultiplier =
    chapter.economy.minimumDemandMultiplier +
    (chapter.economy.maximumDemandMultiplier - chapter.economy.minimumDemandMultiplier) *
      (clamp(reputation, 0, 100) / 100);
  return Math.round(baseline * qualityMultiplier);
}

export function emptyGameProgress(): GameProgress {
  return { version: GAME_PROGRESS_VERSION, completedChapterIds: [], encounteredConcepts: [] };
}

export function restoreGameProgress(storage: Pick<Storage, "getItem">): GameProgress {
  const serialized = storage.getItem(gameProgressStorageKey);
  let progress = emptyGameProgress();
  if (serialized) {
    try {
      const candidate = JSON.parse(serialized) as Partial<GameProgress>;
      if (
        candidate.version === GAME_PROGRESS_VERSION &&
        Array.isArray(candidate.completedChapterIds) &&
        Array.isArray(candidate.encounteredConcepts)
      )
        progress = candidate as GameProgress;
    } catch {
      // Preserve invalid data and fall back to a clean local progress model.
    }
  }
  if (!progress.legacyArchitecture) {
    const legacy = storage.getItem(architectureStorageKey);
    if (legacy) {
      try {
        const candidate: unknown = JSON.parse(legacy);
        if (isArchitecture(candidate)) progress = { ...progress, legacyArchitecture: candidate };
      } catch {
        // Invalid legacy architecture remains owned by the original persistence contract.
      }
    }
  }
  return progress;
}

export function saveGameProgress(storage: Pick<Storage, "setItem">, progress: GameProgress) {
  storage.setItem(gameProgressStorageKey, JSON.stringify(progress));
}

export function initialArchitecture(progress?: GameProgress): Architecture {
  return structuredClone(progress?.legacyArchitecture ?? starterArchitecture());
}

type ChapterInput = Omit<CampaignChapter, "scenario" | "economy"> & {
  durationSeconds: number;
  normalRps: number;
  spikeRps: number;
  spikeAtSecond: number;
  throughputTarget: number;
  availabilityTarget?: number;
  p95TargetMs?: number;
  incidents?: Scenario["incidents"];
};

function chapter(input: ChapterInput): CampaignChapter {
  const {
    durationSeconds,
    normalRps,
    spikeRps,
    spikeAtSecond,
    throughputTarget,
    availabilityTarget,
    p95TargetMs,
    incidents,
    ...metadata
  } = input;
  return {
    ...metadata,
    economy: {
      reputationTarget: 0.995,
      reputationGain: 0.08,
      reliabilityLossMultiplier: 48,
      latencyLossDivisor: 900,
      minimumDemandMultiplier: 0.72,
      maximumDemandMultiplier: 1.18,
    },
    scenario: {
      ...baseTargets,
      durationSeconds,
      normalRps,
      spikeRps,
      spikeAtSecond,
      throughputTarget,
      availabilityTarget: availabilityTarget ?? baseTargets.availabilityTarget,
      p95TargetMs: p95TargetMs ?? baseTargets.p95TargetMs,
      incidents: incidents ?? [],
    },
  };
}

function lesson(concept: string, title: string, message: string, detail: string): AdvisorLesson {
  return { concept, title, message, detail };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
