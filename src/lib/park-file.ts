import {
  ARCHITECTURE_VERSION,
  capabilities,
  defaultCall,
  defaultConfig,
  nodeTypes,
  sizes,
  type Architecture,
  type CallConfig,
  type NodeType,
  type ParkEdge,
  type ParkNode,
} from "./model";

/** Allowed values for configuration fields that are not free numbers or booleans. */
const enums: Record<string, readonly string[]> = {
  size: sizes,
  sessions: ["memory", "shared"],
  readAfterWrite: ["replica", "primary"],
  mode: ["poll", "push"],
  algorithm: ["fixed-window", "token-bucket"],
  counters: ["local", "shared"],
  replication: ["async", "sync"],
  failover: ["manual", "automatic"],
  backups: ["none", "daily", "hourly", "continuous"],
  archiveAfter: ["never", "1y", "90d"],
  partitioning: ["none", "monthly"],
  shardKey: ["created-at", "hash"],
  capabilities,
};

/** A value matches when it has exactly the shape of the default configuration. */
function matchesShape(value: unknown, template: unknown, key = ""): boolean {
  if (Array.isArray(template)) {
    return (
      Array.isArray(value) &&
      new Set(value).size === value.length &&
      value.every((item) => typeof item === "string" && (enums[key]?.includes(item) ?? false))
    );
  }
  if (typeof template === "number") return typeof value === "number" && Number.isFinite(value);
  if (typeof template === "boolean") return typeof value === "boolean";
  if (typeof template === "string") {
    return typeof value === "string" && (enums[key]?.includes(value) ?? false);
  }
  if (!template || typeof template !== "object" || !value || typeof value !== "object") return false;
  const expected = Object.keys(template);
  const actual = Object.keys(value);
  return (
    expected.length === actual.length &&
    expected.every((field) =>
      matchesShape((value as Record<string, unknown>)[field], (template as Record<string, unknown>)[field], field),
    )
  );
}

function isNode(value: unknown): value is ParkNode {
  if (!value || typeof value !== "object") return false;
  const node = value as Record<string, unknown>;
  return (
    typeof node.id === "string" &&
    nodeTypes.includes(node.type as NodeType) &&
    typeof node.x === "number" &&
    typeof node.y === "number" &&
    matchesShape(node.config, defaultConfig(node.type as NodeType))
  );
}

function isCall(value: unknown): value is CallConfig {
  if (!value || typeof value !== "object") return false;
  const call = value as Record<string, unknown>;
  return (
    Object.keys(call).length === Object.keys(defaultCall).length &&
    (call.mode === "sync" || call.mode === "async") &&
    typeof call.timeoutMs === "number" &&
    Number.isFinite(call.timeoutMs) &&
    typeof call.retries === "number" &&
    Number.isFinite(call.retries) &&
    typeof call.backoff === "boolean" &&
    typeof call.circuitBreaker === "boolean" &&
    typeof call.fallback === "boolean"
  );
}

function isEdge(value: unknown): value is ParkEdge {
  if (!value || typeof value !== "object") return false;
  const edge = value as Record<string, unknown>;
  return (
    typeof edge.id === "string" &&
    typeof edge.source === "string" &&
    typeof edge.target === "string" &&
    (edge.call === undefined || isCall(edge.call))
  );
}

/**
 * Read a saved or imported park. Version 3 parks predate services and call settings,
 * so every one of them is also a valid version 4 park.
 */
export function parseArchitecture(value: unknown): Architecture | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  const valid =
    (candidate.version === ARCHITECTURE_VERSION || candidate.version === 3) &&
    Array.isArray(candidate.nodes) &&
    candidate.nodes.every(isNode) &&
    Array.isArray(candidate.edges) &&
    candidate.edges.every(isEdge);
  return valid ? ({ ...candidate, version: ARCHITECTURE_VERSION } as Architecture) : undefined;
}

export function exportPark(architecture: Architecture) {
  return JSON.stringify(architecture, null, 2);
}

export function importPark(serialized: string): Architecture {
  let candidate: unknown;
  try {
    candidate = JSON.parse(serialized);
  } catch {
    throw new Error("This file is not valid JSON.");
  }
  const park = parseArchitecture(candidate);
  if (!park) throw new Error(`This is not a ScaleLab park file (version ${ARCHITECTURE_VERSION}).`);
  return park;
}
