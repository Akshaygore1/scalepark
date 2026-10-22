export const ARCHITECTURE_VERSION = 3 as const;

export const nodeTypes = [
  "client",
  "load-balancer",
  "api",
  "cache",
  "database",
  "replica",
  "queue",
  "worker",
  "pubsub",
  "archive",
] as const;
export type NodeType = (typeof nodeTypes)[number];

export const sizes = ["S", "M", "L", "XL"] as const;
export type Size = (typeof sizes)[number];

export type ApiConfig = {
  size: Size;
  instances: number;
  sessions: "memory" | "shared";
  readAfterWrite: "replica" | "primary";
  live: { mode: "poll" | "push"; pollSeconds: number };
  rateLimit: {
    enabled: boolean;
    algorithm: "fixed-window" | "token-bucket";
    rate: number;
    burst: number;
    counters: "local" | "shared";
  };
  autoscaling: { enabled: boolean; min: number; max: number; targetUtilization: number };
};
export type LoadBalancerConfig = { healthChecks: boolean };
export type CacheConfig = {
  size: Size;
  ttlSeconds: number;
  invalidateOnWrite: boolean;
  coalesce: boolean;
  jitter: boolean;
};
export type DatabaseConfig = {
  size: Size;
  index: boolean;
  replication: "async" | "sync";
  failover: "manual" | "automatic";
  backups: "none" | "daily" | "hourly" | "continuous";
  archiveAfter: "never" | "1y" | "90d";
  partitioning: "none" | "monthly";
  shards: number;
  shardKey: "created-at" | "hash";
};
export type ReplicaConfig = { size: Size; instances: number };
export type QueueConfig = { deadLetter: boolean };
export type WorkerConfig = { instances: number; idempotent: boolean };
export type EmptyConfig = Record<string, never>;

export type NodeConfigs = {
  client: EmptyConfig;
  "load-balancer": LoadBalancerConfig;
  api: ApiConfig;
  cache: CacheConfig;
  database: DatabaseConfig;
  replica: ReplicaConfig;
  queue: QueueConfig;
  worker: WorkerConfig;
  pubsub: EmptyConfig;
  archive: EmptyConfig;
};

export type ParkNodeOf<T extends NodeType> = {
  id: string;
  type: T;
  x: number;
  y: number;
  config: NodeConfigs[T];
};
export type ParkNode = { [T in NodeType]: ParkNodeOf<T> }[NodeType];

export type ParkEdge = { id: string; source: string; target: string };

export type Architecture = {
  version: typeof ARCHITECTURE_VERSION;
  nodes: ParkNode[];
  edges: ParkEdge[];
};

/** Configuration controls the player can see. Levels unlock them one idea at a time. */
export const features = [
  "size",
  "instances",
  "index",
  "ttl",
  "invalidate",
  "coalesce",
  "jitter",
  "health-checks",
  "sessions",
  "autoscaling",
  "read-after-write",
  "replication",
  "failover",
  "backups",
  "live-mode",
  "rate-limit",
  "dead-letter",
  "idempotent",
  "archive-after",
  "partitioning",
  "shards",
] as const;
export type Feature = (typeof features)[number];

export const API_CAPACITY: Record<Size, number> = { S: 500, M: 1_000, L: 2_000, XL: 3_500 };
export const API_CONNECTIONS: Record<Size, number> = {
  S: 5_000,
  M: 10_000,
  L: 20_000,
  XL: 35_000,
};
export const API_COST: Record<Size, number> = { S: 40, M: 90, L: 200, XL: 450 };
export const DB_CAPACITY: Record<Size, number> = { S: 1_000, M: 2_500, L: 6_000, XL: 12_000 };
export const DB_MEMORY_ROWS: Record<Size, number> = {
  S: 20_000_000,
  M: 60_000_000,
  L: 150_000_000,
  XL: 400_000_000,
};
export const DB_COST: Record<Size, number> = { S: 60, M: 150, L: 380, XL: 900 };
export const CACHE_CAPACITY: Record<Size, number> = {
  S: 20_000,
  M: 50_000,
  L: 120_000,
  XL: 250_000,
};
export const CACHE_COST: Record<Size, number> = { S: 30, M: 70, L: 160, XL: 340 };
export const BACKUP_COST: Record<DatabaseConfig["backups"], number> = {
  none: 0,
  daily: 10,
  hourly: 30,
  continuous: 80,
};
export const WORKER_CAPACITY = 800;
export const WORKER_COST = 50;
export const MAX_INSTANCES = 12;
export const MAX_SHARDS = 8;

export const nodeCatalog: Record<
  NodeType,
  { label: string; short: string; role: string; complexity: number }
> = {
  client: { label: "Clients", short: "Clients", role: "People and apps sending requests.", complexity: 0 },
  "load-balancer": {
    label: "Load balancer",
    short: "Balancer",
    role: "One stable address that spreads requests across API servers.",
    complexity: 1,
  },
  api: {
    label: "API server",
    short: "API server",
    role: "Runs the application: creates links and redirects visitors.",
    complexity: 1,
  },
  cache: {
    label: "Cache",
    short: "Cache",
    role: "Keeps hot data in memory so reads skip the database.",
    complexity: 1,
  },
  database: {
    label: "Database",
    short: "Database",
    role: "The durable source of truth for links and clicks.",
    complexity: 1,
  },
  replica: {
    label: "Read replica",
    short: "Replica",
    role: "A read-only copy of the database that takes read traffic.",
    complexity: 1,
  },
  queue: {
    label: "Queue",
    short: "Queue",
    role: "Holds background jobs until a worker is free.",
    complexity: 1,
  },
  worker: {
    label: "Worker",
    short: "Worker",
    role: "Processes background jobs outside the request path.",
    complexity: 1,
  },
  pubsub: {
    label: "Pub/sub",
    short: "Pub/sub",
    role: "Broadcasts live updates to every server holding a connection.",
    complexity: 2,
  },
  archive: {
    label: "Archive storage",
    short: "Archive",
    role: "Cheap, slow storage for data that is rarely read.",
    complexity: 1,
  },
};

export const buildCost: Record<NodeType, number> = {
  client: 0,
  "load-balancer": 20,
  api: API_COST.S,
  cache: CACHE_COST.S,
  database: DB_COST.S,
  replica: DB_COST.S,
  queue: 25,
  worker: WORKER_COST,
  pubsub: 40,
  archive: 10,
};

const allowedTargets: Record<NodeType, readonly NodeType[]> = {
  client: ["load-balancer", "api"],
  "load-balancer": ["api"],
  api: ["cache", "database", "replica", "queue", "pubsub"],
  cache: [],
  database: ["replica", "archive"],
  replica: [],
  queue: ["worker"],
  worker: ["database"],
  pubsub: [],
  archive: [],
};

export function canConnect(source: NodeType, target: NodeType) {
  return allowedTargets[source].includes(target);
}

export function defaultConfig<T extends NodeType>(type: T): NodeConfigs[T] {
  const configs: NodeConfigs = {
    client: {},
    "load-balancer": { healthChecks: false },
    api: {
      size: "S",
      instances: 1,
      sessions: "memory",
      readAfterWrite: "replica",
      live: { mode: "poll", pollSeconds: 5 },
      rateLimit: {
        enabled: false,
        algorithm: "fixed-window",
        rate: 20,
        burst: 20,
        counters: "local",
      },
      autoscaling: { enabled: false, min: 1, max: 6, targetUtilization: 70 },
    },
    cache: { size: "S", ttlSeconds: 60, invalidateOnWrite: false, coalesce: false, jitter: false },
    database: {
      size: "S",
      index: true,
      replication: "async",
      failover: "manual",
      backups: "none",
      archiveAfter: "never",
      partitioning: "none",
      shards: 1,
      shardKey: "hash",
    },
    replica: { size: "S", instances: 1 },
    queue: { deadLetter: false },
    worker: { instances: 1, idempotent: false },
    pubsub: {},
    archive: {},
  };
  return structuredClone(configs[type]);
}

/** Monthly running cost of one building, in dollars. */
export function nodeMonthlyCost(node: ParkNode, runningInstances?: number): number {
  switch (node.type) {
    case "client":
      return 0;
    case "load-balancer":
      return 20;
    case "api":
      return API_COST[node.config.size] * (runningInstances ?? node.config.instances);
    case "cache":
      return CACHE_COST[node.config.size];
    case "database":
      return DB_COST[node.config.size] * node.config.shards + BACKUP_COST[node.config.backups];
    case "replica":
      return DB_COST[node.config.size] * node.config.instances;
    case "queue":
      return 25;
    case "worker":
      return WORKER_COST * node.config.instances;
    case "pubsub":
      return 40;
    case "archive":
      return 10;
  }
}

export function nodeComplexity(node: ParkNode): number {
  let points = nodeCatalog[node.type].complexity;
  if (node.type === "api" && node.config.autoscaling.enabled) points += 1;
  if (node.type === "database") {
    if (node.config.partitioning !== "none") points += 1;
    if (node.config.shards > 1) points += 4 + node.config.shards;
  }
  return points;
}

export function architectureMonthlyCost(architecture: Architecture) {
  return architecture.nodes.reduce((total, node) => total + nodeMonthlyCost(node), 0);
}

export function architectureComplexity(architecture: Architecture) {
  return architecture.nodes.reduce((total, node) => total + nodeComplexity(node), 0);
}

export function findNode<T extends NodeType>(
  architecture: Architecture,
  type: T,
): ParkNodeOf<T> | undefined {
  return architecture.nodes.find((node) => node.type === type) as ParkNodeOf<T> | undefined;
}

export function hasEdge(architecture: Architecture, source: NodeType, target: NodeType) {
  const from = findNode(architecture, source);
  const to = findNode(architecture, target);
  return Boolean(
    from && to && architecture.edges.some((edge) => edge.source === from.id && edge.target === to.id),
  );
}

/** Default spots on the park map, clear of the mission rail on the left. */
export const nodePositions: Record<NodeType, { x: number; y: number }> = {
  client: { x: 290, y: 250 },
  "load-balancer": { x: 440, y: 250 },
  api: { x: 590, y: 250 },
  cache: { x: 760, y: 100 },
  database: { x: 800, y: 300 },
  replica: { x: 980, y: 400 },
  queue: { x: 640, y: 430 },
  worker: { x: 800, y: 480 },
  pubsub: { x: 590, y: 90 },
  archive: { x: 990, y: 190 },
};

export function createNode<T extends NodeType>(
  type: T,
  config: Partial<NodeConfigs[T]> = {},
  position = nodePositions[type],
): ParkNodeOf<T> {
  return {
    id: `${type}-${crypto.randomUUID().slice(0, 8)}`,
    type,
    x: position.x,
    y: position.y,
    config: { ...defaultConfig(type), ...config },
  };
}

export function createEdge(source: ParkNode, target: ParkNode): ParkEdge {
  return { id: `${source.type}-${target.type}`, source: source.id, target: target.id };
}

/** Assemble a park from nodes and type-level routes. */
export function park(
  nodes: ParkNode[],
  routes: Array<[NodeType, NodeType]>,
): Architecture {
  const byType = new Map(nodes.map((node) => [node.type, node]));
  return {
    version: ARCHITECTURE_VERSION,
    nodes,
    edges: routes.map(([source, target]) => {
      const from = byType.get(source);
      const to = byType.get(target);
      if (!from || !to) throw new Error(`Missing ${source} or ${target} for a starting route.`);
      return createEdge(from, to);
    }),
  };
}
