import {
  Activity,
  BookOpen,
  CircleCheck,
  CircleDashed,
  CircleX,
  Gauge,
  Lightbulb,
  Pause,
  Play,
  RotateCcw,
  Shapes,
  Square,
  Users,
  Zap,
} from "lucide-react";

import type { SimLevel } from "@/lib/curriculum";
import { formatClock, measureTarget, type TargetResult } from "@/lib/evaluate";
import { buildCost, nodeCatalog, type Architecture, type NodeType } from "@/lib/model";
import { summarize, type Scenario, type Snapshot, type SimulationResult } from "@/lib/simulation";

import { BuildingArt } from "./building-art";
import { buildingLook, formatMoney } from "./buildings";
import type { Phase, Speed } from "./game-state";
import { DRAG_TYPE } from "./park-map";

export function GameHud({
  phase,
  hasRun,
  onExit,
  onPlay,
  onStop,
  onReview,
  onJournal,
  onReset,
}: {
  phase: Phase;
  hasRun: boolean;
  onExit: () => void;
  onPlay: () => void;
  onStop: () => void;
  onReview: () => void;
  onJournal: () => void;
  onReset: () => void;
}) {
  const running = phase === "running";
  return (
    <header className="game-hud">
      <button className="hud-brand" type="button" onClick={onExit}>ScaleLab Park</button>
      <nav className="hud-actions" aria-label="Park controls">
        <button type="button" disabled={!hasRun} onClick={onReview} title="Run review" aria-label="Open run review">
          <Activity /> <span>Review</span>
        </button>
        <button type="button" onClick={onJournal}>
          <BookOpen /> <span>Journal</span>
        </button>
        <button type="button" disabled={running || phase === "paused"} onClick={onReset}>
          <RotateCcw /> <span>Reset park</span>
        </button>
        {phase !== "planning" && (
          <button type="button" onClick={onStop} aria-label="Stop and edit">
            <Square /> <span>Stop</span>
          </button>
        )}
        <button className="run-button" type="button" onClick={onPlay}>
          {running ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
          {running ? "Pause" : phase === "paused" ? "Resume" : "Run simulation"}
        </button>
      </nav>
    </header>
  );
}

export function ParkMetrics({ snapshot, complexity }: { snapshot?: Snapshot; complexity: number }) {
  return (
    <section className="park-metrics" aria-label="Live park metrics">
      <HudStat icon={<Users />} label="Traffic" value={snapshot ? snapshot.demand.toLocaleString() : "0"} unit="req/s" />
      <HudStat icon={<Gauge />} label="Availability" value={snapshot ? (snapshot.availability * 100).toFixed(2) : "-"} unit="%" />
      <HudStat icon={<Zap />} label="p95 latency" value={snapshot ? String(snapshot.p95Ms) : "-"} unit="ms" />
      <HudStat icon={<Shapes />} label="Complexity" value={String(complexity)} unit="components" />
    </section>
  );
}

function HudStat({ icon, label, value, unit }: { icon: React.ReactNode; label: string; value: string; unit: string }) {
  return (
    <div className="hud-stat">
      <span className="hud-stat-label">{icon}{label}</span>
      <span className="hud-stat-value"><b>{value}</b><small>{unit}</small></span>
    </div>
  );
}

/** Measure targets against the seconds played so far, so the rail reacts while the run plays. */
function liveTargets(level: SimLevel, result: SimulationResult, second: number): TargetResult[] {
  const snapshots = result.snapshots.slice(0, second + 1);
  const events = result.events.filter((event) => event.second <= second);
  const partial: SimulationResult = { ...result, snapshots, events, totals: summarize(snapshots, events) };
  return level.targets.map((target) => measureTarget(target, partial));
}

export function MissionRail({
  level,
  moduleTitle,
  phase,
  result,
  second,
  finalTargets,
  warnings,
  monthlyCost,
  budget,
  hintsShown,
  hintOpen,
  onHint,
  onToggleHint,
}: {
  level: SimLevel;
  moduleTitle: string;
  phase: Phase;
  result?: SimulationResult;
  second: number;
  finalTargets?: TargetResult[];
  warnings: string[];
  monthlyCost: number;
  budget?: number;
  hintsShown: number;
  hintOpen: boolean;
  onHint: () => void;
  onToggleHint: () => void;
}) {
  const showing = phase !== "planning" && result && result.validation.ok;
  const targets = showing
    ? phase === "finished" && finalTargets
      ? finalTargets
      : liveTargets(level, result, second)
    : level.targets.map((target) => ({ ...measureTarget(target, emptyResult), measured: "" }));
  const overBudget = budget !== undefined && monthlyCost > budget;
  return (
    <aside className="mission-rail" aria-labelledby="mission-title">
      <div className="mission-heading">
        <span className="mission-kicker">
          {level.id === "sandbox" ? "Free build" : `${level.code} · ${moduleTitle}`}
        </span>
        <h1 id="mission-title">{level.title}</h1>
        <p className="mission-objective">{level.brief}</p>
      </div>
      {level.targets.length > 0 && (
        <section className="mission-goals" aria-label="Objectives">
          <div className="mission-section-label">
            <span>Objectives</span>
            <span>{showing ? targets.filter((target) => target.pass).length : 0} / {targets.length}</span>
          </div>
          <ul className="mission-targets">
            {targets.map((item) => (
              <li key={item.label} className={!showing ? "" : item.pass ? "pass" : "fail"}>
                {!showing ? <CircleDashed /> : item.pass ? <CircleCheck /> : <CircleX />}
                <span>{item.label}</span>
                <b>{showing ? item.measured : item.goal}</b>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className={`mission-budget ${overBudget ? "over-budget" : ""}`} aria-label="Monthly cost">
        <div className="mission-budget-heading">
          <span>{budget === undefined ? "Monthly cost" : "Budget"}</span>
          <strong>{formatMoney(monthlyCost)}{budget !== undefined && <small> / {formatMoney(budget)}</small>}</strong>
        </div>
        {budget !== undefined && (
          <>
            <meter min={0} max={budget} value={Math.min(monthlyCost, budget)} aria-label="Monthly budget used" />
            <div className="mission-budget-detail">
              <span>{formatMoney(Math.abs(budget - monthlyCost))} {overBudget ? "over budget" : "remaining"}</span>
              <span>per month</span>
            </div>
          </>
        )}
      </section>
      {level.id !== "sandbox" && (
        <p className="mission-par">2 stars: ≤ {formatMoney(level.par.monthly)}/mo. 3 stars: also complexity ≤ {level.par.complexity}.</p>
      )}
      {phase === "planning" && warnings.length > 0 && (
        <ul className="mission-warnings">
          {warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      )}
      {level.id !== "sandbox" && (
        <div className="mission-hints">
          <button
            className="hint-toggle"
            type="button"
            aria-expanded={hintOpen}
            aria-controls="level-hints"
            onClick={hintsShown === 0 ? onHint : onToggleHint}
          >
            <Lightbulb /> Hint <span aria-hidden="true">{hintOpen ? "−" : "+"}</span>
          </button>
          <section id="level-hints" hidden={!hintOpen} aria-label="Hints">
            <ol>
              {level.hints.slice(0, hintsShown).map((hint, index) => (
                <li key={index}>
                  <small>{["Symptom", "Where to look", "What to try"][index]}</small>
                  {hint}
                </li>
              ))}
            </ol>
            {hintsShown < level.hints.length && (
              <button className="hint-more" type="button" onClick={onHint}>
                {["Show a hint", "Where should I look?", "What should I try?"][hintsShown]}
              </button>
            )}
            {hintsShown >= level.hints.length && level.finalHint.length > 0 && (
              <details className="hint-solution">
                <summary className="hint-more">Show exact configuration</summary>
                <p>Start from Reset park, then follow these steps. Leave unlisted settings unchanged.</p>
                <ol>{level.finalHint.map((step) => <li key={step}>{step}</li>)}</ol>
              </details>
            )}
          </section>
        </div>
      )}
    </aside>
  );
}

const emptyResult: SimulationResult = {
  validation: { ok: false, errors: [], warnings: [] },
  snapshots: [],
  events: [],
  totals: summarize([], []),
};

export function BuildDock({
  level,
  architecture,
  editable,
  onBuild,
  onSelect,
}: {
  level: SimLevel;
  architecture: Architecture;
  editable: boolean;
  onBuild: (type: NodeType) => void;
  onSelect: (nodeId: string) => void;
}) {
  const built = new Set(architecture.nodes.filter((node) => !nodeCatalog[node.type].multiple).map((node) => node.type));
  return (
    <aside className="build-dock" aria-label="Build">
      <div className="dock-heading">Build</div>
      <div className="dock-buildings">
        {level.unlocks.nodes.map((type) => {
          const { color } = buildingLook[type];
          const existing = built.has(type) ? architecture.nodes.find((node) => node.type === type) : undefined;
          const disabled = !editable;
          return (
            <button
              disabled={disabled}
              draggable={!disabled && !existing}
              key={type}
              type="button"
              title={built.has(type) ? "Already built: scale it from its settings" : nodeCatalog[type].role}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "copy";
                event.dataTransfer.setData(DRAG_TYPE, type);
              }}
              onClick={() => existing ? onSelect(existing.id) : onBuild(type)}
            >
              <span className={`dock-art ${color}`}><BuildingArt type={type} /></span>
              <span>
                <b>{nodeCatalog[type].short}</b>
                <small>{built.has(type) ? "built" : `from ${formatMoney(buildCost[type])}/mo`}</small>
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

export type SandboxSettings = {
  redirects: number;
  creates: number;
  edits: number;
  dashboard: number;
  viewers: number;
  bots: number;
  hotKey: number;
  clicks: boolean;
  incidents: Record<"api-crash" | "worker-crash" | "primary-failure" | "table-drop", boolean>;
};

export const defaultSandbox: SandboxSettings = {
  redirects: 1_000,
  creates: 20,
  edits: 5,
  dashboard: 0,
  viewers: 0,
  bots: 0,
  hotKey: 0,
  clicks: false,
  incidents: { "api-crash": false, "worker-crash": false, "primary-failure": false, "table-drop": false },
};

const incidentTimes = { "api-crash": 20, "worker-crash": 30, "primary-failure": 25, "table-drop": 40 } as const;
const incidentLabels = {
  "api-crash": "An API server crashes",
  "worker-crash": "A worker crashes",
  "primary-failure": "The primary database fails",
  "table-drop": "The links table is dropped",
} as const;

export function sandboxScenario(settings: SandboxSettings): Scenario {
  const steady = (value: number) => [[0, value]] as const;
  return {
    durationSeconds: 60,
    traffic: {
      redirects: steady(settings.redirects),
      creates: steady(settings.creates),
      edits: steady(settings.edits),
      dashboard: steady(settings.dashboard),
      viewers: steady(settings.viewers),
      bots: steady(settings.bots),
      hotKey: steady(Math.min(settings.hotKey, settings.redirects)),
    },
    clicks: settings.clicks,
    data: { linkRows: 5_000_000 },
    incidents: (Object.keys(settings.incidents) as Array<keyof SandboxSettings["incidents"]>)
      .filter((type) => settings.incidents[type])
      .map((type) => ({ at: incidentTimes[type], type })),
  };
}

const sliders: Array<{ key: keyof Omit<SandboxSettings, "clicks" | "incidents">; label: string; max: number; step: number }> = [
  { key: "redirects", label: "Redirects/s", max: 20_000, step: 100 },
  { key: "hotKey", label: "Viral link/s", max: 10_000, step: 100 },
  { key: "creates", label: "Creates/s", max: 5_000, step: 10 },
  { key: "edits", label: "Edits/s", max: 500, step: 5 },
  { key: "dashboard", label: "Dashboards/s", max: 3_000, step: 50 },
  { key: "viewers", label: "Live viewers", max: 60_000, step: 1_000 },
  { key: "bots", label: "Bots", max: 100, step: 5 },
];

export function SandboxControls({ settings, editable, onChange }: { settings: SandboxSettings; editable: boolean; onChange: (settings: SandboxSettings) => void }) {
  return (
    <aside className="sandbox-controls" aria-label="Traffic lab">
      <span>Traffic lab</span>
      <div className="sandbox-sliders">
        {sliders.map((slider) => (
          <label key={slider.key}>
            <small>
              {slider.label} <b>{settings[slider.key].toLocaleString()}</b>
            </small>
            <input
              type="range"
              min="0"
              max={slider.max}
              step={slider.step}
              value={settings[slider.key]}
              disabled={!editable}
              onChange={(event) => onChange({ ...settings, [slider.key]: Number(event.target.value) })}
            />
          </label>
        ))}
      </div>
      <span>Incidents</span>
      <div className="sandbox-toggles">
        <label>
          <input type="checkbox" checked={settings.clicks} disabled={!editable} onChange={(event) => onChange({ ...settings, clicks: event.target.checked })} />
          Record clicks
        </label>
        {(Object.keys(settings.incidents) as Array<keyof SandboxSettings["incidents"]>).map((type) => (
          <label key={type}>
            <input
              type="checkbox"
              checked={settings.incidents[type]}
              disabled={!editable}
              onChange={(event) => onChange({ ...settings, incidents: { ...settings.incidents, [type]: event.target.checked } })}
            />
            {incidentLabels[type]} at {formatClock(incidentTimes[type])}
          </label>
        ))}
      </div>
    </aside>
  );
}

export function EventTicker({ second, duration, result, phase, notice, speed, onSpeed }: {
  second: number;
  duration: number;
  result?: SimulationResult;
  phase: Phase;
  notice: string;
  speed: Speed;
  onSpeed: (speed: Speed) => void;
}) {
  const latest = result?.events.filter((event) => event.second <= second).at(-1);
  return (
    <footer className="event-ticker" aria-label="Playback and park events">
      <span className="ticker-phase">{{ planning: "Planning", running: "Running", paused: "Paused", finished: "Finished" }[phase]}</span>
      <strong>{formatClock(second)} / {formatClock(duration)}</strong>
      <progress value={second} max={duration} aria-label="Simulation progress" />
      <span className="ticker-message" role="status">{phase === "planning" ? notice : latest?.message ?? notice}</span>
      <div className="playback-speeds" aria-label="Playback speed">
        {([1, 2, 4] as Speed[]).map((option) => (
          <button type="button" key={option} aria-pressed={speed === option} onClick={() => onSpeed(option)}>{option}×</button>
        ))}
      </div>
    </footer>
  );
}
