import {
  API_CAPACITY,
  COUNTER_ROW_WRITES,
  SERVICE_THREADS,
  capabilityCatalog,
  nodeLabel,
  nodeMonthlyCost,
  type Architecture,
  type Capability,
  type CallConfig,
  type ParkNodeOf,
} from "./model";
import {
  clamp01,
  nodeSnapshot,
  percentile,
  serviceMs,
  stage,
  summarize,
  trackSaturation,
  valueAt,
  type Keyframes,
  type LatencyClass,
  type NodeSnapshot,
  type OperationStat,
  type SimEvent,
  type SimulationResult,
  type Snapshot,
  type Stage,
} from "./simulation";
import type { ValidationSummary } from "./topology";

/** One kind of request, and the capabilities it needs, called in order. */
export type Operation = {
  id: string;
  label: string;
  rate: Keyframes;
  steps: Capability[];
  /** Every request is for the same link, so every click updates the same counter. */
  hot?: boolean;
};

export type ServiceIncident =
  /** A bad deploy of this capability's code: the service running it crash-loops. */
  | { at: number; type: "crash"; capability: Capability; duration: number }
  /** Calls to this capability stop answering, but connections stay open. */
  | { at: number; type: "hang"; capability: Capability; duration: number }
  /** One server holding alias locks stops the world, for example for garbage collection. */
  | { at: number; type: "pause"; duration: number }
  /** A server holding alias locks crashes without releasing them. */
  | { at: number; type: "holder-crash" };

export type ServiceScenario = {
  kind: "services";
  durationSeconds: number;
  timeScale?: string;
  operations: Operation[];
  incidents?: ServiceIncident[];
  params?: {
    /** Share of calls to a capability that fail once and succeed when tried again. */
    transientErrors?: Partial<Record<Capability, number>>;
    /** Share of alias claims that race another claim for the same alias. */
    contestedShare?: number;
  };
};

type Service = ParkNodeOf<"service">;

/** Part of a request handled by one service: locally at the entry, or through one call. */
type Segment = { owner: Service; capabilities: Capability[]; call?: CallConfig; edgeId?: string };

export type ServiceTopology = {
  /** The service that clients connect to. It calls every other service the request needs. */
  entry: Service;
  services: Service[];
  owners: Map<Capability, Service>;
  /** Segments per operation id, in the order the request first needs each service. */
  plans: Map<string, Segment[]>;
};

export type ServiceValidation =
  | { ok: true; topology: ServiceTopology; errors: []; warnings: string[] }
  | { ok: false; topology?: undefined; errors: string[]; warnings: string[] };

/** Work and latency for one call between services: network, serialization, and TLS. */
const HOP_MS = 6;
const HOP_WORK = 0.15;
/** Work and latency for the entry service to accept a request at all. */
const ENTRY_WORK = 0.3;
const ENTRY_MS = 2;
const HANG_MS = 30_000;
/** Retries with backoff may add at most this share of extra calls. */
const RETRY_BUDGET = 0.1;
const BACKOFF_MS = 100;
const BREAKER_OPEN_SECONDS = 2;

export function validateServices(architecture: Architecture, scenario: ServiceScenario): ServiceValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const services = architecture.nodes.filter((node): node is Service => node.type === "service");
  const client = architecture.nodes.find((node) => node.type === "client");
  for (const node of architecture.nodes) {
    if (node.type !== "client" && node.type !== "service") errors.push("Only services can be built in this part of the park.");
  }
  if (!client) errors.push("Add clients so the park has a source of traffic.");
  const entries = services.filter((service) =>
    architecture.edges.some((edge) => edge.source === client?.id && edge.target === service.id),
  );
  if (services.length === 0) errors.push("Build a service to answer requests.");
  else if (entries.length === 0) errors.push("Connect the clients to the service that answers them.");
  else if (entries.length > 1) errors.push("Clients enter through one service. Remove the extra client routes.");

  const owners = new Map<Capability, Service[]>();
  for (const service of services) {
    for (const capability of service.config.capabilities) {
      owners.set(capability, [...(owners.get(capability) ?? []), service]);
    }
  }
  const needed = [...new Set(scenario.operations.flatMap((operation) => operation.steps))];
  for (const capability of needed) {
    const count = owners.get(capability)?.length ?? 0;
    if (count === 0) errors.push(`Nothing runs ${capabilityCatalog[capability].label}. Give it to a service.`);
    if (count > 1) errors.push(`${capabilityCatalog[capability].label} runs in two services. Each capability lives in one service.`);
  }
  const entry = entries.length === 1 ? entries[0]! : undefined;
  if (errors.length > 0 || !entry) return { ok: false, errors, warnings };

  const owner = new Map(needed.map((capability) => [capability, owners.get(capability)![0]!]));
  const plans = new Map<string, Segment[]>();
  const used = new Set([entry.id]);
  for (const operation of scenario.operations) {
    const segments: Segment[] = [];
    for (const capability of operation.steps) {
      const service = owner.get(capability)!;
      const existing = segments.find((segment) => segment.owner.id === service.id);
      if (existing) {
        existing.capabilities.push(capability);
        continue;
      }
      if (service.id === entry.id) {
        segments.push({ owner: service, capabilities: [capability] });
        continue;
      }
      const edge = architecture.edges.find((item) => item.source === entry.id && item.target === service.id);
      if (!edge?.call) {
        errors.push(`${nodeLabel(entry)} has no route to ${nodeLabel(service)}, which runs ${capabilityCatalog[capability].label}.`);
        continue;
      }
      used.add(service.id);
      segments.push({ owner: service, capabilities: [capability], call: edge.call, edgeId: edge.id });
    }
    plans.set(operation.id, segments);
  }
  if (errors.length > 0) return { ok: false, errors: [...new Set(errors)], warnings };

  for (const service of services) {
    if (service.id === entry.id) continue;
    if (service.config.capabilities.length === 0) warnings.push("An empty service runs nothing, but still costs money.");
    else if (!used.has(service.id)) warnings.push(`${nodeLabel(service)} is not on any request path, but still costs money.`);
  }
  for (const edge of architecture.edges) {
    const source = services.find((service) => service.id === edge.source);
    const target = services.find((service) => service.id === edge.target);
    if (source && target && source.id !== entry.id) {
      warnings.push(`Only ${nodeLabel(entry)} calls other services here, so the route from ${nodeLabel(source)} is unused.`);
    }
    if (edge.source === entry.id && target && edge.call?.mode === "sync" && edge.call.retries > 0 && edge.call.timeoutMs === 0) {
      warnings.push(`Calls to ${nodeLabel(target)} retry, but never time out, so a hung call is never retried.`);
    }
  }
  return { ok: true, errors: [], warnings: [...new Set(warnings)], topology: { entry, services, owners: owner, plans } };
}

type EdgeState = {
  /** Share of attempts that failed last second. Retries react to it. */
  failure: number;
  badSeconds: number;
  openUntil: number;
  /** Messages waiting on an asynchronous route. */
  backlog: number;
};

type EngineState = {
  entryDrop: number;
  backlog: Map<string, number>;
  /** Keyed by route id. */
  edges: Map<string, EdgeState>;
  saturated: Set<string>;
  locksBlockedUntil: number;
};

export function runServiceSimulation(architecture: Architecture, scenario: ServiceScenario): SimulationResult {
  const validation = validateServices(architecture, scenario);
  if (!validation.ok) return { validation, snapshots: [], events: [], totals: summarize([], []) };
  const state: EngineState = {
    entryDrop: 0,
    backlog: new Map(),
    edges: new Map(),
    saturated: new Set(),
    locksBlockedUntil: -1,
  };
  const snapshots: Snapshot[] = [];
  const events: SimEvent[] = [];
  for (let second = 0; second < scenario.durationSeconds; second += 1) {
    snapshots.push(tick(architecture, validation.topology, scenario, state, second, events));
  }
  return { validation, snapshots, events, totals: summarize(snapshots, events) };
}

function tick(
  architecture: Architecture,
  topology: ServiceTopology,
  scenario: ServiceScenario,
  state: EngineState,
  second: number,
  events: SimEvent[],
): Snapshot {
  const { entry, services, owners, plans } = topology;
  const emit = (kind: SimEvent["kind"], message: string, node?: string) => events.push({ second, kind, message, node });
  const transient = scenario.params?.transientErrors ?? {};
  const contested = scenario.params?.contestedShare ?? 0;
  const locksOwner = owners.get("locks");
  const linksOwner = owners.get("links");

  // Incidents in effect this second.
  const crashed = new Set<string>();
  const hung = new Set<Capability>();
  let pause: { elapsed: number } | undefined;
  for (const incident of scenario.incidents ?? []) {
    if (incident.type === "pause") {
      if (second >= incident.at && second < incident.at + incident.duration) pause = { elapsed: second - incident.at };
      if (second === incident.at) {
        emit("incident", `A server holding alias locks paused for ${incident.duration}s to collect garbage. It does not know it stopped.`, locksOwner?.id);
      }
      continue;
    }
    if (incident.type === "holder-crash") {
      if (incident.at === second && locksOwner) {
        state.locksBlockedUntil = second + locksOwner.config.leaseSeconds;
        emit("incident", `A server crashed while holding alias locks. Those aliases stay locked for ${locksOwner.config.leaseSeconds}s, until the leases expire.`, locksOwner.id);
      }
      continue;
    }
    const owner = owners.get(incident.capability);
    if (!owner) continue;
    if (second === incident.at + incident.duration) emit("recovery", `${incidentLabel(incident.type, incident.capability)} is over.`, owner.id);
    if (second < incident.at || second >= incident.at + incident.duration) continue;
    if (second === incident.at) emit("incident", incidentMessage(incident, owner), owner.id);
    if (incident.type === "crash") crashed.add(owner.id);
    else hung.add(incident.capability);
  }

  // Requests arriving at the entry. Calls go out for the share it accepted last second.
  const operations = scenario.operations.map((operation) => ({
    operation,
    rate: valueAt(operation.rate, second),
    segments: plans.get(operation.id)!,
  }));
  const accepted = crashed.has(entry.id) ? 0 : 1 - state.entryDrop;
  const unitsOf = (segment: Segment) => segment.capabilities.reduce((sum, item) => sum + capabilityCatalog[item].work, 0);

  // Synchronous routes: retries react to last second's failures; an open breaker sends nothing.
  const routePlans = new Map<string, { open: boolean; extra: number; budgetShare: number }>();
  for (const { segments } of operations) {
    for (const segment of segments) {
      if (!segment.call || segment.call.mode !== "sync" || routePlans.has(segment.edgeId!)) continue;
      const edge = edgeState(state, segment.edgeId!);
      if (edge.openUntil === second) {
        emit("recovery", `The circuit breaker to ${nodeLabel(segment.owner)} closed and lets calls through again.`, segment.owner.id);
      }
      routePlans.set(segment.edgeId!, { open: edge.openUntil > second, ...retryPlan(segment.call, edge.failure) });
    }
  }

  // Work per service. Each call costs a hop on both sides.
  const work = new Map<string, number>(services.map((service) => [service.id, 0]));
  const addWork = (id: string, units: number) => work.set(id, (work.get(id) ?? 0) + units);
  const hotCounterCalls = { sync: 0 };
  const messages = new Map<string, { owner: Service; arriving: number; units: number; hot: boolean; analytics: boolean }>();
  for (const { operation, rate, segments } of operations) {
    const hotCounter = Boolean(operation.hot);
    const requests = rate * accepted;
    addWork(entry.id, requests * ENTRY_WORK);
    for (const segment of segments) {
      const units = unitsOf(segment);
      if (!segment.call) {
        addWork(entry.id, requests * units);
        if (hotCounter && segment.capabilities.includes("analytics")) hotCounterCalls.sync += requests;
      } else if (segment.call.mode === "async") {
        addWork(entry.id, requests * HOP_WORK);
        // Hot-counter messages queue separately: they wait on one row's lock, the rest do not.
        const hot = hotCounter && segment.capabilities.includes("analytics");
        const key = `${segment.edgeId!}${hot ? ":hot" : ""}`;
        const analytics = segment.capabilities.includes("analytics");
        const queue = messages.get(key) ?? { owner: segment.owner, arriving: 0, units: 0, hot, analytics };
        queue.units = (queue.units * queue.arriving + (units + HOP_WORK) * requests) / Math.max(1e-9, queue.arriving + requests);
        queue.arriving += requests;
        messages.set(key, queue);
      } else {
        const plan = routePlans.get(segment.edgeId!)!;
        const sent = plan.open ? 0 : requests * (1 + plan.extra);
        addWork(entry.id, sent * HOP_WORK);
        addWork(segment.owner.id, sent * (units + HOP_WORK));
        if (hotCounter && segment.capabilities.includes("analytics")) hotCounterCalls.sync += sent;
      }
    }
  }
  const capacity = (service: Service) =>
    crashed.has(service.id) ? 0 : service.config.instances * API_CAPACITY[service.config.size];
  const stages = new Map<string, Stage>();
  for (const service of services) {
    const load = work.get(service.id) ?? 0;
    const backlog = state.backlog.get(service.id) ?? 0;
    const current = stage(load, backlog, capacity(service));
    stages.set(service.id, current);
    state.backlog.set(service.id, current.backlog);
  }

  // A viral link's clicks all update one counter, and every write takes that row's lock.
  const counterRows = owners.get("analytics")?.config.counterShards ?? 1;
  const rowLimit = counterRows * COUNTER_ROW_WRITES;
  const rowFailure = hotCounterCalls.sync > rowLimit ? 1 - rowLimit / hotCounterCalls.sync : 0;
  let rowsUsed = Math.min(hotCounterCalls.sync, rowLimit);

  // Queued messages use whatever capacity synchronous calls leave over.
  let queueBacklog = 0;
  const clicks = { waiting: 0, arriving: 0 };
  for (const [key, queue] of messages) {
    const edge = edgeState(state, key);
    const spare = Math.max(0, capacity(queue.owner) - (work.get(queue.owner.id) ?? 0));
    const available = edge.backlog + queue.arriving;
    const delivered = Math.min(available, spare / queue.units, queue.hot ? Math.max(0, rowLimit - rowsUsed) : Infinity);
    if (queue.hot) rowsUsed += delivered;
    edge.backlog = available - delivered;
    addWork(queue.owner.id, delivered * queue.units);
    queueBacklog += edge.backlog;
    if (queue.analytics) {
      clicks.waiting += edge.backlog;
      clicks.arriving += queue.arriving;
    }
  }
  // How long a click arriving now waits to be counted, at the current arrival rate.
  const analyticsDelaySeconds = clicks.waiting / Math.max(1, clicks.arriving);

  // Each request's latency, success after retries, and how long it holds an entry thread.
  const entryStage = stages.get(entry.id)!;
  const entryMs = serviceMs(ENTRY_MS, entryStage);
  const locksBlocked = second < state.locksBlockedUntil;
  const routeFailures = new Map<string, { failed: number; sent: number }>();
  const classes: LatencyClass[] = [];
  const operationStats: OperationStat[] = [];
  let inFlight = 0;
  let clicksLost = 0;
  for (const { operation, rate, segments } of operations) {
    const requests = rate * accepted;
    let latency = entryMs;
    let hold = entryMs;
    let success = 1;
    for (const segment of segments) {
      if (segment.call?.mode === "async") {
        latency += 1;
        hold += 1;
        continue;
      }
      const owner = segment.owner;
      const ownerStage = stages.get(owner.id)!;
      let stepMs = segment.capabilities.some((item) => hung.has(item))
        ? HANG_MS
        : segment.capabilities.reduce((sum, item) => sum + serviceMs(capabilityCatalog[item].ms, ownerStage), 0) +
          (segment.call ? HOP_MS : 0);
      let failure =
        1 - (1 - ownerStage.dropFraction) * (1 - (operation.hot && segment.capabilities.includes("analytics") ? rowFailure : 0));
      for (const item of segment.capabilities) failure = 1 - (1 - failure) * (1 - (transient[item] ?? 0));
      if (crashed.has(owner.id)) {
        failure = 1;
        stepMs = segment.call ? HOP_MS : 0;
      }
      let stepSuccess = 1 - failure;
      let stepHold = stepMs;
      if (segment.call) {
        const call = segment.call;
        const plan = routePlans.get(segment.edgeId!)!;
        if (call.timeoutMs > 0 && stepMs > call.timeoutMs) {
          failure = 1;
          stepMs = call.timeoutMs;
        }
        stepSuccess = 1 - failure;
        stepHold = stepMs;
        if (plan.open) {
          stepSuccess = 0;
          stepMs = 1;
          stepHold = 1;
        } else {
          const record = routeFailures.get(segment.edgeId!) ?? { failed: 0, sent: 0 };
          record.failed += requests * failure;
          record.sent += requests;
          routeFailures.set(segment.edgeId!, record);
          if (call.retries > 0) {
            const recovered = failure - failure ** (call.retries + 1);
            stepSuccess = 1 - failure + (call.backoff ? plan.budgetShare * recovered : recovered);
            stepHold = stepMs * (1 + plan.extra) + (call.backoff ? BACKOFF_MS * plan.extra : 0);
            stepMs = stepHold;
          }
        }
        if (segment.capabilities.includes("analytics")) clicksLost += requests * (1 - stepSuccess);
        const fallback = call.fallback && segment.capabilities.every((item) => capabilityCatalog[item].fallback);
        if (fallback) stepSuccess = 1;
      } else if (segment.capabilities.includes("analytics")) {
        clicksLost += requests * failure;
      }
      latency += stepMs;
      hold += stepHold;
      success *= stepSuccess;
    }
    if (locksBlocked && operation.steps.includes("locks")) success *= 1 - contested;
    // Every arriving request wants a thread, including ones that will be turned away.
    inFlight += (rate * hold) / 1000;
    operationStats.push({ id: operation.id, label: operation.label, demand: rate, successful: success });
    classes.push({ label: operation.label, volume: 0, latencyMs: Math.round(Math.min(HANG_MS, latency)) });
  }

  // Breakers trip after two bad seconds in a row.
  for (const [edgeId, record] of routeFailures) {
    const edge = edgeState(state, edgeId);
    const segment = operations.flatMap((item) => item.segments).find((item) => item.edgeId === edgeId)!;
    edge.failure = record.sent > 0 ? record.failed / record.sent : 0;
    if (!segment.call?.circuitBreaker) continue;
    edge.badSeconds = edge.failure > 0.5 ? edge.badSeconds + 1 : 0;
    if (edge.badSeconds >= 2) {
      edge.openUntil = second + 1 + BREAKER_OPEN_SECONDS;
      edge.badSeconds = 0;
      edge.failure = 0;
      emit("info", `The circuit breaker to ${nodeLabel(segment.owner)} opened: calls fail fast for ${BREAKER_OPEN_SECONDS}s.`, segment.owner.id);
    }
  }

  // Requests hold a thread at the entry while they wait on their calls.
  const threads = crashed.has(entry.id) ? 0 : entry.config.instances * SERVICE_THREADS[entry.config.size];
  const threadDrop = inFlight > threads ? 1 - threads / inFlight : 0;
  const entryDrop = crashed.has(entry.id) ? 1 : 1 - (1 - entryStage.dropFraction) * (1 - threadDrop);
  if (threadDrop > 0.01 && state.entryDrop <= 0.01 && !crashed.has(entry.id)) {
    emit("info", `${nodeLabel(entry)} ran out of threads: ${Math.round(inFlight).toLocaleString()} requests are waiting on calls, so new ones are turned away.`, entry.id);
  }
  state.entryDrop = entryDrop;

  let successful = 0;
  operationStats.forEach((stat, index) => {
    stat.successful = stat.demand * (1 - entryDrop) * stat.successful;
    classes[index]!.volume = stat.successful;
    successful += stat.successful;
  });
  const demand = operations.reduce((sum, item) => sum + item.rate, 0);

  // Leases that expire while their holder is paused let a second claimant in.
  const lease = locksOwner?.config.leaseSeconds ?? Infinity;
  const claimRate = operations
    .filter(({ operation }) => operation.steps.includes("locks") && operation.steps.includes("links"))
    .reduce((sum, item) => sum + item.rate, 0);
  const doubleClaims = pause && pause.elapsed >= lease && !linksOwner?.config.fencing ? claimRate * contested : 0;
  if (pause && pause.elapsed === lease && claimRate > 0) {
    emit(
      "info",
      linksOwner?.config.fencing
        ? "Leases expired during the pause. Fencing tokens reject the paused server's stale writes."
        : "Leases expired during the pause. Other servers took the same aliases while the paused server still thinks it holds them.",
      linksOwner?.id,
    );
  }

  const nodes: Record<string, NodeSnapshot> = {};
  const client = architecture.nodes.find((node) => node.type === "client");
  if (client) nodes[client.id] = nodeSnapshot(demand, Infinity, stage(0, 0, 1), `${Math.round(demand).toLocaleString()} req/s`);
  for (const service of services) {
    const current = stages.get(service.id)!;
    const isEntry = service.id === entry.id;
    const shown: Stage = isEntry ? { ...current, dropFraction: Math.max(current.dropFraction, threadDrop) } : current;
    nodes[service.id] = nodeSnapshot(
      work.get(service.id) ?? 0,
      capacity(service),
      crashed.has(service.id) ? { ...shown, dropFraction: 1 } : shown,
      crashed.has(service.id)
        ? "Crash-looping after a bad deploy"
        : isEntry
            ? `${Math.round(inFlight).toLocaleString()} of ${threads.toLocaleString()} threads in use`
            : `${Math.round(work.get(service.id) ?? 0).toLocaleString()} units/s`,
    );
  }
  trackSaturation(
    services.map((service) => ({ id: service.id, label: nodeLabel(service), snapshot: nodes[service.id]! })),
    state.saturated,
    (kind, message, id) => emit(kind, message, id),
  );

  return {
    second,
    demand: Math.round(demand),
    successful: Math.round(successful),
    availability: demand > 0 ? clamp01(successful / demand) : 1,
    p95Ms: percentile(classes, 0.95),
    monthlyCost: architecture.nodes.reduce((total, node) => total + nodeMonthlyCost(node), 0),
    classes,
    nodes,
    cacheHitRate: 0,
    staleReads: 0,
    notFound: 0,
    lostWrites: 0,
    lostLinks: 0,
    duplicates: 0,
    loggedOut: 0,
    legitRejected: 0,
    botsPassed: 0,
    viewers: 0,
    viewersConnected: 1,
    freshnessSeconds: 0,
    missedUpdates: 0,
    queueBacklog: Math.round(queueBacklog),
    analyticsDelaySeconds,
    apiInstances: { running: entry.config.instances, warming: 0, crashed: crashed.has(entry.id) ? entry.config.instances : 0 },
    replicaLagSeconds: 0,
    operations: operationStats,
    clicksLost,
    doubleClaims,
  };
}

function edgeState(state: EngineState, edgeId: string): EdgeState {
  let edge = state.edges.get(edgeId);
  if (!edge) {
    edge = { failure: 0, badSeconds: 0, openUntil: -1, backlog: 0 };
    state.edges.set(edgeId, edge);
  }
  return edge;
}

/**
 * Extra attempts per call. Immediate retries resend every failure up to the limit.
 * Backoff spreads retries out and caps them at a budget, so a failing service is not buried.
 */
function retryPlan(call: CallConfig, failure: number) {
  let wanted = 0;
  for (let attempt = 1; attempt <= call.retries; attempt += 1) wanted += failure ** attempt;
  if (!call.backoff || wanted <= 0) return { extra: wanted, budgetShare: 1 };
  const budgetShare = Math.min(1, RETRY_BUDGET / wanted);
  return { extra: wanted * budgetShare, budgetShare };
}

function incidentLabel(type: "crash" | "hang", capability: Capability) {
  const name = capabilityCatalog[capability].label;
  return type === "crash" ? `The bad ${name} deploy` : `The ${name} hang`;
}

function incidentMessage(incident: Extract<ServiceIncident, { type: "crash" | "hang" }>, owner: Service) {
  const name = capabilityCatalog[incident.capability].label;
  if (incident.type === "crash") {
    return `A bad ${name} deploy went out. ${nodeLabel(owner)} crash-loops for ${incident.duration}s.`;
  }
  return `${name} stopped answering. Calls to it hang with their connections open for ${incident.duration}s.`;
}
