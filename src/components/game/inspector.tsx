import { Activity, Minus, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import {
  API_CAPACITY,
  API_CONNECTIONS,
  API_COST,
  CACHE_CAPACITY,
  CACHE_COST,
  DB_CAPACITY,
  DB_COST,
  DB_MEMORY_ROWS,
  MAX_INSTANCES,
  MAX_COUNTER_SHARDS,
  MAX_SHARDS,
  SERVICE_THREADS,
  WORKER_CAPACITY,
  capabilities,
  capabilityCatalog,
  nodeCatalog,
  nodeLabel,
  nodeComplexity,
  nodeMonthlyCost,
  sizes,
  type Architecture,
  type CallConfig,
  type Capability,
  type Feature,
  type NodeConfigs,
  type ParkNode,
  type Size,
} from "@/lib/model";
import type { NodeSnapshot } from "@/lib/simulation";

import { buildingLook, formatMoney } from "./buildings";

type Change = (config: Partial<NodeConfigs[ParkNode["type"]]>) => void;

export function Inspector({
  node,
  architecture,
  features,
  metrics,
  editable,
  capabilityOptions,
  onChange,
  onRouteChange,
  onRemove,
  onDisconnect,
  onClose,
}: {
  node: ParkNode;
  architecture: Architecture;
  features: ReadonlySet<Feature>;
  metrics?: NodeSnapshot;
  editable: boolean;
  /** Capabilities this level's requests need, in catalog order. */
  capabilityOptions: readonly Capability[];
  onChange: Change;
  onRouteChange: (edgeId: string, change: Partial<CallConfig>) => void;
  onRemove: () => void;
  onDisconnect: (edgeId: string) => void;
  onClose: () => void;
}) {
  const { icon: Icon, color } = buildingLook[node.type];
  const [section, setSection] = useState<"settings" | "routes" | null>("settings");
  useEffect(() => setSection("settings"), [node.id]);
  const routes = architecture.edges
    .filter((edge) => edge.source === node.id)
    .map((edge) => ({ edge, target: architecture.nodes.find((candidate) => candidate.id === edge.target) }));
  const settings = settingsFor(node, architecture, features, capabilityOptions, editable, onChange);
  const health = metrics?.health ?? "ready";
  return (
    <aside className="building-inspector" aria-label={`${nodeLabel(node)} controls`}>
      <header className="inspector-header">
        <div className="inspector-header-main">
          <div className={`inspector-avatar ${color}`}>
            <Icon />
          </div>
          <div className="inspector-identity">
            <span className="inspector-kicker">{formatMoney(nodeMonthlyCost(node))}/mo · complexity {nodeComplexity(node)}</span>
            <h2>{nodeLabel(node)}</h2>
            <div className={`inspector-health status-${health}`}>
              <Activity />
              <span>{health === "saturated" ? "overloaded" : health}</span>
            </div>
          </div>
          <button className="inspector-close" type="button" onClick={onClose} aria-label="Close building controls">
            <X />
          </button>
        </div>
        <dl className="inspector-overview">
          <div>
            <dt>Load</dt>
            <dd>{metrics ? metrics.load.toLocaleString() : "-"}</dd>
          </div>
          <div>
            <dt>Capacity</dt>
            <dd>{metrics ? (Number.isFinite(metrics.capacity) ? metrics.capacity.toLocaleString() : "∞") : "-"}</dd>
          </div>
          <div>
            <dt>Busy</dt>
            <dd>{metrics && Number.isFinite(metrics.capacity) ? `${Math.round(Math.min(9.99, metrics.utilization) * 100)}%` : "-"}</dd>
          </div>
        </dl>
        <p className="inspector-role">{metrics?.detail ?? nodeCatalog[node.type].role}</p>
      </header>

      <div className="inspector-scroll">
        <section className="inspector-section inspector-accordion">
          <button
            className="inspector-accordion-trigger"
            type="button"
            aria-expanded={section === "settings"}
            onClick={() => setSection((open) => (open === "settings" ? null : "settings"))}
          >
            <span>Settings</span>
            <Plus aria-hidden="true" />
          </button>
          <div className="inspector-accordion-panel" hidden={section !== "settings"}>
            <p className="inspector-math">{capacityMath(node)}</p>
            {settings.length > 0 ? (
              <div className="inspector-config">{settings}</div>
            ) : (
              <p className="inspector-empty">No settings to change in this level.</p>
            )}
          </div>
        </section>
        <section className="inspector-section inspector-accordion inspector-routes">
          <button
            className="inspector-accordion-trigger"
            type="button"
            aria-expanded={section === "routes"}
            onClick={() => setSection((open) => (open === "routes" ? null : "routes"))}
          >
            <span>Routes out</span>
            <small>{routes.length}</small>
            <Plus aria-hidden="true" />
          </button>
          <div className="inspector-accordion-panel" hidden={section !== "routes"}>
            {routes.length === 0 ? (
              <p className="inspector-empty">No outgoing routes. Drag the arrow handle to another building.</p>
            ) : (
              <div className="inspector-route-list">
                {routes.map(({ edge, target }) => (
                  <div className="inspector-route-config" key={edge.id}>
                    <div className="inspector-route-destination">
                      <span>To</span>
                      <strong>{target ? nodeLabel(target) : "Missing building"}</strong>
                    </div>
                    {edge.call && (
                      <div className="inspector-config">
                        {callSettings(edge.call, target, features, editable, (change) => onRouteChange(edge.id, change))}
                      </div>
                    )}
                    {editable && (
                      <button type="button" onClick={() => onDisconnect(edge.id)}>
                        <Trash2 />
                        Disconnect
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {node.type !== "client" && editable && (
        <footer className="inspector-actions">
          <button className="inspector-delete" type="button" onClick={onRemove}>
            <Trash2 /> Remove building
          </button>
        </footer>
      )}
    </aside>
  );
}

function capacityMath(node: ParkNode) {
  switch (node.type) {
    case "api":
      return `Each ${node.config.size} server handles ${API_CAPACITY[node.config.size].toLocaleString()} req/s and holds ${API_CONNECTIONS[node.config.size].toLocaleString()} open connections, for ${formatMoney(API_COST[node.config.size])}/mo.`;
    case "database":
      return `A ${node.config.size} database does ${DB_CAPACITY[node.config.size].toLocaleString()} units of work per second and keeps ${(DB_MEMORY_ROWS[node.config.size] / 1_000_000).toLocaleString()}M rows in memory. An indexed read in memory costs 1 unit; a write costs about 2.5.`;
    case "replica":
      return `Each ${node.config.size} replica does ${DB_CAPACITY[node.config.size].toLocaleString()} units of reads per second, and must also apply every write.`;
    case "cache":
      return `A ${node.config.size} cache handles ${CACHE_CAPACITY[node.config.size].toLocaleString()} operations per second. Longer TTLs mean more hits and staler data.`;
    case "worker":
      return `Each worker processes ${WORKER_CAPACITY.toLocaleString()} jobs per second, writing them to the database in batches.`;
    case "load-balancer":
      return "Spreads requests evenly across every API server it can reach.";
    case "service":
      return `Each ${node.config.size} instance does ${API_CAPACITY[node.config.size].toLocaleString()} units of work per second and holds ${SERVICE_THREADS[node.config.size].toLocaleString()} requests at once, for ${formatMoney(API_COST[node.config.size])}/mo. A request holds its thread while it waits on other services.`;
    default:
      return nodeCatalog[node.type].role;
  }
}

function settingsFor(
  node: ParkNode,
  architecture: Architecture,
  features: ReadonlySet<Feature>,
  capabilityOptions: readonly Capability[],
  editable: boolean,
  onChange: Change,
): ReactNode[] {
  const has = (feature: Feature) => features.has(feature);
  const fields: ReactNode[] = [];
  const size = (label: string, value: Size, costs: Record<Size, number>, options: readonly Size[] = sizes) =>
    fields.push(
      <SelectField
        key="size"
        label={label}
        value={value}
        disabled={!editable}
        options={options.map((option) => ({ value: option, label: `${option} · ${formatMoney(costs[option])}/mo` }))}
        onChange={(next) => onChange({ size: next as Size })}
      />,
    );
  switch (node.type) {
    case "api": {
      const config = node.config;
      if (has("size")) size("Server size", config.size, API_COST);
      if (has("instances") && !config.autoscaling.enabled) {
        fields.push(
          <Stepper key="instances" label="Servers" value={config.instances} min={1} max={MAX_INSTANCES} disabled={!editable} onChange={(instances) => onChange({ instances })} />,
        );
      }
      if (has("sessions")) {
        fields.push(
          <SelectField key="sessions" label="Login sessions" value={config.sessions} disabled={!editable} options={[{ value: "memory", label: "Server memory" }, { value: "shared", label: "Shared cache" }]} onChange={(sessions) => onChange({ sessions: sessions as typeof config.sessions })} />,
        );
      }
      if (has("read-after-write")) {
        fields.push(
          <SelectField key="raw" label="Reads after a create" value={config.readAfterWrite} disabled={!editable} options={[{ value: "replica", label: "Any replica" }, { value: "primary", label: "Primary" }]} onChange={(readAfterWrite) => onChange({ readAfterWrite: readAfterWrite as typeof config.readAfterWrite })} />,
        );
      }
      if (has("live-mode")) {
        fields.push(
          <SelectField key="live" label="Live updates" value={config.live.mode} disabled={!editable} options={[{ value: "poll", label: "Polling" }, { value: "push", label: "Push (open connection)" }]} onChange={(mode) => onChange({ live: { ...config.live, mode: mode as "poll" | "push" } })} />,
        );
        if (config.live.mode === "poll") {
          fields.push(
            <NumberField key="poll" label="Poll every" unit="s" value={config.live.pollSeconds} min={1} max={30} disabled={!editable} onChange={(pollSeconds) => onChange({ live: { ...config.live, pollSeconds } })} />,
          );
        }
      }
      if (has("rate-limit")) {
        const limit = config.rateLimit;
        const setLimit = (change: Partial<typeof limit>) => onChange({ rateLimit: { ...limit, ...change } });
        fields.push(
          <Toggle key="rl" label="Rate limit each client" detail="Reject requests over the limit before doing any work" checked={limit.enabled} disabled={!editable} onChange={(enabled) => setLimit({ enabled })} />,
        );
        if (limit.enabled) {
          fields.push(
            <SelectField key="rl-alg" label="Algorithm" value={limit.algorithm} disabled={!editable} options={[{ value: "fixed-window", label: "Fixed window" }, { value: "token-bucket", label: "Token bucket" }]} onChange={(algorithm) => setLimit({ algorithm: algorithm as typeof limit.algorithm })} />,
            <NumberField key="rl-rate" label={limit.algorithm === "fixed-window" ? "Limit per second" : "Refill per second"} value={limit.rate} min={0.5} max={100} step={0.5} disabled={!editable} onChange={(rate) => setLimit({ rate })} />,
          );
          if (limit.algorithm === "token-bucket") {
            fields.push(
              <NumberField key="rl-burst" label="Bucket size" value={limit.burst} min={1} max={100} disabled={!editable} onChange={(burst) => setLimit({ burst })} />,
            );
          }
          fields.push(
            <SelectField key="rl-counters" label="Counters" value={limit.counters} disabled={!editable} options={[{ value: "local", label: "Each server" }, { value: "shared", label: "Shared cache" }]} onChange={(counters) => setLimit({ counters: counters as typeof limit.counters })} />,
          );
        }
      }
      if (has("autoscaling")) {
        const scaling = config.autoscaling;
        const setScaling = (change: Partial<typeof scaling>) => onChange({ autoscaling: { ...scaling, ...change } });
        fields.push(
          <Toggle key="as" label="Autoscaling" detail="New servers take 6 seconds to warm up" checked={scaling.enabled} disabled={!editable} onChange={(enabled) => setScaling({ enabled })} />,
        );
        if (scaling.enabled) {
          fields.push(
            <Stepper key="as-min" label="Minimum" value={scaling.min} min={1} max={scaling.max} disabled={!editable} onChange={(min) => setScaling({ min })} />,
            <Stepper key="as-max" label="Maximum" value={scaling.max} min={scaling.min} max={MAX_INSTANCES} disabled={!editable} onChange={(max) => setScaling({ max })} />,
            <NumberField key="as-target" label="Target busy" unit="%" value={scaling.targetUtilization} min={20} max={95} step={5} disabled={!editable} onChange={(targetUtilization) => setScaling({ targetUtilization })} />,
          );
        }
      }
      break;
    }
    case "load-balancer":
      if (has("health-checks")) {
        fields.push(
          <Toggle key="hc" label="Health checks" detail="Stop sending traffic to servers that stop answering" checked={node.config.healthChecks} disabled={!editable} onChange={(healthChecks) => onChange({ healthChecks })} />,
        );
      }
      break;
    case "cache": {
      const config = node.config;
      if (has("size")) size("Cache size", config.size, CACHE_COST);
      if (has("ttl")) {
        fields.push(
          <NumberField key="ttl" label="Time to live" unit="s" value={config.ttlSeconds} min={1} max={600} disabled={!editable} onChange={(ttlSeconds) => onChange({ ttlSeconds })} />,
        );
      }
      if (has("invalidate")) {
        fields.push(
          <Toggle key="inv" label="Invalidate on write" detail="Edits delete the cached copy right away" checked={config.invalidateOnWrite} disabled={!editable} onChange={(invalidateOnWrite) => onChange({ invalidateOnWrite })} />,
        );
      }
      if (has("coalesce")) {
        fields.push(
          <Toggle key="co" label="Request coalescing" detail="One request refills a missing entry; the rest wait for it" checked={config.coalesce} disabled={!editable} onChange={(coalesce) => onChange({ coalesce })} />,
        );
      }
      if (has("jitter")) {
        fields.push(
          <Toggle key="ji" label="TTL jitter" detail="Randomize expiry so entries do not all expire together" checked={config.jitter} disabled={!editable} onChange={(jitter) => onChange({ jitter })} />,
        );
      }
      break;
    }
    case "database": {
      const config = node.config;
      if (has("size")) size("Database size", config.size, DB_COST);
      if (has("index")) {
        fields.push(
          <Toggle key="idx" label="Index on short code" detail="Direct lookups instead of scanning the table" checked={config.index} disabled={!editable} onChange={(index) => onChange({ index })} />,
        );
      }
      if (has("replication")) {
        fields.push(
          <SelectField key="rep" label="Replication" value={config.replication} disabled={!editable} options={[{ value: "async", label: "Asynchronous" }, { value: "sync", label: "Synchronous" }]} onChange={(replication) => onChange({ replication: replication as typeof config.replication })} />,
        );
      }
      if (has("failover")) {
        fields.push(
          <SelectField key="fo" label="Failover" value={config.failover} disabled={!editable} options={[{ value: "manual", label: "Manual (about 40s)" }, { value: "automatic", label: "Automatic (5s)" }]} onChange={(failover) => onChange({ failover: failover as typeof config.failover })} />,
        );
      }
      if (has("backups")) {
        fields.push(
          <SelectField key="bk" label="Backups" value={config.backups} disabled={!editable} options={[{ value: "none", label: "None" }, { value: "daily", label: "Daily · +$10/mo" }, { value: "hourly", label: "Hourly · +$30/mo" }, { value: "continuous", label: "Continuous · +$80/mo" }]} onChange={(backups) => onChange({ backups: backups as typeof config.backups })} />,
        );
      }
      if (has("archive-after")) {
        fields.push(
          <SelectField key="ar" label="Archive links older than" value={config.archiveAfter} disabled={!editable} options={[{ value: "never", label: "Never" }, { value: "1y", label: "1 year" }, { value: "90d", label: "90 days" }]} onChange={(archiveAfter) => onChange({ archiveAfter: archiveAfter as typeof config.archiveAfter })} />,
        );
      }
      if (has("partitioning")) {
        fields.push(
          <SelectField key="pa" label="Clicks table" value={config.partitioning} disabled={!editable} options={[{ value: "none", label: "One table" }, { value: "monthly", label: "Partitioned by month" }]} onChange={(partitioning) => onChange({ partitioning: partitioning as typeof config.partitioning })} />,
        );
      }
      if (has("shards")) {
        fields.push(
          <Stepper key="sh" label="Shards" value={config.shards} min={1} max={MAX_SHARDS} disabled={!editable} onChange={(shards) => onChange({ shards })} />,
        );
        if (config.shards > 1) {
          fields.push(
            <SelectField key="sk" label="Shard key" value={config.shardKey} disabled={!editable} options={[{ value: "hash", label: "Hash of the code" }, { value: "created-at", label: "Creation time" }]} onChange={(shardKey) => onChange({ shardKey: shardKey as typeof config.shardKey })} />,
          );
        }
      }
      break;
    }
    case "replica":
      if (has("size")) size("Replica size", node.config.size, DB_COST);
      if (has("instances")) {
        fields.push(
          <Stepper key="rn" label="Replicas" value={node.config.instances} min={1} max={MAX_INSTANCES} disabled={!editable} onChange={(instances) => onChange({ instances })} />,
        );
      }
      break;
    case "queue":
      if (has("dead-letter")) {
        fields.push(
          <Toggle key="dl" label="Dead-letter queue" detail="Set aside jobs that fail three times" checked={node.config.deadLetter} disabled={!editable} onChange={(deadLetter) => onChange({ deadLetter })} />,
        );
      }
      break;
    case "worker":
      if (has("instances")) {
        fields.push(
          <Stepper key="wn" label="Workers" value={node.config.instances} min={1} max={MAX_INSTANCES} disabled={!editable} onChange={(instances) => onChange({ instances })} />,
        );
      }
      if (has("idempotent")) {
        fields.push(
          <Toggle key="id" label="Idempotent jobs" detail="Skip click IDs that were already recorded" checked={node.config.idempotent} disabled={!editable} onChange={(idempotent) => onChange({ idempotent })} />,
        );
      }
      break;
    case "service": {
      const config = node.config;
      if (has("capabilities")) {
        const elsewhere = new Set(
          architecture.nodes.flatMap((other) => (other.type === "service" && other.id !== node.id ? other.config.capabilities : [])),
        );
        for (const capability of capabilityOptions) {
          const owned = config.capabilities.includes(capability);
          fields.push(
            <Toggle
              key={`cap-${capability}`}
              label={capabilityCatalog[capability].label}
              detail={owned ? "Runs here" : elsewhere.has(capability) ? "Runs in another service" : "Not running here"}
              checked={owned}
              disabled={!editable}
              onChange={(checked) =>
                onChange({
                  capabilities: checked
                    ? capabilities.filter((item) => item === capability || config.capabilities.includes(item))
                    : config.capabilities.filter((item) => item !== capability),
                })
              }
            />,
          );
        }
      }
      if (has("size")) size("Instance size", config.size, API_COST);
      if (has("instances")) {
        fields.push(
          <Stepper key="instances" label="Instances" value={config.instances} min={1} max={MAX_INSTANCES} disabled={!editable} onChange={(instances) => onChange({ instances })} />,
        );
      }
      if (has("counter-shards") && config.capabilities.includes("analytics")) {
        fields.push(
          <Stepper key="counter-shards" label="Counter rows" value={config.counterShards} min={1} max={MAX_COUNTER_SHARDS} disabled={!editable} onChange={(counterShards) => onChange({ counterShards })} />,
        );
      }
      if (has("locks") && config.capabilities.includes("locks")) {
        fields.push(
          <NumberField key="lease" label="Lock lease" unit="s" value={config.leaseSeconds} min={1} max={60} disabled={!editable} onChange={(leaseSeconds) => onChange({ leaseSeconds })} />,
        );
      }
      if (has("locks") && config.capabilities.includes("links")) {
        fields.push(
          <Toggle key="fencing" label="Check fencing tokens" detail="Reject writes with an older lock token than the last one seen" checked={config.fencing} disabled={!editable} onChange={(fencing) => onChange({ fencing })} />,
        );
      }
      break;
    }
    default:
      break;
  }
  return fields;
}

function callSettings(
  call: CallConfig,
  target: ParkNode | undefined,
  features: ReadonlySet<Feature>,
  editable: boolean,
  onChange: (change: Partial<CallConfig>) => void,
): ReactNode[] {
  const has = (feature: Feature) => features.has(feature);
  const fields: ReactNode[] = [];
  if (has("async")) {
    fields.push(
      <SelectField key="mode" label="Call" value={call.mode} disabled={!editable} options={[{ value: "sync", label: "Wait for the answer" }, { value: "async", label: "Send a message (queued)" }]} onChange={(mode) => onChange({ mode: mode as CallConfig["mode"] })} />,
    );
  }
  if (call.mode === "async") return fields;
  if (has("timeouts")) {
    fields.push(
      <NumberField key="timeout" label="Timeout (0 waits forever)" unit="ms" value={call.timeoutMs} min={0} max={30_000} step={50} disabled={!editable} onChange={(timeoutMs) => onChange({ timeoutMs })} />,
    );
  }
  if (has("retries")) {
    fields.push(
      <Stepper key="retries" label="Retries" value={call.retries} min={0} max={5} disabled={!editable} onChange={(retries) => onChange({ retries })} />,
    );
    if (call.retries > 0) {
      fields.push(
        <Toggle key="backoff" label="Backoff with jitter" detail="Wait longer after each failure, and cap retries at 10% of calls" checked={call.backoff} disabled={!editable} onChange={(backoff) => onChange({ backoff })} />,
      );
    }
  }
  if (has("circuit-breaker")) {
    fields.push(
      <Toggle key="breaker" label="Circuit breaker" detail="After 2 bad seconds, fail fast for 2 seconds" checked={call.circuitBreaker} disabled={!editable} onChange={(circuitBreaker) => onChange({ circuitBreaker })} />,
    );
  }
  const fallback = target?.type === "service" ? target.config.capabilities.map((item) => capabilityCatalog[item].fallback).find(Boolean) : undefined;
  if (has("fallback") && fallback) {
    fields.push(
      <Toggle key="fallback" label="Fallback on failure" detail={fallback} checked={call.fallback} disabled={!editable} onChange={(fallback) => onChange({ fallback })} />,
    );
  }
  return fields;
}

function SelectField({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="inspector-wide">
      <span>{label}</span>
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function NumberField({
  label,
  unit,
  value,
  min,
  max,
  step = 1,
  disabled,
  onChange,
}: {
  label: string;
  unit?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const parsed = Number(draft);
    const next = Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : value;
    setDraft(String(next));
    if (next !== value) onChange(next);
  };
  return (
    <label>
      <span>
        {label} {unit && <small>{unit}</small>}
      </span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
      />
    </label>
  );
}

function Stepper({
  label,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="inspector-stepper">
      <span>{label}</span>
      <div className="replica-stepper">
        <button className="replica-stepper-button" type="button" disabled={disabled || value <= min} onClick={() => onChange(value - 1)} aria-label={`Fewer ${label.toLowerCase()}`}>
          <Minus />
        </button>
        <output aria-label={label}>{value}</output>
        <button className="replica-stepper-button" type="button" disabled={disabled || value >= max} onClick={() => onChange(value + 1)} aria-label={`More ${label.toLowerCase()}`}>
          <Plus />
        </button>
      </div>
    </div>
  );
}

function Toggle({
  label,
  detail,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  detail: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="inspector-check">
      <span>
        <b>{label}</b>
        <small>{detail}</small>
      </span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}
