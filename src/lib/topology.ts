import {
  canConnect,
  findNode,
  hasEdge,
  nodeCatalog,
  type Architecture,
  type NodeType,
  type ParkNodeOf,
} from "./model";

/** The request paths a park actually supports, derived from its buildings and routes. */
export type Topology = {
  api: ParkNodeOf<"api">;
  database: ParkNodeOf<"database">;
  loadBalancer?: ParkNodeOf<"load-balancer">;
  cache?: ParkNodeOf<"cache">;
  replica?: ParkNodeOf<"replica">;
  queue?: ParkNodeOf<"queue">;
  worker?: ParkNodeOf<"worker">;
  pubsub?: ParkNodeOf<"pubsub">;
  archive?: ParkNodeOf<"archive">;
  /** Nodes that receive work in this design. Idle buildings still cost money. */
  active: Set<NodeType>;
};

export type ValidationSummary = { ok: boolean; errors: string[]; warnings: string[] };

export type Validation =
  | { ok: true; topology: Topology; errors: []; warnings: string[] }
  | { ok: false; topology?: undefined; errors: string[]; warnings: string[] };

export function validatePark(architecture: Architecture): Validation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const counts = new Map<NodeType, number>();
  for (const node of architecture.nodes) counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
  for (const [type, count] of counts) {
    if (count > 1) errors.push(`Only one ${nodeCatalog[type].label.toLowerCase()} building is allowed.`);
  }
  const ids = new Map(architecture.nodes.map((node) => [node.id, node]));
  for (const edge of architecture.edges) {
    const source = ids.get(edge.source);
    const target = ids.get(edge.target);
    if (!source || !target) {
      errors.push("A route points to a building that no longer exists.");
      continue;
    }
    if (!canConnect(source.type, target.type)) {
      errors.push(`${nodeCatalog[source.type].label} cannot route to ${nodeCatalog[target.type].label}.`);
    }
  }

  const client = findNode(architecture, "client");
  const api = findNode(architecture, "api");
  const database = findNode(architecture, "database");
  const loadBalancer = findNode(architecture, "load-balancer");
  if (!client) errors.push("Add clients so the park has a source of traffic.");
  if (!api) errors.push("Build an API server to handle requests.");
  if (!database) errors.push("Build a database to store links.");

  const viaBalancer = hasEdge(architecture, "client", "load-balancer");
  const direct = hasEdge(architecture, "client", "api");
  if (client && api && !viaBalancer && !direct) {
    errors.push("Connect the clients to the API server, directly or through a load balancer.");
  }
  if (viaBalancer && !hasEdge(architecture, "load-balancer", "api")) {
    errors.push("The load balancer has no API servers to send traffic to.");
  }
  if (viaBalancer && direct) {
    warnings.push("Clients reach the API both directly and through the balancer; the balancer is used.");
  }
  if (api && database && !hasEdge(architecture, "api", "database")) {
    errors.push("Connect the API server to the database so it can read and write links.");
  }
  if (errors.length > 0 || !api || !database) return { ok: false, errors, warnings };

  const active = new Set<NodeType>(["client", "api", "database"]);
  const usesBalancer = Boolean(loadBalancer && viaBalancer);
  if (usesBalancer) active.add("load-balancer");
  const cache = hasEdge(architecture, "api", "cache") ? findNode(architecture, "cache") : undefined;
  if (cache) active.add("cache");

  let replica: ParkNodeOf<"replica"> | undefined;
  if (hasEdge(architecture, "api", "replica")) {
    if (hasEdge(architecture, "database", "replica")) {
      replica = findNode(architecture, "replica");
      active.add("replica");
    } else {
      warnings.push("The read replica has no data: route the database to it for replication.");
    }
  }

  let queue: ParkNodeOf<"queue"> | undefined;
  let worker: ParkNodeOf<"worker"> | undefined;
  if (hasEdge(architecture, "api", "queue")) {
    if (hasEdge(architecture, "queue", "worker") && hasEdge(architecture, "worker", "database")) {
      queue = findNode(architecture, "queue");
      worker = findNode(architecture, "worker");
      active.add("queue");
      active.add("worker");
    } else {
      warnings.push("Jobs need a path: queue → worker → database. Until then, work stays in the request.");
    }
  }

  const pubsub = hasEdge(architecture, "api", "pubsub") ? findNode(architecture, "pubsub") : undefined;
  if (pubsub) active.add("pubsub");
  const archive = hasEdge(architecture, "database", "archive")
    ? findNode(architecture, "archive")
    : undefined;
  if (archive) active.add("archive");

  if (api.config.instances > 1 && !usesBalancer) {
    warnings.push("Without a load balancer, clients only ever reach one API server.");
  }
  if (api.config.sessions === "shared" && !cache) {
    warnings.push("Shared sessions need a cache to live in; sessions stay in server memory.");
  }
  if (api.config.rateLimit.enabled && api.config.rateLimit.counters === "shared" && !cache) {
    warnings.push("Shared rate-limit counters need a cache; each server counts on its own.");
  }
  if (database.config.archiveAfter !== "never" && !archive) {
    warnings.push("Archiving needs archive storage routed from the database.");
  }
  for (const node of architecture.nodes) {
    if (!active.has(node.type)) {
      warnings.push(`${nodeCatalog[node.type].label} is not on any request path, but still costs money.`);
    }
  }

  return {
    ok: true,
    errors: [],
    warnings,
    topology: {
      api,
      database,
      loadBalancer: usesBalancer ? loadBalancer : undefined,
      cache,
      replica,
      queue,
      worker,
      pubsub,
      archive,
      active,
    },
  };
}
