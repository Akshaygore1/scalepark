import {
  architectureStorageKey,
  componentTypes,
  databaseCapacityLevel,
  databaseUpgrade,
  trafficPurposeForConnection,
  isArchitecture,
  starterArchitecture,
  type Architecture,
  type ComponentType,
} from "./architecture";
import { runSimulation, type Scenario, type Snapshot } from "./simulation";

export const GAME_PROGRESS_VERSION = 2 as const;
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
};

export type ChapterGuidanceRequirement =
  | {
      kind: "component";
      type: ComponentType;
      minimumReplicas: number;
      label: string;
      hint: string;
    }
  | { kind: "component-count"; type: ComponentType; minimum: number; label: string; hint: string }
  | {
      kind: "route";
      source: ComponentType;
      target: ComponentType;
      label: string;
      hint: string;
    }
  | { kind: "no-route"; source: ComponentType; target: ComponentType; label: string; hint: string }
  | { kind: "database-upgrade"; minimumLevel: number; label: string; hint: string }
  | { kind: "retries-disabled"; label: string; hint: string }
  | { kind: "regions"; minimum: number; label: string; hint: string }
  | { kind: "weighted-routing"; label: string; hint: string };

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
  refresher: AdvisorLesson[];
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
      minimumReplicas: { "api-server": 2 },
      minimumDatabaseLevel: 2,
    },
    guidance: [
      componentGuide(
        "api-server",
        2,
        "Extra API capacity helps absorb sudden traffic.",
        "Run two API replicas",
      ),
      databaseUpgradeGuide(2, "A larger database keeps storage from becoming the next queue.", "Upgrade database capacity once"),
    ],
    refresher: [
      refresher(
        "api-server",
        "Start with the request path",
        "Clients send requests to API servers. Each server has a finite amount of work it can complete every second.",
        "When traffic exceeds that capacity, requests wait. Add API replicas to increase the work your park can handle in parallel.",
      ),
      refresher(
        "primary-database",
        "Protect the data tier",
        "API requests eventually need durable data. Your database is another capacity limit in the path.",
        "Upgrade the primary database's capacity. A writable primary scales differently from stateless API servers.",
      ),
    ],
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
      minimumReplicas: { "api-server": 4 },
      requiredRoutes: [
        { source: "client", target: "load-balancer" },
        { source: "load-balancer", target: "api-server" },
      ],
      forbiddenRoutes: [{ source: "client", target: "api-server" }],
    },
    guidance: [
      componentGuide(
        "load-balancer",
        1,
        "A traffic distributor keeps one service from carrying the full load.",
        "Build a load balancer",
      ),
      componentGuide(
        "api-server",
        4,
        "More API capacity can process more requests in parallel.",
        "Scale the API tier to four replicas",
      ),
      routeGuide(
        "client",
        "load-balancer",
        "Incoming requests need a path through the distribution layer.",
        "Route clients through the load balancer",
      ),
      routeGuide(
        "load-balancer",
        "api-server",
        "Distributed traffic still needs a path to application capacity.",
        "Send balanced traffic to the API tier",
      ),
      noRouteGuide("client", "api-server", "All dynamic traffic now uses the load balancer.", "Remove the direct client-to-API route"),
    ],
    refresher: [
      refresher(
        "load-balancer",
        "Give traffic a dispatcher",
        "A load balancer receives client traffic and distributes it across API servers instead of sending everything to one machine.",
        "Build it in the request path: clients to load balancer, then load balancer to the API tier.",
      ),
      refresher(
        "api-server",
        "Scale out, not up",
        "Horizontal scaling means adding multiple API replicas that can handle requests in parallel.",
        "The balancer makes those replicas useful by sharing the spike between them.",
      ),
    ],
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
    completionReward: 24_000,
    revenuePerRequest: 0.009,
    unlocked: ["client", "cdn", "load-balancer", "api-server", "cache", "primary-database"],
    startingProfile: {
      replicas: {},
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
      activeComponents: ["cdn", "cache"],
      requiredRoutes: [
        { source: "client", target: "cdn" },
        { source: "cdn", target: "load-balancer" },
        { source: "api-server", target: "cache" },
        { source: "cache", target: "primary-database" },
      ],
      forbiddenRoutes: [
        { source: "client", target: "load-balancer" },
        { source: "api-server", target: "primary-database" },
      ],
    },
    guidance: [
      componentGuide(
        "cdn",
        1,
        "The CDN catches cacheable traffic before it reaches your region.",
        "Build a CDN",
      ),
      componentGuide(
        "cache",
        1,
        "Repeated reads are faster when served from nearby memory.",
        "Build a cache",
      ),
      routeGuide("client", "cdn", "Cacheable traffic reaches the edge first.", "Route clients to the CDN"),
      routeGuide("cdn", "load-balancer", "CDN misses continue to the application.", "Route the CDN to the load balancer"),
      routeGuide(
        "api-server",
        "cache",
        "Let application reads check fast storage before durable storage.",
        "Route API traffic to the cache",
      ),
      routeGuide(
        "cache",
        "primary-database",
        "Missed lookups still need a path to durable storage.",
        "Route cache misses to the database",
      ),
      noRouteGuide("client", "load-balancer", "The old public bypass has been removed.", "Remove the client-to-load-balancer bypass"),
      noRouteGuide("api-server", "primary-database", "Reads now pass through the cache.", "Remove the direct API-to-database bypass"),
    ],
    refresher: [
      refresher(
        "cdn",
        "Serve the edge first",
        "A CDN handles repeatable content close to visitors, reducing work before it reaches your application.",
        "It is a first line of defense when a popular link draws a crowd.",
      ),
      refresher(
        "cache",
        "Keep hot data nearby",
        "A cache stores frequently requested data in fast memory so the API does not ask the database the same question thousands of times.",
        "Connect API traffic through the cache before it reaches the primary database.",
      ),
      refresher(
        "primary-database",
        "Plan for cache misses",
        "A cache cannot answer every request, and it can fail. Misses still need a safe route to durable storage.",
        "Keep enough API and database capacity for the traffic that falls through the cache.",
      ),
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
      replicas: {},
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
      minimumReplicas: { worker: 2 },
      requireRetriesDisabled: true,
      requiredRoutes: [
        { source: "api-server", target: "cache" },
        { source: "cache", target: "primary-database" },
        { source: "api-server", target: "queue" },
        { source: "queue", target: "worker" },
        { source: "worker", target: "primary-database" },
      ],
    },
    guidance: [
      componentGuide(
        "queue",
        1,
        "Buffer work when downstream services slow down.",
        "Build a queue",
      ),
      componentGuide(
        "worker",
        2,
        "Process buffered work outside the request path.",
        "Run two worker replicas",
      ),
      routeGuide(
        "api-server",
        "queue",
        "Send incoming work to a buffer before slow dependencies.",
        "Route API work into the queue",
      ),
      routeGuide(
        "queue",
        "worker",
        "Buffered work needs consumers to drain it.",
        "Connect the queue to a worker",
      ),
      routeGuide(
        "worker",
        "primary-database",
        "Consumers need a path to durable storage.",
        "Connect the worker to the database",
      ),
      { kind: "retries-disabled", label: "Retries no longer amplify the slowdown.", hint: "Disable API retries" },
    ],
    refresher: [
      refresher(
        "queue",
        "Separate arrival from processing",
        "A queue buffers work when a downstream dependency slows down, instead of letting requests pile directly onto it.",
        "Route API work into the queue before it reaches a struggling database.",
      ),
      refresher(
        "worker",
        "Drain work at a safe pace",
        "Workers consume queued work outside the request path and write it to the database at a controlled rate.",
        "Connect the queue to workers, then workers to durable storage.",
      ),
      refresher(
        "backpressure",
        "Do not amplify failure",
        "When a dependency is slow, retries can create more work than the dependency can recover from.",
        "Queues and workers apply backpressure: they keep work bounded while the slow tier catches up.",
      ),
    ],
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
    concept: "Regions & global routing",
    objective: "Complete the 18k req/s launch inside the reliability and cost targets.",
    startingCash: 58_000,
    completionReward: 50_000,
    revenuePerRequest: 0.007,
    unlocked: ["client", "dns", "cdn", "load-balancer", "api-server", "cache", "primary-database", "queue", "worker"],
    startingProfile: {
      replicas: {},
      cdnConcurrency: 500,
    },
    durationSeconds: 72,
    normalRps: 2_100,
    spikeRps: 18_000,
    spikeAtSecond: 12,
    throughputTarget: 17_100,
    costCeiling: 70,
    availabilityTarget: 0.95,
    p95TargetMs: 900,
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
      activeComponents: ["dns", "cache", "queue", "worker"],
      minimumComponents: { "load-balancer": 2, "api-server": 2 },
      minimumRegions: 2,
      minimumRegionalPaths: 2,
      requireWeightedRouting: true,
      requiredRoutes: [
        { source: "client", target: "dns" },
        { source: "dns", target: "load-balancer" },
        { source: "load-balancer", target: "api-server" },
      ],
    },
    guidance: [
      componentGuide("dns", 1, "DNS chooses a regional entry point before requests begin.", "Build DNS"),
      componentCountGuide("load-balancer", 2, "Each region needs a managed entry point.", "Build a second load balancer"),
      componentCountGuide("api-server", 2, "Each region needs application capacity.", "Build a second API server node"),
      routeGuide("client", "dns", "Dynamic traffic asks DNS for a regional endpoint.", "Connect clients to DNS"),
      routeGuide("dns", "load-balancer", "DNS can select either regional entry point.", "Connect DNS to both load balancers"),
      {
        kind: "regions",
        minimum: 2,
        label: "Regional capacity reduces distance and isolates failures.",
        hint: "Deploy services in two regions",
      },
      {
        kind: "weighted-routing",
        label: "Traffic distribution can shift demand between regions.",
        hint: "Split traffic with weighted routes",
      },
    ],
    refresher: [
      refresher(
        "cache",
        "Keep repeated reads off the origin",
        "Use the cache to protect primary storage from hot data, but expect misses and temporary cache failures.",
        "Your architecture still needs enough origin capacity to recover when requests fall through.",
      ),
      refresher(
        "queue",
        "Buffer slow writes",
        "Queues keep incoming work from overwhelming a slow dependency. Workers drain that work at a sustainable rate.",
        "Use both to contain a database slowdown instead of turning it into a retry storm.",
      ),
      refresher(
        "regions",
        "Put capacity near the crowd",
        "Deploy services across regions to reduce network distance and limit the blast radius of a regional problem.",
        "Use at least two regions so one slow route does not define the whole launch.",
      ),
      refresher(
        "weighted-routing",
        "Steer the traffic",
        "Weighted routes split traffic across healthy capacity. They let you shift demand rather than treating every destination equally.",
        "Balance traffic across your regional paths while keeping cost and recovery in view.",
      ),
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
  dns: 2_500,
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
  if (progress.completedChapterIds.includes(chapter.id)) {
    return {
      architecture: architectureForChapter(chapter),
      cash: chapter.startingCash,
      reputation: 100,
      revenue: 0,
      operatingCost: 0,
    };
  }
  if (progress.campaignPark) {
    const park = structuredClone(progress.campaignPark);
    if (
      chapter.number === 4 &&
      !park.architecture.nodes.some((node) => node.type === "queue")
    ) {
      park.architecture.nodes = park.architecture.nodes.map((node) =>
        node.type === "api-server"
          ? { ...node, config: { ...node.config, retries: 1 } }
          : node,
      );
    }
    return park;
  }
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
    .map((node) => {
      const chapterDatabaseUpgrade =
        chapter.number >= 2 && node.type === "primary-database" ? databaseUpgrade(node) : undefined;
      return {
        ...node,
        config: {
          ...node.config,
          ...chapterDatabaseUpgrade,
          replicas: chapter.startingProfile.replicas[node.type] ?? node.config.replicas,
          concurrency:
            node.type === "cdn"
              ? (chapter.startingProfile.cdnConcurrency ?? node.config.concurrency)
              : (chapterDatabaseUpgrade?.concurrency ?? node.config.concurrency),
        },
      };
    });
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
        purpose: trafficPurposeForConnection(client.type, api.type),
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
    if (requirement.kind === "component-count") {
      const count = architecture.nodes.filter((node) => node.type === requirement.type).length;
      return { ...requirement, complete: count >= requirement.minimum };
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
    if (requirement.kind === "no-route") {
      const complete = !architecture.edges.some((edge) => {
        const source = nodesById.get(edge.source);
        const target = nodesById.get(edge.target);
        return source?.type === requirement.source && target?.type === requirement.target;
      });
      return { ...requirement, complete };
    }
    if (requirement.kind === "database-upgrade") {
      const level = Math.max(
        0,
        ...architecture.nodes
          .filter((node) => node.type === "primary-database")
          .map(databaseCapacityLevel),
      );
      return { ...requirement, complete: level >= requirement.minimumLevel };
    }
    if (requirement.kind === "retries-disabled") {
      const complete = architecture.nodes
        .filter((node) => node.type === "api-server")
        .every((node) => node.config.retries === 0);
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
export function validateChapterStartingState(
  chapter: CampaignChapter,
  architecture = architectureForChapter(chapter),
) {
  const scenario: Scenario = {
    ...chapter.scenario,
    durationSeconds: chapter.scenario.spikeAtSecond,
    incidents: [],
    successRequirements: undefined,
  };
  const result = runSimulation(
    architecture,
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
  costCeiling?: number;
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
    costCeiling,
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
      costCeiling: costCeiling ?? baseTargets.costCeiling,
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
): AdvisorLesson {
  return { concept, title, message, detail };
}

function refresher(concept: string, title: string, message: string, detail: string): AdvisorLesson {
  return { concept, title, message, detail };
}

function componentGuide(
  type: ComponentType,
  minimumReplicas: number,
  label: string,
  hint: string,
): ChapterGuidanceRequirement {
  return { kind: "component", type, minimumReplicas, label, hint };
}

function componentCountGuide(
  type: ComponentType,
  minimum: number,
  label: string,
  hint: string,
): ChapterGuidanceRequirement {
  return { kind: "component-count", type, minimum, label, hint };
}

function databaseUpgradeGuide(
  minimumLevel: number,
  label: string,
  hint: string,
): ChapterGuidanceRequirement {
  return { kind: "database-upgrade", minimumLevel, label, hint };
}

function noRouteGuide(
  source: ComponentType,
  target: ComponentType,
  label: string,
  hint: string,
): ChapterGuidanceRequirement {
  return { kind: "no-route", source, target, label, hint };
}

function routeGuide(
  source: ComponentType,
  target: ComponentType,
  label: string,
  hint: string,
): ChapterGuidanceRequirement {
  return { kind: "route", source, target, label, hint };
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
