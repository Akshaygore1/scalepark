export const ARCHITECTURE_VERSION = 1 as const;
export const architectureStorageKey = "scalelab:architecture";

export const componentTypes = [
  "client",
  "cdn",
  "load-balancer",
  "api-server",
  "cache",
  "primary-database",
  "read-replica",
  "queue",
  "worker",
] as const;

export type ComponentType = (typeof componentTypes)[number];
export type Region = "us-east" | "us-west" | "eu-west" | "ap-south";

export type ComponentConfig = {
  replicas: number;
  capacity: number;
  concurrency: number;
  serviceTimeMs: number;
  timeoutMs: number;
  retries: number;
  region: Region;
  cacheSize: number;
  ttlSeconds: number;
  connectionLimit: number;
  queueCapacity: number;
  autoscaling: {
    enabled: boolean;
    threshold: number;
    minReplicas: number;
    maxReplicas: number;
    startupDelaySeconds: number;
    cooldownSeconds: number;
  };
};

export type ArchitectureNode = {
  id: string;
  type: ComponentType;
  label: string;
  x: number;
  y: number;
  config: ComponentConfig;
};

export type ArchitectureEdge = {
  id: string;
  source: string;
  target: string;
  weight: number;
};

export type Architecture = {
  version: typeof ARCHITECTURE_VERSION;
  name: string;
  nodes: ArchitectureNode[];
  edges: ArchitectureEdge[];
};

export type ValidationResult =
  | { runnable: true; errors: []; warnings: string[] }
  | { runnable: false; errors: string[]; warnings: string[] };

const defaultConfig: ComponentConfig = {
  replicas: 1,
  capacity: 2500,
  concurrency: 80,
  serviceTimeMs: 32,
  timeoutMs: 900,
  retries: 0,
  region: "us-east",
  cacheSize: 1000,
  ttlSeconds: 300,
  connectionLimit: 80,
  queueCapacity: 10000,
  autoscaling: {
    enabled: false,
    threshold: 75,
    minReplicas: 1,
    maxReplicas: 8,
    startupDelaySeconds: 45,
    cooldownSeconds: 60,
  },
};

const labels: Record<ComponentType, string> = {
  client: "Clients",
  cdn: "DNS / CDN",
  "load-balancer": "Load balancer",
  "api-server": "API server",
  cache: "Cache",
  "primary-database": "Primary database",
  "read-replica": "Read replica",
  queue: "Queue",
  worker: "Worker",
};

export function nodeConfig(type: ComponentType): ComponentConfig {
  const config = structuredClone(defaultConfig);
  if (type === "client") config.capacity = 18_000;
  if (type === "cdn") config.capacity = 14_000;
  if (type === "cache") config.capacity = 12_000;
  if (type === "queue") config.capacity = 3_000;
  if (type === "worker") config.capacity = 1_200;
  return config;
}

export function createNode(type: ComponentType, index: number): ArchitectureNode {
  return {
    id: `${type}-${crypto.randomUUID()}`,
    type,
    label: labels[type],
    x: 120 + ((index * 137) % 610),
    y: 100 + ((index * 89) % 320),
    config: nodeConfig(type),
  };
}

export function starterArchitecture(): Architecture {
  const clients = createNode("client", 0);
  const cdn = createNode("cdn", 1);
  const api = createNode("api-server", 2);
  const database = createNode("primary-database", 3);
  clients.x = 60;
  clients.y = 270;
  cdn.x = 250;
  cdn.y = 105;
  api.x = 450;
  api.y = 280;
  database.x = 665;
  database.y = 120;
  return {
    version: ARCHITECTURE_VERSION,
    name: "Underpowered starter",
    nodes: [clients, cdn, api, database],
    edges: [
      { id: crypto.randomUUID(), source: clients.id, target: cdn.id, weight: 100 },
      { id: crypto.randomUUID(), source: cdn.id, target: api.id, weight: 100 },
      { id: crypto.randomUUID(), source: api.id, target: database.id, weight: 100 },
    ],
  };
}

export function validateArchitecture(architecture: Architecture): ValidationResult {
  const ids = new Set(architecture.nodes.map((node) => node.id));
  const errors: string[] = [];
  const warnings: string[] = [];
  const clients = architecture.nodes.filter((node) => node.type === "client");

  if (clients.length === 0) errors.push("Add a Client node so the simulator has a traffic source.");
  for (const edge of architecture.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) {
      errors.push(`Connection ${edge.id} points to a component that no longer exists.`);
    }
    if (edge.source === edge.target) errors.push("A component cannot route traffic to itself.");
    if (edge.weight <= 0) errors.push("Routing weights must be greater than zero.");
  }

  for (const client of clients) {
    const visited = new Set<string>();
    const stack = [client.id];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const edge of architecture.edges.filter((candidate) => candidate.source === current)) {
        stack.push(edge.target);
      }
    }
    if (visited.size === 1) {
      errors.push(`${client.label} has no outgoing request path. Connect it to a component.`);
    }
  }

  const destinations = architecture.nodes.filter(
    (node) => !architecture.edges.some((edge) => edge.source === node.id),
  );
  if (architecture.nodes.length > 0 && destinations.length === 0) {
    errors.push("The graph has no terminal component. Break a routing loop or add a destination.");
  }
  if (!architecture.nodes.some((node) => node.type === "primary-database")) {
    warnings.push("No primary database is present; reads may fail naturally in the simulation.");
  }
  for (const node of architecture.nodes) {
    const outgoing = architecture.edges.filter((edge) => edge.source === node.id);
    if (outgoing.length > 1 && outgoing.reduce((sum, edge) => sum + edge.weight, 0) !== 100) {
      warnings.push(
        `${node.label} routes with weights that do not add to 100; they will be normalized.`,
      );
    }
  }

  return errors.length > 0
    ? { runnable: false, errors, warnings }
    : { runnable: true, errors: [], warnings };
}

export function isArchitecture(value: unknown): value is Architecture {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Architecture>;
  return (
    candidate.version === ARCHITECTURE_VERSION &&
    typeof candidate.name === "string" &&
    Array.isArray(candidate.nodes) &&
    Array.isArray(candidate.edges) &&
    candidate.nodes.every(isArchitectureNode) &&
    candidate.edges.every(isArchitectureEdge)
  );
}

function isArchitectureNode(value: unknown): value is ArchitectureNode {
  if (!value || typeof value !== "object") return false;
  const node = value as ArchitectureNode;
  const config = node.config;
  return Boolean(
    componentTypes.includes(node.type) &&
    typeof node.id === "string" &&
    typeof node.label === "string" &&
    typeof node.x === "number" &&
    typeof node.y === "number" &&
    config &&
    [
      config.replicas,
      config.capacity,
      config.concurrency,
      config.serviceTimeMs,
      config.timeoutMs,
      config.retries,
      config.cacheSize,
      config.ttlSeconds,
      config.connectionLimit,
      config.queueCapacity,
    ].every((number) => typeof number === "number") &&
    ["us-east", "us-west", "eu-west", "ap-south"].includes(config.region) &&
    config.autoscaling &&
    [
      config.autoscaling.threshold,
      config.autoscaling.minReplicas,
      config.autoscaling.maxReplicas,
      config.autoscaling.startupDelaySeconds,
      config.autoscaling.cooldownSeconds,
    ].every((number) => typeof number === "number") &&
    typeof config.autoscaling.enabled === "boolean",
  );
}

function isArchitectureEdge(value: unknown): value is ArchitectureEdge {
  if (!value || typeof value !== "object") return false;
  const edge = value as ArchitectureEdge;
  return (
    typeof edge.id === "string" &&
    typeof edge.source === "string" &&
    typeof edge.target === "string" &&
    typeof edge.weight === "number"
  );
}

export function exportArchitecture(architecture: Architecture): string {
  return JSON.stringify(architecture, null, 2);
}

export function importArchitecture(serialized: string): Architecture {
  let candidate: unknown;
  try {
    candidate = JSON.parse(serialized);
  } catch {
    throw new Error("This file is not valid JSON.");
  }
  if (!isArchitecture(candidate)) {
    throw new Error(`Import requires a ScaleLab architecture at version ${ARCHITECTURE_VERSION}.`);
  }
  if (candidate.nodes.length === 0) throw new Error("This design contains no components.");
  return candidate;
}

export type ArchitectureStorage = Pick<Storage, "getItem" | "setItem">;

export function saveArchitecture(storage: ArchitectureStorage, architecture: Architecture) {
  storage.setItem(architectureStorageKey, exportArchitecture(architecture));
}

export function restoreArchitecture(storage: ArchitectureStorage): Architecture | null {
  const saved = storage.getItem(architectureStorageKey);
  if (!saved) return null;
  try {
    return importArchitecture(saved);
  } catch {
    return null;
  }
}
