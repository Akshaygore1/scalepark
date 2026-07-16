import {
  architectureStorageKey,
  componentTypes,
  isArchitecture,
  starterArchitecture,
  type Architecture,
  type ComponentType,
} from "./architecture";
import { runSimulation, type Scenario, type Snapshot } from "./simulation";

export const GAME_PROGRESS_VERSION = 1 as const;
export const gameProgressStorageKey = "scalelab:tycoon-progress";
export const CAMPAIGN_SIMULATION_SEED = 730_241;

export type GameMode = "campaign" | "sandbox";
export type GamePhase = "running" | "paused" | "failed" | "completed";
export type GameSpeed = 1 | 2 | 4;

export type AdvisorLesson = {
  concept: string;
  title: string;
  message: string;
  detail: string;
  promptAtSecond?: number;
};

export type ChapterGuidanceRequirement =
  | {
      kind: "component";
      type: ComponentType;
      minimumReplicas: number;
      label: string;
    }
  | {
      kind: "route";
      source: ComponentType;
      target: ComponentType;
      label: string;
    }
  | { kind: "regions"; minimum: number; label: string }
  | { kind: "weighted-routing"; label: string };

export type ChapterGuidanceStatus = ChapterGuidanceRequirement & {
  complete: boolean;
};

export type CampaignChapter = {
  id: string;
  number: number;
  name: string;
  strapline: string;
  concept: string;
  objective: string;
  startingCash: number;
  completionReward: number;
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
  startingProfile: StartingArchitectureProfile;
  scenario: Scenario;
  lessons: AdvisorLesson[];
  guidance: ChapterGuidanceRequirement[];
};

export type StartingArchitectureProfile = {
  replicas: Partial<Record<ComponentType, number>>;
  cdnConcurrency?: number;
};

export type GameProgress = {
  version: typeof GAME_PROGRESS_VERSION;
  completedChapterIds: string[];
  encounteredConcepts: string[];
  claimedRewardChapterIds: string[];
  campaignPark?: CampaignParkState;
  legacyArchitecture?: Architecture;
};

export type CampaignParkState = {
  architecture: Architecture;
  cash: number;
  reputation: number;
  revenue: number;
  operatingCost: number;
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
    completionReward: 12_000,
    revenuePerRequest: 0.018,
    unlocked: ["client", "api-server", "primary-database"],
    startingProfile: { replicas: {} },
    durationSeconds: 45,
    normalRps: 500,
    spikeRps: 3_600,
    spikeAtSecond: 18,
    throughputTarget: 3_200,
    successRequirements: {
      minimumReplicas: { "api-server": 2, "primary-database": 2 },
    },
    guidance: [
      componentGuide("api-server", 2, "Run two API replicas"),
      componentGuide("primary-database", 2, "Run two database replicas"),
    ],
    lessons: [
      lesson(
        "queue",
        "A line is forming",
        "Requests arrived faster than one building could finish them.",
        "Capacity is work per second. Once demand exceeds it, requests wait in a queue and latency rises.",
        12,
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
    completionReward: 18_000,
    revenuePerRequest: 0.012,
    unlocked: ["client", "load-balancer", "api-server", "primary-database"],
    startingProfile: { replicas: {} },
    durationSeconds: 55,
    normalRps: 1_500,
    spikeRps: 8_000,
    spikeAtSecond: 20,
    throughputTarget: 7_300,
    successRequirements: {
      activeComponents: ["load-balancer"],
      minimumReplicas: { "api-server": 4, "primary-database": 4 },
      requiredRoutes: [
        { source: "client", target: "load-balancer" },
        { source: "load-balancer", target: "api-server" },
      ],
    },
    guidance: [
      componentGuide("load-balancer", 1, "Build a load balancer"),
      componentGuide("api-server", 4, "Scale the API tier to four replicas"),
      componentGuide("primary-database", 4, "Scale the database to four replicas"),
      routeGuide("client", "load-balancer", "Route clients through the load balancer"),
      routeGuide("load-balancer", "api-server", "Send balanced traffic to the API tier"),
    ],
    lessons: [
      lesson(
        "scaling",
        "One server, one ceiling",
        "A second route can share the crowd, but new capacity takes time to deploy.",
        "Horizontal scaling adds replicas. A load balancer spreads requests so no single server carries the full spike.",
        14,
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
    completionReward: 24_000,
    revenuePerRequest: 0.009,
    unlocked: ["client", "cdn", "load-balancer", "api-server", "cache", "primary-database"],
    startingProfile: {
      replicas: { cdn: 2, "api-server": 2, "primary-database": 2 },
      cdnConcurrency: 500,
    },
    durationSeconds: 64,
    normalRps: 3_000,
    spikeRps: 14_000,
    spikeAtSecond: 16,
    throughputTarget: 12_800,
    incidents: [
      { atSecond: 25, type: "hot-key", durationSeconds: 8 },
      { atSecond: 43, type: "cache-failure", durationSeconds: 5 },
    ],
    successRequirements: {
      activeComponents: ["cache"],
      minimumReplicas: { "api-server": 6, "primary-database": 6 },
      requiredRoutes: [
        { source: "api-server", target: "cache" },
        { source: "cache", target: "primary-database" },
      ],
    },
    guidance: [
      componentGuide("cache", 1, "Build a cache"),
      componentGuide("api-server", 6, "Scale the API tier to six replicas"),
      componentGuide("primary-database", 6, "Scale the database to six replicas"),
      routeGuide("api-server", "cache", "Route API traffic to the cache"),
      routeGuide("cache", "primary-database", "Route cache misses to the database"),
    ],
    lessons: [
      lesson(
        "cache",
        "Popular data deserves a shortcut",
        "The database is repeating the same answer thousands of times.",
        "A cache serves repeated reads quickly, but expiry and failure can send the whole crowd back to the origin.",
        10,
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
    completionReward: 32_000,
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
    startingProfile: {
      replicas: { "api-server": 3, "primary-database": 3 },
      cdnConcurrency: 500,
    },
    durationSeconds: 70,
    normalRps: 4_500,
    spikeRps: 16_000,
    spikeAtSecond: 18,
    throughputTarget: 14_800,
    incidents: [{ atSecond: 36, type: "database-slowdown", durationSeconds: 8 }],
    successRequirements: {
      activeComponents: ["queue", "worker"],
      requiredRoutes: [
        { source: "api-server", target: "queue" },
        { source: "queue", target: "worker" },
        { source: "worker", target: "primary-database" },
      ],
    },
    guidance: [
      componentGuide("queue", 1, "Build a queue"),
      componentGuide("worker", 1, "Build a worker"),
      routeGuide("api-server", "queue", "Route API work into the queue"),
      routeGuide("queue", "worker", "Connect the queue to a worker"),
      routeGuide("worker", "primary-database", "Connect the worker to the database"),
    ],
    lessons: [
      lesson(
        "backpressure",
        "More retries, more pressure",
        "Failed work is returning faster than the database can recover.",
        "Timeouts, bounded retries, and queues protect a struggling dependency from an uncontrolled retry storm.",
        12,
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
    completionReward: 50_000,
    revenuePerRequest: 0.007,
    unlocked: [...componentTypes],
    startingProfile: {
      replicas: { "api-server": 4, "primary-database": 4 },
      cdnConcurrency: 500,
    },
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
      {
        atSecond: 52,
        type: "regional-latency",
        region: "us-east",
        durationSeconds: 5,
      },
    ],
    successRequirements: {
      activeComponents: ["cache", "queue", "worker"],
      minimumRegions: 2,
      requireWeightedRouting: true,
    },
    guidance: [
      componentGuide("cache", 1, "Keep a cache in the request path"),
      componentGuide("queue", 1, "Protect writes with a queue"),
      componentGuide("worker", 1, "Drain queued work with a worker"),
      { kind: "regions", minimum: 2, label: "Deploy services in two regions" },
      { kind: "weighted-routing", label: "Split traffic with weighted routes" },
    ],
    lessons: [
      lesson(
        "regions",
        "Distance is part of latency",
        "A healthy service can still feel slow when every request crosses an ocean.",
        "Regional placement and weighted routing trade cost and complexity for lower latency and better failure isolation.",
        6,
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
  completionReward: 0,
  unlocked: [...componentTypes],
  startingProfile: { replicas: {} },
  guidance: [],
  scenario: {
    ...campaignChapters[4]!.scenario,
    availabilityTarget: 0,
    throughputTarget: 0,
    costCeiling: 1_000_000,
    successRequirements: undefined,
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

export function gameLevelById(id: string): CampaignChapter | undefined {
  return id === sandboxChapter.id
    ? sandboxChapter
    : campaignChapters.find((chapter) => chapter.id === id);
}

export function isGameLevelUnlocked(id: string, progress: GameProgress): boolean {
  if (id === sandboxChapter.id) return true;
  const chapterIndex = campaignChapters.findIndex((chapter) => chapter.id === id);
  if (chapterIndex < 0) return false;
  return (
    chapterIndex === 0 ||
    progress.completedChapterIds.includes(campaignChapters[chapterIndex - 1]!.id)
  );
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
  return {
    version: GAME_PROGRESS_VERSION,
    completedChapterIds: [],
    encounteredConcepts: [],
    claimedRewardChapterIds: [],
  };
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
      ) {
        const completedChapterIds = candidate.completedChapterIds.filter(
          (id): id is string => typeof id === "string",
        );
        progress = {
          version: GAME_PROGRESS_VERSION,
          completedChapterIds,
          encounteredConcepts: candidate.encounteredConcepts.filter(
            (concept): concept is string => typeof concept === "string",
          ),
          claimedRewardChapterIds: Array.isArray(candidate.claimedRewardChapterIds)
            ? candidate.claimedRewardChapterIds.filter((id): id is string => typeof id === "string")
            : completedChapterIds,
          ...(isCampaignParkState(candidate.campaignPark)
            ? { campaignPark: candidate.campaignPark }
            : {}),
          ...(candidate.legacyArchitecture && isArchitecture(candidate.legacyArchitecture)
            ? { legacyArchitecture: candidate.legacyArchitecture }
            : {}),
        };
      }
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

export function campaignParkForChapter(
  progress: GameProgress,
  chapter: CampaignChapter,
): CampaignParkState {
  if (progress.campaignPark) return structuredClone(progress.campaignPark);
  return {
    architecture: architectureForChapter(chapter),
    cash: chapter.startingCash,
    reputation: 100,
    revenue: 0,
    operatingCost: 0,
  };
}

export function completeCampaignChapter(
  progress: GameProgress,
  chapter: CampaignChapter,
  park: CampaignParkState,
): { progress: GameProgress; reward: number } {
  const reward = progress.claimedRewardChapterIds.includes(chapter.id)
    ? 0
    : chapter.completionReward;
  return {
    reward,
    progress: {
      ...progress,
      completedChapterIds: [...new Set([...progress.completedChapterIds, chapter.id])],
      claimedRewardChapterIds: [...new Set([...progress.claimedRewardChapterIds, chapter.id])],
      campaignPark: {
        ...structuredClone(park),
        cash: park.cash + reward,
      },
    },
  };
}

function isCampaignParkState(value: unknown): value is CampaignParkState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CampaignParkState>;
  return (
    isArchitecture(candidate.architecture) &&
    isFiniteNumber(candidate.cash) &&
    isFiniteNumber(candidate.reputation) &&
    isFiniteNumber(candidate.revenue) &&
    isFiniteNumber(candidate.operatingCost)
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Build the safe runway players receive before they make their first decision. */
export function architectureForChapter(chapter: CampaignChapter): Architecture {
  const base = starterArchitecture();
  const allowed = new Set(chapter.unlocked);
  const nodes = base.nodes
    .filter((node) => allowed.has(node.type))
    .map((node) => ({
      ...node,
      config: {
        ...node.config,
        replicas: chapter.startingProfile.replicas[node.type] ?? node.config.replicas,
        concurrency:
          node.type === "cdn"
            ? (chapter.startingProfile.cdnConcurrency ?? node.config.concurrency)
            : node.config.concurrency,
      },
    }));
  const ids = new Set(nodes.map((node) => node.id));
  let edges = base.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  const client = nodes.find((node) => node.type === "client");
  const api = nodes.find((node) => node.type === "api-server");
  if (client && api && !edges.some((edge) => edge.source === client.id)) {
    edges = [
      {
        id: crypto.randomUUID(),
        source: client.id,
        target: api.id,
        weight: 100,
      },
      ...edges,
    ];
  }
  return { ...base, name: `${chapter.name} park`, nodes, edges };
}

export function evaluateChapterGuidance(
  chapter: CampaignChapter,
  architecture: Architecture,
): ChapterGuidanceStatus[] {
  const nodesById = new Map(architecture.nodes.map((node) => [node.id, node]));
  const reachable = reachableNodeIds(architecture);
  return chapter.guidance.map((requirement) => {
    if (requirement.kind === "component") {
      const replicas = architecture.nodes
        .filter((node) => node.type === requirement.type)
        .reduce((total, node) => total + node.config.replicas, 0);
      return { ...requirement, complete: replicas >= requirement.minimumReplicas };
    }
    if (requirement.kind === "route") {
      const complete = architecture.edges.some((edge) => {
        const source = nodesById.get(edge.source);
        const target = nodesById.get(edge.target);
        return (
          source?.type === requirement.source &&
          target?.type === requirement.target &&
          reachable.has(source.id)
        );
      });
      return { ...requirement, complete };
    }
    if (requirement.kind === "regions") {
      const regions = new Set(
        architecture.nodes
          .filter((node) => node.type !== "client" && reachable.has(node.id))
          .map((node) => node.config.region),
      );
      return { ...requirement, complete: regions.size >= requirement.minimum };
    }
    return {
      ...requirement,
      complete: architecture.nodes.some((source) => {
        if (!reachable.has(source.id)) return false;
        const targetRegions = new Set(
          architecture.edges
            .filter((edge) => edge.source === source.id && edge.weight > 0)
            .map(
              (edge) => architecture.nodes.find((node) => node.id === edge.target)?.config.region,
            ),
        );
        return targetRegions.size >= 2;
      }),
    };
  });
}

/**
 * Campaigns must begin with a calm, lossless runway. This deliberately excludes
 * future incidents and lesson requirements: it checks only the state the player
 * inherits at second zero through the first pressure event.
 */
export function validateChapterStartingState(chapter: CampaignChapter) {
  const scenario: Scenario = {
    ...chapter.scenario,
    durationSeconds: chapter.scenario.spikeAtSecond,
    incidents: [],
    successRequirements: undefined,
  };
  const result = runSimulation(
    architectureForChapter(chapter),
    scenario,
    [],
    CAMPAIGN_SIMULATION_SEED,
  );
  const unsafe = result.snapshots.some(
    (snapshot) =>
      snapshot.queued > 0 ||
      snapshot.availability < scenario.availabilityTarget ||
      snapshot.p95LatencyMs > scenario.p95TargetMs,
  );
  return { safe: result.outcome === "passed" && !unsafe, result };
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
  successRequirements?: Scenario["successRequirements"];
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
    successRequirements,
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
      successRequirements,
    },
  };
}

function lesson(
  concept: string,
  title: string,
  message: string,
  detail: string,
  promptAtSecond?: number,
): AdvisorLesson {
  return { concept, title, message, detail, promptAtSecond };
}

function componentGuide(
  type: ComponentType,
  minimumReplicas: number,
  label: string,
): ChapterGuidanceRequirement {
  return { kind: "component", type, minimumReplicas, label };
}

function routeGuide(
  source: ComponentType,
  target: ComponentType,
  label: string,
): ChapterGuidanceRequirement {
  return { kind: "route", source, target, label };
}

function reachableNodeIds(architecture: Architecture) {
  const reachable = new Set<string>();
  const stack = architecture.nodes.filter((node) => node.type === "client").map((node) => node.id);
  while (stack.length > 0) {
    const nodeId = stack.pop()!;
    if (reachable.has(nodeId)) continue;
    reachable.add(nodeId);
    for (const edge of architecture.edges) {
      if (edge.source === nodeId) stack.push(edge.target);
    }
  }
  return reachable;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
