import type { Dispatch, ReactNode } from "react";

import type { Region } from "@/lib/architecture";
import {
  regionalLearningIncident,
  type LearningAction,
  type LearningState,
} from "@/lib/learning";
import type { SimulationResult, Snapshot } from "@/lib/simulation";

type LearningModePanelProps = {
  activeRegions: Region[];
  canStart: boolean;
  dispatch: Dispatch<LearningAction>;
  learning: LearningState;
  region: Region;
  result: SimulationResult | null;
  snapshot?: Snapshot;
  traffic: number;
  onRegionChange: (region: Region) => void;
  onReset: () => void;
  onStart: () => void;
  children?: ReactNode;
};

export function LearningModePanel({
  activeRegions,
  canStart,
  children,
  dispatch,
  learning,
  onRegionChange,
  onReset,
  onStart,
  region,
  result,
  snapshot,
  traffic,
}: LearningModePanelProps) {
  return (
    <section className="learning-mode" aria-label="Learning mode controls">
      <div className="learning-mode-heading">
        <div>
          <p className="eyebrow">Learning mode</p>
          <strong>
            {learning.phase === "idle"
              ? "Ready"
              : `${learning.phase} · ${String(learning.second).padStart(2, "0")}:00`}
          </strong>
        </div>
        {learning.phase === "idle" ? (
          <button type="button" disabled={!canStart} onClick={onStart}>
            Start learning mode
          </button>
        ) : (
          <div className="learning-actions">
            {learning.phase === "running" ? (
              <button type="button" onClick={() => dispatch({ type: "pause" })}>
                Pause
              </button>
            ) : (
              <button
                type="button"
                disabled={learning.phase === "completed"}
                onClick={() => dispatch({ type: "resume" })}
              >
                Resume
              </button>
            )}
            <button
              type="button"
              disabled={learning.phase !== "paused"}
              onClick={() => dispatch({ type: "step" })}
            >
              Step +1s
            </button>
            <button type="button" onClick={onReset}>
              Reset
            </button>
          </div>
        )}
      </div>
      {learning.phase !== "idle" && (
        <>
          <label className="config-field">
            Traffic (requests / sec)
            <input
              aria-label="Learning traffic requests per second"
              type="number"
              min="0"
              value={traffic}
              onChange={(event) =>
                dispatch({ type: "traffic", rps: Number(event.target.value) })
              }
            />
          </label>
          <div className="incident-actions" aria-label="Manual incidents">
            <IncidentButton
              label="Inject cache failure"
              onClick={() =>
                dispatch({
                  type: "incident",
                  incident: { type: "cache-failure", durationSeconds: 4 },
                })
              }
            />
            <IncidentButton
              label="Inject database slowdown"
              onClick={() =>
                dispatch({
                  type: "incident",
                  incident: { type: "database-slowdown", durationSeconds: 4 },
                })
              }
            />
            <IncidentButton
              label="Inject database failure"
              onClick={() =>
                dispatch({
                  type: "incident",
                  incident: { type: "database-failure", durationSeconds: 4 },
                })
              }
            />
          </div>
          <div className="regional-injection">
            <select
              aria-label="Learning incident region"
              value={region}
              onChange={(event) => onRegionChange(event.target.value as Region)}
            >
              {activeRegions.map((activeRegion) => (
                <option key={activeRegion}>{activeRegion}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() =>
                dispatch({ type: "incident", incident: regionalLearningIncident(region) })
              }
            >
              Inject regional latency
            </button>
          </div>
          {snapshot && (
            <>
              <div className="learning-readout" aria-live="polite">
                <span>
                  Availability <b>{(snapshot.availability * 100).toFixed(2)}%</b>
                </span>
                <span>
                  p95 <b>{snapshot.p95LatencyMs}ms</b>
                </span>
                <span>
                  Throughput <b>{snapshot.throughput.toLocaleString()}/s</b>
                </span>
                <span>
                  Queue <b>{snapshot.queued.toLocaleString()}</b>
                </span>
              </div>
              {children}
              <ol className="run-events learning-events" aria-label="Learning timeline">
                {result?.events
                  .filter((event) => event.second <= learning.second)
                  .slice(-6)
                  .map((event) => (
                    <li key={`${event.second}-${event.type}-${event.message}`}>
                      <span>{String(event.second).padStart(2, "0")}:00</span>
                      {event.message}
                    </li>
                  ))}
              </ol>
            </>
          )}
        </>
      )}
    </section>
  );
}

function IncidentButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}>
      {label}
    </button>
  );
}
