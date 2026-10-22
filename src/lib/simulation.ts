import {
  API_CAPACITY,
  API_CONNECTIONS,
  CACHE_CAPACITY,
  DB_CAPACITY,
  DB_MEMORY_ROWS,
  WORKER_CAPACITY,
  nodeCatalog,
  nodeMonthlyCost,
  type Architecture,
  type NodeType,
} from "./model";
import { validatePark, type Topology, type Validation } from "./topology";

export type Keyframes = ReadonlyArray<readonly [second: number, value: number]>;

export type Incident =
  | { at: number; type: "api-crash"; instances?: number }
  | { at: number; type: "worker-crash" }
  | { at: number; type: "primary-failure" }
  | { at: number; type: "table-drop" }
  | { at: number; type: "retention-job"; duration: number };

export type ScenarioParams = {
  /** Seconds between repeat reads of a typical link; drives cache hit rate. */
  reuseSeconds: number;
  /** Reads per second an edited link receives while a cache still holds the old target. */
  staleReadsPerEdit: number;
  /** Seconds between edits to the viral link; each edit invalidates its cache entry. */
  hotEditEvery: number;
  /** Requests per second a real visitor sends in a burst, and the share of traffic that bursts. */
  burstPerClient: number;
  burstShare: number;
  /** Requests per second each bot sends. */
  botRate: number;
  /** Malformed jobs per second that fail every attempt. */
  poisonPerSecond: number;
  /** Share of redirects for links old enough to be archived, by archive cutoff. */
  coldReadShare: { "1y": number; "90d": number };
  /** Share of stored links older than one year and older than 90 days. */
  oldRowShare: { "1y": number; "90d": number };
  /** Database work units for one dashboard query. */
  dashboardCost: number;
  /** Story hours since the last snapshot when the table is dropped. */
  backupAgeHours: { daily: number; hourly: number };
  createsPerStoryHour: number;
  /** Database work units per second for an unpartitioned retention delete. */
  retentionUnits: number;
  /** Share of reads that target recently created links. */
  recentReadShare: number;
  /** Share of newly created links opened by their creator right away. */
  followupShare: number;
};

export type Scenario = {
  durationSeconds: number;
  /** Shown to players when one simulated second stands for more story time. */
  timeScale?: string;
  traffic: {
    redirects: Keyframes;
    creates?: Keyframes;
    edits?: Keyframes;
    dashboard?: Keyframes;
    viewers?: Keyframes;
    bots?: Keyframes;
    hotKey?: Keyframes;
  };
  /** Every successful redirect records a click for analytics. */
  clicks?: boolean;
  data: { linkRows: number; linkRowsPerSecond?: number; clickRows?: number };
  params?: Partial<ScenarioParams>;
  incidents?: Incident[];
};

const defaultParams: ScenarioParams = {
  reuseSeconds: 20,
  staleReadsPerEdit: 0.5,
  hotEditEvery: 0,
  burstPerClient: 8,
  burstShare: 0.15,
  botRate: 40,
  poisonPerSecond: 0,
  coldReadShare: { "1y": 0.02, "90d": 0.08 },
  oldRowShare: { "1y": 0.7, "90d": 0.9 },
  dashboardCost: 3,
  backupAgeHours: { daily: 14, hourly: 0.6 },
  createsPerStoryHour: 9_000,
  retentionUnits: 4_000,
  recentReadShare: 0.6,
  followupShare: 1,
};

export type Health = "idle" | "healthy" | "busy" | "saturated" | "failed";

export type NodeSnapshot = {
  load: number;
  capacity: number;
  utilization: number;
  health: Health;
  detail: string;
};

export type LatencyClass = { label: string; volume: number; latencyMs: number };

export type Snapshot = {
  second: number;
  demand: number;
  successful: number;
  availability: number;
  p95Ms: number;
  monthlyCost: number;
  classes: LatencyClass[];
  nodes: Partial<Record<NodeType, NodeSnapshot>>;
  cacheHitRate: number;
  staleReads: number;
  notFound: number;
  lostWrites: number;
  lostLinks: number;
  duplicates: number;
  loggedOut: number;
  legitRejected: number;
  botsPassed: number;
  viewers: number;
  viewersConnected: number;
  freshnessSeconds: number;
  missedUpdates: number;
  queueBacklog: number;
  analyticsDelaySeconds: number;
  apiInstances: { running: number; warming: number; crashed: number };
  replicaLagSeconds: number;
};

export type SimEvent = {
  second: number;
  kind: "incident" | "saturation" | "recovery" | "scaling" | "info";
  node?: NodeType;
  message: string;
};

export type Totals = {
  demand: number;
  successful: number;
  availability: number;
  p95Ms: number;
  averageMonthlyCost: number;
  staleReads: number;
  notFound: number;
  lostWrites: number;
  lostLinks: number;
  duplicates: number;
  loggedOut: number;
  legitRejected: number;
  peakBotsPassed: number;
  minViewersConnected: number;
  maxFreshnessSeconds: number;
  maxMissedUpdates: number;
  maxAnalyticsDelaySeconds: number;
  finalBacklog: number;
  firstSaturated?: { node: NodeType; second: number };
};

export type SimulationResult = {
  validation: Validation;
  snapshots: Snapshot[];
  events: SimEvent[];
  totals: Totals;
};

type Stage = { backlog: number; dropFraction: number; utilization: number; waitMs: number };

type EngineState = {
  apiRunning: number;
  apiWarming: number[];
  apiCrashed: number;
  crashAt?: number;
  lowUtilizationSeconds: number;
  lastScaleAt: number;
  backlog: { api: number; database: number; replica: number; cache: number };
  queueBacklog: number;
  poisonRetrying: number;
  workersCrashed: number;
  workerRestartAt?: number;
  primary: "up" | "down" | "promoted";
  promoteAt?: number;
  restoringUntil?: number;
  dataLost: boolean;
  linkRows: number;
  databaseUtilization: number;
  saturated: Set<NodeType>;
};

const HEALTH_CHECK_SECONDS = 2;
const WARMUP_SECONDS = 6;
const TIMEOUT_SECONDS = 1;
const ARCHIVE_LATENCY_MS = 90;
const BATCH_SIZE = 20;

export function valueAt(frames: Keyframes | undefined, second: number) {
  if (!frames || frames.length === 0) return 0;
  if (second <= frames[0]![0]) return frames[0]![1];
  for (let index = 1; index < frames.length; index += 1) {
    const [end, endValue] = frames[index]!;
    const [start, startValue] = frames[index - 1]!;
    if (second <= end) {
      return startValue + ((endValue - startValue) * (second - start)) / Math.max(1, end - start);
    }
  }
  return frames.at(-1)![1];
}

function stage(load: number, backlog: number, capacity: number): Stage {
  const offered = load + backlog;
  if (capacity <= 0) {
    return { backlog: 0, dropFraction: offered > 0 ? 1 : 0, utilization: offered > 0 ? 9.99 : 0, waitMs: 0 };
  }
  let remaining = Math.max(0, offered - capacity);
  const dropped = Math.max(0, remaining - capacity * TIMEOUT_SECONDS);
  remaining -= dropped;
  return {
    backlog: remaining,
    dropFraction: offered > 0 ? dropped / offered : 0,
    utilization: load / capacity,
    waitMs: (remaining / capacity) * 1000,
  };
}

/** Queueing delay grows sharply as a component approaches full utilization. */
function serviceMs(baseMs: number, current: Stage) {
  const busy = Math.min(current.utilization, 0.95);
  return baseMs * (1 + (2 * busy) / (1 - busy)) + current.waitMs;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function health(current: Stage, capacity: number, load: number): Health {
  if (capacity <= 0) return load > 0 ? "failed" : "idle";
  if (load <= 0 && current.backlog <= 0) return "idle";
  if (current.backlog > 0 || current.dropFraction > 0 || current.utilization >= 0.95) return "saturated";
  if (current.utilization >= 0.75) return "busy";
  return "healthy";
}

function nodeSnapshot(load: number, capacity: number, current: Stage, detail: string): NodeSnapshot {
  return {
    load: Math.round(load),
    capacity: Math.round(capacity),
    utilization: capacity > 0 ? load / capacity : load > 0 ? 9.99 : 0,
    health: health(current, capacity, load),
    detail,
  };
}

function percentile(classes: LatencyClass[], share: number) {
  const total = classes.reduce((sum, item) => sum + item.volume, 0);
  if (total <= 0) return 0;
  const sorted = [...classes].filter((item) => item.volume > 0).sort((a, b) => a.latencyMs - b.latencyMs);
  let cumulative = 0;
  for (const item of sorted) {
    cumulative += item.volume;
    if (cumulative / total >= share) return item.latencyMs;
  }
  return sorted.at(-1)?.latencyMs ?? 0;
}

function initialState(topology: Topology, scenario: Scenario): EngineState {
  const api = topology.api.config;
  const running = api.autoscaling.enabled
    ? Math.min(api.autoscaling.max, Math.max(api.autoscaling.min, api.instances))
    : api.instances;
  return {
    apiRunning: running,
    apiWarming: [],
    apiCrashed: 0,
    lowUtilizationSeconds: 0,
    lastScaleAt: -Infinity,
    backlog: { api: 0, database: 0, replica: 0, cache: 0 },
    queueBacklog: 0,
    poisonRetrying: 0,
    workersCrashed: 0,
    primary: "up",
    dataLost: false,
    linkRows: scenario.data.linkRows,
    databaseUtilization: 0,
    saturated: new Set(),
  };
}

export function runSimulation(architecture: Architecture, scenario: Scenario): SimulationResult {
  const validation = validatePark(architecture);
  if (!validation.ok) {
    return { validation, snapshots: [], events: [], totals: summarize([], []) };
  }
  const topology = validation.topology;
  const params = { ...defaultParams, ...scenario.params };
  const state = initialState(topology, scenario);
  const snapshots: Snapshot[] = [];
  const events: SimEvent[] = [];
  for (let second = 0; second < scenario.durationSeconds; second += 1) {
    snapshots.push(tick(topology, architecture.nodes, scenario, params, state, second, events));
  }
  return { validation, snapshots, events, totals: summarize(snapshots, events) };
}

function tick(
  topology: Topology,
  billed: Architecture["nodes"],
  scenario: Scenario,
  params: ScenarioParams,
  state: EngineState,
  second: number,
  events: SimEvent[],
): Snapshot {
  const { api, database, cache, replica, queue, worker, archive, loadBalancer } = topology;
  const traffic = scenario.traffic;
  const redirects = valueAt(traffic.redirects, second);
  const creates = valueAt(traffic.creates, second);
  const edits = valueAt(traffic.edits, second);
  const dashboard = valueAt(traffic.dashboard, second);
  const viewers = valueAt(traffic.viewers, second);
  const bots = valueAt(traffic.bots, second);
  const hotKey = Math.min(redirects, valueAt(traffic.hotKey, second));
  const emit = (kind: SimEvent["kind"], message: string, node?: NodeType) =>
    events.push({ second, kind, message, node });

  // Deployments and incidents that change the park this second.
  const ready = state.apiWarming.filter((readyAt) => readyAt <= second);
  if (ready.length > 0) {
    state.apiWarming = state.apiWarming.filter((readyAt) => readyAt > second);
    state.apiRunning += ready.length;
    emit("scaling", `${ready.length} new API ${ready.length === 1 ? "server is" : "servers are"} warm and taking traffic.`, "api");
  }
  if (state.workerRestartAt === second && state.workersCrashed > 0) {
    state.workersCrashed = 0;
    state.workerRestartAt = undefined;
    emit("recovery", "The crashed worker restarted.", "worker");
  }
  let lostWrites = 0;
  let lostLinks = 0;
  let duplicates = 0;
  const writesNow = creates + edits;
  const lagFor = (utilization: number) =>
    database.config.replication === "sync" ? 0 : 0.3 + (3 * Math.max(0, utilization - 0.7)) / 0.3;
  for (const incident of scenario.incidents ?? []) {
    if (incident.at !== second) continue;
    if (incident.type === "api-crash") {
      const count = Math.min(state.apiRunning, incident.instances ?? 1);
      state.apiRunning -= count;
      state.apiCrashed += count;
      state.crashAt = second;
      emit("incident", `${count === 1 ? "An API server" : `${count} API servers`} crashed.`, "api");
    } else if (incident.type === "worker-crash" && worker) {
      state.workersCrashed = Math.min(worker.config.instances, 1);
      state.workerRestartAt = second + 5;
      if (!worker.config.idempotent) duplicates += WORKER_CAPACITY;
      emit(
        "incident",
        worker.config.idempotent
          ? "A worker crashed mid-batch. Its jobs were redelivered and safely skipped as duplicates."
          : `A worker crashed mid-batch. ${WORKER_CAPACITY.toLocaleString()} jobs were redelivered and counted twice.`,
        "worker",
      );
    } else if (incident.type === "primary-failure") {
      state.primary = "down";
      if (replica) {
        lostWrites += Math.round(writesNow * lagFor(state.databaseUtilization));
        state.promoteAt = second + (database.config.failover === "automatic" ? 5 : 40);
      }
      emit(
        "incident",
        lostWrites > 0
          ? `The primary database failed. ${lostWrites.toLocaleString()} recent writes had not reached the replica.`
          : "The primary database failed.",
        "database",
      );
    } else if (incident.type === "table-drop") {
      const backups = database.config.backups;
      if (backups === "none") {
        state.dataLost = true;
        lostLinks += state.linkRows;
        emit("incident", "Someone dropped the links table. With no backup, every link is gone.", "database");
      } else {
        const restoreSeconds = Math.ceil(state.linkRows / 10_000_000) + (backups === "continuous" ? 5 : 2);
        state.restoringUntil = second + restoreSeconds;
        lostLinks += Math.round(
          params.createsPerStoryHour *
            (backups === "daily"
              ? params.backupAgeHours.daily
              : backups === "hourly"
                ? params.backupAgeHours.hourly
                : 1 / 60),
        );
        emit(
          "incident",
          `Someone dropped the links table, and replicas copied the drop. Restoring from the ${backups} backup takes ${restoreSeconds}s; ${lostLinks.toLocaleString()} links created since then are lost.`,
          "database",
        );
      }
    } else if (incident.type === "retention-job") {
      emit(
        "incident",
        database.config.partitioning === "monthly"
          ? "The nightly retention job drops last year's partition in one cheap step."
          : "The nightly retention job starts deleting old clicks row by row.",
        "database",
      );
    }
  }
  if (state.promoteAt === second && state.primary === "down") {
    state.primary = "promoted";
    emit("recovery", "A replica was promoted to primary. Writes resume.", "database");
  }
  if (state.restoringUntil === second) {
    state.restoringUntil = undefined;
    emit("recovery", "The restore finished. The links table is back.", "database");
  }
  const restoring = state.restoringUntil !== undefined;
  const retentionActive = (scenario.incidents ?? []).some(
    (incident) =>
      incident.type === "retention-job" && second >= incident.at && second < incident.at + incident.duration,
  );

  // API pool: without a balancer, clients only ever reach one server.
  const usesBalancer = Boolean(loadBalancer);
  const healthChecked =
    Boolean(loadBalancer?.config.healthChecks) &&
    state.crashAt !== undefined &&
    second >= state.crashAt + HEALTH_CHECK_SECONDS;
  if (loadBalancer?.config.healthChecks && state.crashAt !== undefined && second === state.crashAt + HEALTH_CHECK_SECONDS) {
    emit("recovery", "Health checks noticed the crashed server and stopped sending it traffic.", "load-balancer");
  }
  const reachable = usesBalancer
    ? state.apiRunning
    : state.apiCrashed > 0
      ? 0
      : Math.min(1, state.apiRunning);
  const deadShare =
    usesBalancer && state.apiCrashed > 0 && !healthChecked
      ? state.apiCrashed / (state.apiRunning + state.apiCrashed)
      : 0;

  // Rate limiting happens before any application work. With per-server counters, bots that
  // rotate connections get every server's allowance, while one visitor's burst lands on one server.
  const limit = api.config.rateLimit;
  const sharedCounters = limit.counters === "shared" && Boolean(cache);
  const botScope = sharedCounters ? 1 : Math.max(1, reachable);
  let botsPassed = bots * params.botRate;
  let legitRejectedFraction = 0;
  if (limit.enabled) {
    if (limit.algorithm === "fixed-window") {
      // Two windows meet at every boundary, so a client can briefly send twice the limit.
      botsPassed = bots * Math.min(params.botRate, limit.rate * botScope * 1.5);
      legitRejectedFraction = params.burstShare * clamp01((params.burstPerClient - limit.rate) / params.burstPerClient);
    } else {
      botsPassed = bots * Math.min(params.botRate, limit.rate * botScope);
      legitRejectedFraction =
        params.burstShare * clamp01((params.burstPerClient - limit.burst) / params.burstPerClient) +
        (1 - params.burstShare) * clamp01(1 - limit.rate);
    }
  }
  const keep = 1 - legitRejectedFraction;

  // Live viewers either poll on a timer or hold an open connection.
  const push = api.config.live.mode === "push";
  const polls = !push && viewers > 0 ? viewers / Math.max(1, api.config.live.pollSeconds) : 0;
  const connectionCapacity = reachable * API_CONNECTIONS[api.config.size];
  const connected = push ? Math.min(viewers, connectionCapacity) : 0;

  const followups = creates * params.followupShare;
  const legitRequests = (redirects + creates + edits + dashboard + followups) * keep + polls;
  const apiLoad = (legitRequests + botsPassed) * (1 - deadShare) + connected * 0.02;
  const apiCapacity = reachable * API_CAPACITY[api.config.size];
  const apiStage = stage(apiLoad, state.backlog.api, apiCapacity);
  state.backlog.api = apiStage.backlog;
  const apiOk = (1 - deadShare) * (1 - apiStage.dropFraction);

  // Sessions kept in one server's memory break once a balancer spreads a user across servers.
  const sharedSessions = api.config.sessions === "shared" && Boolean(cache);
  const dashboardServed = dashboard * keep * apiOk;
  const loggedOut =
    !sharedSessions && usesBalancer && reachable > 1 ? (dashboardServed * (reachable - 1)) / reachable : 0;

  // Cache: hit rate rises with TTL; synchronized expiry and hot-key refills send bursts of misses.
  const redirectReads = redirects * keep * apiOk;
  const hotReads = Math.min(redirectReads, hotKey * keep * apiOk);
  const normalReads = redirectReads - hotReads;
  const ttl = cache ? Math.max(1, cache.config.ttlSeconds) : 0;
  const expiryTick = Boolean(cache) && second > 0 && second % ttl === 0;
  const massExpiry = expiryTick && !cache?.config.jitter;
  const hotEvents =
    (expiryTick ? 1 : 0) +
    (cache?.config.invalidateOnWrite && params.hotEditEvery > 0 && second > 0 && second % params.hotEditEvery === 0 ? 1 : 0);
  let hits = 0;
  let misses = redirectReads;
  let hotMisses = 0;
  if (cache) {
    const hitRate = massExpiry ? 0 : ttl / (ttl + params.reuseSeconds);
    hotMisses = hotEvents > 0 ? (cache.config.coalesce ? Math.min(hotReads, 1) : Math.min(hotReads, hotReads * 0.4 * hotEvents)) : 0;
    hits = normalReads * hitRate + hotReads - hotMisses;
    misses = normalReads * (1 - hitRate) + hotMisses;
    if (massExpiry && normalReads > 0) {
      emit("info", "Every cache entry was loaded together, so they all expired together.", "cache");
    }
    if (hotMisses > 100) {
      emit("info", `The viral link's cache entry refreshed: ${Math.round(hotMisses).toLocaleString()} requests missed at once.`, "cache");
    }
  }
  const writes = (creates + edits) * keep * apiOk;
  const cacheOps = cache
    ? redirectReads +
      botsPassed * apiOk +
      (cache.config.invalidateOnWrite ? writes : 0) +
      (sharedSessions ? dashboardServed : 0) +
      (limit.enabled && sharedCounters ? (legitRequests + botsPassed) * apiOk : 0)
    : 0;
  const cacheCapacity = cache ? CACHE_CAPACITY[cache.config.size] : 0;
  const cacheStage = stage(cacheOps, state.backlog.cache, cacheCapacity);
  state.backlog.cache = cacheStage.backlog;
  const cacheOk = cache ? 1 - cacheStage.dropFraction : 1;
  const staleReads =
    cache && !cache.config.invalidateOnWrite
      ? Math.min(hits, edits * keep * apiOk * params.staleReadsPerEdit * (Math.min(ttl, 600) / 2))
      : 0;

  // Background clicks: inline database writes, or a queue drained by workers.
  const clicks = scenario.clicks ? redirectReads : 0;
  let workerWrites = 0;
  let idempotencyReads = 0;
  let analyticsDelaySeconds = 0;
  let workerCapacity = 0;
  if (queue && worker) {
    const workersUp = Math.max(0, worker.config.instances - state.workersCrashed);
    state.poisonRetrying = queue.config.deadLetter
      ? params.poisonPerSecond * 3
      : state.poisonRetrying + params.poisonPerSecond;
    workerCapacity = Math.max(0, workersUp * WORKER_CAPACITY - state.poisonRetrying * 20);
    const available = state.queueBacklog + clicks + params.poisonPerSecond;
    workerWrites = Math.min(available, workerCapacity);
    idempotencyReads = worker.config.idempotent ? workerWrites : 0;
    state.queueBacklog = available - workerWrites;
  }
  const inlineClicks = queue ? 0 : clicks;

  // Reads go to replicas when the design routes them there.
  const primaryUp = state.primary !== "down" && !restoring && !state.dataLost;
  const replicaInstances = replica
    ? replica.config.instances - (state.primary === "promoted" ? 1 : 0)
    : 0;
  const replicaUp = replicaInstances > 0 && !restoring && !state.dataLost;
  const lag = replica ? lagFor(state.databaseUtilization) : 0;
  const archiveShare =
    archive && database.config.archiveAfter !== "never" ? params.coldReadShare[database.config.archiveAfter] : 0;
  const archivedReads = misses * archiveShare;
  const warmMisses = misses - archivedReads;
  const botReads = botsPassed * apiOk;
  const dashboardReads = dashboardServed - loggedOut;
  const followupReads = followups * keep * apiOk;
  const followupsToReplica = replicaUp && api.config.readAfterWrite === "replica";
  const replicaReads = replicaUp ? warmMisses + botReads + (followupsToReplica ? followupReads : 0) : 0;
  const replicaDashboards = replicaUp ? dashboardReads : 0;
  const primaryReads =
    warmMisses + botReads + followupReads + archivedReads * 0.1 - replicaReads;
  const primaryDashboards = dashboardReads - replicaDashboards;
  const notFound = followupsToReplica ? followupReads * clamp01(lag) : 0;

  // Primary database work, in units of one indexed in-memory read.
  const shards = Math.max(1, database.config.shards);
  const keptRows =
    archive && database.config.archiveAfter !== "never"
      ? state.linkRows * (1 - params.oldRowShare[database.config.archiveAfter])
      : state.linkRows;
  const memoryRows = DB_MEMORY_ROWS[database.config.size] * shards;
  const fitsInMemory = keptRows <= memoryRows;
  const readCost = database.config.index ? (fitsInMemory ? 1 : 5) : Math.max(1, keptRows / 100_000);
  const writeCost = 2 + (database.config.index ? 0.5 : 0);
  const clickRows = scenario.data.clickRows ?? 0;
  const dashboardCost =
    clickRows > 0
      ? database.config.partitioning === "monthly"
        ? params.dashboardCost
        : clickRows > memoryRows
          ? params.dashboardCost * 5
          : params.dashboardCost
      : params.dashboardCost;
  const scatter = shards > 1 && database.config.shardKey === "hash" ? shards : 1;
  const readUnits =
    Math.max(0, primaryReads) * readCost + (idempotencyReads / BATCH_SIZE) * readCost + polls * apiOk * 0.2;
  // Workers write clicks in batches, so each queued click costs a fraction of an inline insert.
  const writeUnits = (writes + inlineClicks + workerWrites / BATCH_SIZE) * writeCost;
  const otherUnits =
    primaryDashboards * dashboardCost * scatter +
    (retentionActive ? (database.config.partitioning === "monthly" ? 20 : params.retentionUnits) : 0);
  const primaryLoad = readUnits + writeUnits + otherUnits;
  const perShardCapacity =
    state.primary === "promoted" && replica ? DB_CAPACITY[replica.config.size] : DB_CAPACITY[database.config.size];
  // A created-at shard key sends every new link, and most reads, to the newest shard.
  const hottestShardLoad =
    shards === 1
      ? primaryLoad
      : database.config.shardKey === "hash"
        ? primaryLoad / shards
        : writeUnits + readUnits * params.recentReadShare + otherUnits / shards;
  const databaseStage = stage(hottestShardLoad, state.backlog.database, primaryUp ? perShardCapacity : 0);
  state.backlog.database = databaseStage.backlog;
  state.databaseUtilization = databaseStage.utilization;
  const databaseOk = 1 - databaseStage.dropFraction;
  if (queue && databaseStage.dropFraction > 0) state.queueBacklog += workerWrites * databaseStage.dropFraction;
  analyticsDelaySeconds = queue ? state.queueBacklog / Math.max(1, Math.min(workerCapacity, clicks + 1)) : 0;

  // Every replica applies every write, so replicas add read capacity but never write capacity.
  const replicaLoad =
    replicaReads * readCost + replicaDashboards * dashboardCost + (replicaUp ? writes * replicaInstances : 0);
  const replicaCapacity = replicaUp ? replicaInstances * DB_CAPACITY[replica!.config.size] : 0;
  const replicaStage = stage(replicaLoad, state.backlog.replica, replicaCapacity);
  state.backlog.replica = replicaStage.backlog;
  const replicaOk = 1 - replicaStage.dropFraction;

  // Successful work, then latency per request class.
  const missReadOk = (replicaUp ? replicaOk : databaseOk) * cacheOk;
  const inlineClickOk = inlineClicks > 0 ? databaseOk : 1;
  const hitsOk = hits * cacheOk * inlineClickOk;
  const warmMissesOk = warmMisses * missReadOk * inlineClickOk;
  const archivedOk = archivedReads * databaseOk * inlineClickOk;
  const followupOk = Math.max(0, followupReads * (followupsToReplica ? replicaOk : databaseOk) - notFound);
  const writesOk = writes * databaseOk;
  const dashboardsOk =
    replicaDashboards * replicaOk + primaryDashboards * databaseOk;
  const pollsOk = polls * apiOk * databaseOk;
  const successful = hitsOk + warmMissesOk + archivedOk + followupOk + writesOk + dashboardsOk + pollsOk;
  const demand = redirects + creates + edits + dashboard + followups + polls;
  const availability = demand > 0 ? clamp01(successful / demand) : 1;

  const balancerMs = usesBalancer ? 1 : 0;
  const apiMs = balancerMs + serviceMs(4, apiStage) + (limit.enabled && sharedCounters ? 1 : 0);
  const cacheMs = cache ? serviceMs(1, cacheStage) : 0;
  const primaryReadBase = database.config.index ? (fitsInMemory ? 2 : 9) : Math.max(2, (keptRows / 100_000) * 0.4);
  const primaryReadMs = serviceMs(primaryReadBase, databaseStage);
  const replicaReadMs = replicaUp ? serviceMs(primaryReadBase, replicaStage) : primaryReadMs;
  const missReadMs = replicaUp ? replicaReadMs : primaryReadMs;
  const writeMs = serviceMs(5, databaseStage) + (database.config.replication === "sync" && replica ? 12 : 0);
  const clickMs = inlineClicks > 0 ? writeMs : queue ? 1 : 0;
  const classes: LatencyClass[] = [
    { label: "Cached redirect", volume: hitsOk, latencyMs: apiMs + cacheMs + clickMs },
    { label: "Database redirect", volume: warmMissesOk, latencyMs: apiMs + cacheMs + missReadMs + clickMs },
    { label: "Archived redirect", volume: archivedOk, latencyMs: apiMs + cacheMs + primaryReadMs + ARCHIVE_LATENCY_MS + clickMs },
    { label: "First visit to a new link", volume: followupOk, latencyMs: apiMs + (followupsToReplica ? replicaReadMs : primaryReadMs) },
    { label: "Create or edit", volume: writesOk, latencyMs: apiMs + writeMs + (cache?.config.invalidateOnWrite ? cacheMs : 0) },
    {
      label: "Dashboard",
      volume: dashboardsOk,
      latencyMs:
        apiMs + (sharedSessions ? cacheMs : 0) + (replicaDashboards > 0 ? replicaReadMs : primaryReadMs) * (dashboardCost * scatter) / 2,
    },
    { label: "Live poll", volume: pollsOk, latencyMs: apiMs + primaryReadMs * 0.5 },
  ].map((item) => ({ ...item, latencyMs: Math.min(TIMEOUT_SECONDS * 1000, Math.round(item.latencyMs)) }));

  // Live updates need every server to hear about every click.
  const servers = Math.max(1, reachable);
  const missedUpdates = push && viewers > 0 && servers > 1 && !topology.pubsub ? (servers - 1) / servers : 0;
  const freshnessSeconds =
    viewers <= 0 ? 0 : push ? (missedUpdates > 0 ? 60 : 0.2) : 0.95 * Math.max(1, api.config.live.pollSeconds);
  const viewersConnected = viewers <= 0 ? 1 : push ? connected / viewers : clamp01(apiOk * databaseOk);

  // Autoscaling reacts after the fact: new servers need time to warm up.
  const scaling = api.config.autoscaling;
  if (scaling.enabled) {
    const desired = Math.min(
      scaling.max,
      Math.max(scaling.min, Math.ceil(apiLoad / (API_CAPACITY[api.config.size] * (scaling.targetUtilization / 100)))),
    );
    const pool = state.apiRunning + state.apiWarming.length;
    if (desired > pool && second - state.lastScaleAt >= 2) {
      for (let count = pool; count < desired; count += 1) state.apiWarming.push(second + WARMUP_SECONDS);
      state.lastScaleAt = second;
      state.lowUtilizationSeconds = 0;
      emit("scaling", `Autoscaling ordered ${desired - pool} more API ${desired - pool === 1 ? "server" : "servers"}; ready in ${WARMUP_SECONDS}s.`, "api");
    } else if (desired < state.apiRunning && state.apiWarming.length === 0) {
      state.lowUtilizationSeconds += 1;
      if (state.lowUtilizationSeconds >= 8) {
        state.apiRunning -= 1;
        state.lowUtilizationSeconds = 0;
        emit("scaling", "Autoscaling removed an idle API server.", "api");
      }
    } else {
      state.lowUtilizationSeconds = 0;
    }
  }

  const nodes: Snapshot["nodes"] = {
    client: nodeSnapshot(demand + bots * params.botRate, Infinity, stage(0, 0, 1), `${Math.round(demand).toLocaleString()} req/s`),
    api: nodeSnapshot(apiLoad, apiCapacity, apiStage, `${reachable} of ${state.apiRunning + state.apiCrashed} servers reachable`),
    database: nodeSnapshot(
      hottestShardLoad,
      primaryUp ? perShardCapacity : 0,
      databaseStage,
      !primaryUp
        ? restoring
          ? "Restoring from backup"
          : state.dataLost
            ? "Data lost"
            : "Down"
        : `${fitsInMemory ? "Fits in memory" : "Spills to disk"} · read cost ${readCost.toFixed(1)}`,
    ),
  };
  if (loadBalancer) {
    nodes["load-balancer"] = nodeSnapshot(apiLoad, 50_000, stage(apiLoad, 0, 50_000), deadShare > 0 ? "Sending traffic to a dead server" : "Spreading traffic");
  }
  if (cache) {
    nodes.cache = nodeSnapshot(cacheOps, cacheCapacity, cacheStage, `${Math.round((redirectReads > 0 ? hits / redirectReads : 0) * 100)}% hit rate`);
  }
  if (replica) {
    nodes.replica = nodeSnapshot(replicaLoad, replicaCapacity, replicaStage, replicaUp ? `${lag.toFixed(1)}s behind` : "Unavailable");
  }
  if (queue && worker) {
    const queueStage: Stage = { backlog: state.queueBacklog, dropFraction: 0, utilization: state.queueBacklog > 0 ? 1 : 0.1, waitMs: 0 };
    nodes.queue = nodeSnapshot(clicks, Infinity, queueStage, `${Math.round(state.queueBacklog).toLocaleString()} jobs waiting`);
    nodes.worker = nodeSnapshot(
      clicks + state.poisonRetrying * 20,
      Math.max(0, worker.config.instances - state.workersCrashed) * WORKER_CAPACITY,
      stage(clicks + state.poisonRetrying * 20, 0, Math.max(1, workerCapacity)),
      state.poisonRetrying > 0 ? `${Math.round(state.poisonRetrying)} poison jobs retrying` : `${Math.round(workerWrites).toLocaleString()} jobs/s`,
    );
  }
  if (topology.pubsub) nodes.pubsub = nodeSnapshot(viewers > 0 ? clicks : 0, 200_000, stage(0, 0, 1), "Fanning out updates");
  if (archive) nodes.archive = nodeSnapshot(archivedReads, Infinity, stage(0, 0, 1), `${Math.round(archivedReads).toLocaleString()} reads/s`);

  for (const [type, snapshot] of Object.entries(nodes) as Array<[NodeType, NodeSnapshot]>) {
    const saturated = snapshot.health === "saturated" || snapshot.health === "failed";
    if (saturated && !state.saturated.has(type)) {
      state.saturated.add(type);
      emit("saturation", `${nodeCatalog[type].label} ${snapshot.health === "failed" ? "is failing every request" : "is at capacity: work is queueing"}.`, type);
    } else if (!saturated && state.saturated.has(type)) {
      state.saturated.delete(type);
      emit("recovery", `${nodeCatalog[type].label} has headroom again.`, type);
    }
  }

  state.linkRows += scenario.data.linkRowsPerSecond ?? 0;
  // Every building is billed, including ones that are not on a request path.
  const monthlyCost = billed.reduce(
    (total, node) =>
      total +
      (node.type === "api"
        ? nodeMonthlyCost(node, state.apiRunning + state.apiWarming.length + state.apiCrashed)
        : nodeMonthlyCost(node)),
    0,
  );

  return {
    second,
    demand: Math.round(demand),
    successful: Math.round(successful),
    availability,
    p95Ms: percentile(classes, 0.95),
    monthlyCost,
    classes,
    nodes,
    cacheHitRate: redirectReads > 0 ? hits / redirectReads : 0,
    staleReads,
    notFound,
    lostWrites,
    lostLinks,
    duplicates,
    loggedOut,
    legitRejected: (redirects + creates + edits + dashboard + followups) * legitRejectedFraction,
    botsPassed,
    viewers,
    viewersConnected,
    freshnessSeconds,
    missedUpdates,
    queueBacklog: Math.round(state.queueBacklog),
    analyticsDelaySeconds,
    apiInstances: { running: state.apiRunning, warming: state.apiWarming.length, crashed: state.apiCrashed },
    replicaLagSeconds: lag,
  };
}

export function summarize(snapshots: Snapshot[], events: SimEvent[]): Totals {
  const sum = (pick: (snapshot: Snapshot) => number) =>
    snapshots.reduce((total, snapshot) => total + pick(snapshot), 0);
  const max = (pick: (snapshot: Snapshot) => number) =>
    snapshots.reduce((total, snapshot) => Math.max(total, pick(snapshot)), 0);
  const demand = sum((snapshot) => snapshot.demand);
  const successful = sum((snapshot) => snapshot.successful);
  const firstSaturation = events.find((event) => event.kind === "saturation" && event.node);
  const viewing = snapshots.filter((snapshot) => snapshot.viewers > 0);
  return {
    demand,
    successful,
    availability: demand > 0 ? successful / demand : 1,
    p95Ms: percentile(snapshots.flatMap((snapshot) => snapshot.classes), 0.95),
    averageMonthlyCost: snapshots.length ? sum((snapshot) => snapshot.monthlyCost) / snapshots.length : 0,
    staleReads: Math.round(sum((snapshot) => snapshot.staleReads)),
    notFound: Math.round(sum((snapshot) => snapshot.notFound)),
    lostWrites: Math.round(sum((snapshot) => snapshot.lostWrites)),
    lostLinks: Math.round(sum((snapshot) => snapshot.lostLinks)),
    duplicates: Math.round(sum((snapshot) => snapshot.duplicates)),
    loggedOut: Math.round(sum((snapshot) => snapshot.loggedOut)),
    legitRejected: Math.round(sum((snapshot) => snapshot.legitRejected)),
    peakBotsPassed: Math.round(max((snapshot) => snapshot.botsPassed)),
    minViewersConnected: viewing.length
      ? Math.min(...viewing.map((snapshot) => snapshot.viewersConnected))
      : 1,
    maxFreshnessSeconds: max((snapshot) => snapshot.freshnessSeconds),
    maxMissedUpdates: max((snapshot) => snapshot.missedUpdates),
    maxAnalyticsDelaySeconds: max((snapshot) => snapshot.analyticsDelaySeconds),
    finalBacklog: snapshots.at(-1)?.queueBacklog ?? 0,
    firstSaturated:
      firstSaturation?.node && firstSaturation.node !== "client"
        ? { node: firstSaturation.node, second: firstSaturation.second }
        : undefined,
  };
}
