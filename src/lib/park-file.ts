import {
  ARCHITECTURE_VERSION,
  defaultConfig,
  nodeTypes,
  sizes,
  type Architecture,
  type NodeType,
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
};

/** A value matches when it has exactly the shape of the default configuration. */
function matchesShape(value: unknown, template: unknown, key = ""): boolean {
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

export function isArchitecture(value: unknown): value is Architecture {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.version === ARCHITECTURE_VERSION &&
    Array.isArray(candidate.nodes) &&
    candidate.nodes.every(isNode) &&
    Array.isArray(candidate.edges) &&
    candidate.edges.every(
      (edge) =>
        edge &&
        typeof edge === "object" &&
        typeof edge.id === "string" &&
        typeof edge.source === "string" &&
        typeof edge.target === "string",
    )
  );
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
  if (!isArchitecture(candidate)) {
    throw new Error(`This is not a ScaleLab park file (version ${ARCHITECTURE_VERSION}).`);
  }
  return candidate;
}
