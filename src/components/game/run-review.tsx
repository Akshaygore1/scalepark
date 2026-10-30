import { X } from "lucide-react";
import { useEffect, useState } from "react";

import { formatClock } from "@/lib/evaluate";
import type { SimEvent, SimulationResult, Snapshot } from "@/lib/simulation";

import { DialogOverlay } from "./dialogs";

const metrics = [
  { key: "demand", label: "Traffic", format: (value: number) => `${Math.round(value).toLocaleString()} req/s`, read: (s: Snapshot) => s.demand },
  { key: "availability", label: "Availability", format: (value: number) => `${value.toFixed(2)}%`, read: (s: Snapshot) => s.availability * 100 },
  { key: "p95", label: "p95 latency", format: (value: number) => `${Math.round(value)} ms`, read: (s: Snapshot) => s.p95Ms },
  { key: "cost", label: "Running cost", format: (value: number) => `$${Math.round(value).toLocaleString()}/mo`, read: (s: Snapshot) => s.monthlyCost },
  { key: "hit", label: "Cache hit rate", format: (value: number) => `${Math.round(value)}%`, read: (s: Snapshot) => s.cacheHitRate * 100 },
  { key: "backlog", label: "Queue backlog", format: (value: number) => `${Math.round(value).toLocaleString()} jobs`, read: (s: Snapshot) => s.queueBacklog },
] as const;

type MetricKey = (typeof metrics)[number]["key"];

export function RunReview({
  result,
  labels,
  second,
  onSeek,
  onClose,
}: {
  result: SimulationResult;
  labels: ReadonlyMap<string, string>;
  second: number;
  onSeek: (second: number) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<MetricKey>("p95");
  const snapshots = result.snapshots;
  const last = snapshots.length - 1;
  const current = snapshots[Math.min(second, last)];
  const markers = result.events.filter((event) => event.kind !== "info" || event.node);
  const atSecond = result.events.filter((event) => event.second === current?.second);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") onSeek(Math.max(0, second - 1));
      if (event.key === "ArrowRight") onSeek(Math.min(last, second + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [last, onClose, onSeek, second]);
  if (!current) return null;
  return (
    <DialogOverlay label="Run review" onEscape={onClose} className="review-overlay">
      <section className="run-review" aria-labelledby="run-review-title">
        <header className="run-review-header">
          <div>
            <span className="review-kicker">Run details</span>
            <h2 id="run-review-title">Run review</h2>
            <p>Select a second to inspect traffic, capacity, and events. Use the arrow keys to move through the run.</p>
          </div>
          <button className="review-close" type="button" onClick={onClose} aria-label="Close run review">
            <X />
          </button>
        </header>

        <div className="review-timeline">
          <div className="review-timeline-heading">
            <strong>{formatClock(current.second)}</strong>
            <span>Select a second, or a marker</span>
          </div>
          <div className="review-scrubber">
            <input
              aria-label="Select a second of the run"
              type="range"
              min="0"
              max={last}
              step="1"
              value={current.second}
              onChange={(event) => onSeek(Number(event.target.value))}
            />
            <div className="review-marker-layer">
              {markers.map((event, index) => (
                <button
                  className={`review-marker ${event.kind}`}
                  key={`${event.second}-${index}`}
                  type="button"
                  style={{ left: `${last ? (event.second / last) * 100 : 0}%` }}
                  aria-label={`${formatClock(event.second)}: ${event.message}`}
                  aria-current={event.second === current.second ? "true" : undefined}
                  title={`${formatClock(event.second)} · ${event.message}`}
                  onClick={() => onSeek(event.second)}
                >
                  <i />
                </button>
              ))}
            </div>
          </div>
          <div className="review-timeline-scale" aria-hidden="true">
            <span>00:00</span>
            <span>{formatClock(last)}</span>
          </div>
          <div className="review-marker-legend">
            {(["incident", "saturation", "recovery", "scaling"] as const).map((kind) => (
              <span key={kind} className={kind}>
                <i />
                {kind}
              </span>
            ))}
          </div>
        </div>

        <div className="review-columns">
          <div className="review-main-column">
            <div className="review-chart-grid">
              {metrics
                .filter((metric) => ["demand", "availability", "p95", "cost"].includes(metric.key) || snapshots.some((item) => metric.read(item) > 0))
                .map((metric) => (
                <Sparkline
                  key={metric.key}
                  label={metric.label}
                  values={snapshots.map(metric.read)}
                  value={metric.format(metric.read(current))}
                  cursor={current.second / Math.max(1, last)}
                  selected={selected === metric.key}
                  onSelect={() => setSelected(metric.key)}
                />
              ))}
            </div>
            <div className="review-table-scroll" tabIndex={0} role="region" aria-label="Building metrics">
              <table className="review-nodes">
                <thead>
                  <tr>
                    <th>Building</th>
                    <th>Load</th>
                    <th>Capacity</th>
                    <th>Busy</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(current.nodes)
                    .filter(([id]) => labels.has(id))
                    .map(([id, node]) => (
                      <tr key={id} className={`state-${node.health}`}>
                        <th scope="row">{labels.get(id)}</th>
                        <td>{node.load.toLocaleString()}</td>
                        <td>{Number.isFinite(node.capacity) ? node.capacity.toLocaleString() : "∞"}</td>
                        <td>{Number.isFinite(node.capacity) ? `${Math.round(Math.min(9.99, node.utilization) * 100)}%` : "-"}</td>
                        <td>
                          <span className="review-state">{node.health === "saturated" ? "overloaded" : node.health}</span> {node.detail}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          <aside className="review-events-panel" aria-label="Events at the selected second">
            <div className="review-panel-heading">
              <span className="review-card-kicker">Selected second</span>
              <strong>{current.second}s</strong>
            </div>
            <div className="review-selected-stats">
              <span>
                <small>Requests answered</small>
                <b>{current.successful.toLocaleString()} of {current.demand.toLocaleString()}</b>
              </span>
              {current.classes
                .filter((item) => item.volume > 0)
                .map((item) => (
                  <span key={item.label}>
                    <small>{item.label}</small>
                    <b>{item.latencyMs} ms</b>
                  </span>
                ))}
            </div>
            <h3>What happened here?</h3>
            {atSecond.length > 0 ? (
              <ul className="review-event-list">
                {atSecond.map((event: SimEvent, index) => (
                  <li key={index} className={event.kind}>
                    <b>{event.kind}</b>
                    <span>{event.message}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="review-empty">No event this second. Compare the curves and the building table.</p>
            )}
          </aside>
        </div>
      </section>
    </DialogOverlay>
  );
}

function Sparkline({
  label,
  values,
  value,
  cursor,
  selected,
  onSelect,
}: {
  label: string;
  values: number[];
  value: string;
  cursor: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const points = values
    .map((item, index) => {
      const x = values.length <= 1 ? 0 : (index / (values.length - 1)) * 100;
      const y = 30 - ((item - min) / Math.max(0.0001, max - min)) * 26;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <button className={`review-chart-card ${selected ? "selected" : ""}`} type="button" onClick={onSelect} aria-pressed={selected}>
      <span>{label}</span>
      <b>{value}</b>
      <svg viewBox="0 0 100 34" role="img" aria-label={`${label} over the run`} preserveAspectRatio="none">
        <polyline points={points} fill="none" vectorEffect="non-scaling-stroke" />
        <line className="review-cursor" x1={cursor * 100} x2={cursor * 100} y1="0" y2="34" vectorEffect="non-scaling-stroke" />
      </svg>
    </button>
  );
}
