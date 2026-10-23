import {
  Activity,
  Banknote,
  BookOpen,
  CircleCheck,
  CircleDashed,
  CircleX,
  Gauge,
  Lightbulb,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Shapes,
  ShieldCheck,
  Square,
  Users,
  Zap,
} from "lucide-react";

import type { SimLevel } from "@/lib/curriculum";
import { measureTarget, type TargetResult } from "@/lib/evaluate";
import { buildCost, nodeCatalog, type Architecture, type NodeType } from "@/lib/model";
import { summarize, type Scenario, type Snapshot, type SimulationResult } from "@/lib/simulation";
import { formatClock } from "@/lib/evaluate";

import { buildingLook, formatMoney } from "./buildings";
import type { Phase, Speed } from "./game-state";
import { DRAG_TYPE } from "./park-map";

export function GameHud({
  level,
  phase,
  speed,
  snapshot,
  second,
  duration,
  monthlyCost,
  complexity,
  budget,
  hasRun,
  hints,
  hintsShown,
  hintOpen,
  onExit,
  onPlay,
  onStop,
  onSpeed,
  onReview,
  onHint,
  onToggleHint,
  onJournal,
  onReset,
}: {
  level: SimLevel;
  phase: Phase;
  speed: Speed;
  snapshot?: Snapshot;
  second: number;
  duration: number;
  monthlyCost: number;
  complexity: number;
  budget?: number;
  hasRun: boolean;
  hints: string[];
  hintsShown: number;
  hintOpen: boolean;
  onExit: () => void;
  onPlay: () => void;
  onStop: () => void;
  onSpeed: (speed: Speed) => void;
  onReview: () => void;
  onHint: () => void;
  onToggleHint: () => void;
  onJournal: () => void;
  onReset: () => void;
}) {
  const running = phase === "running";
  const isSandbox = level.id === "sandbox";
  return (
    <header className="game-hud">
      <button className="hud-brand" type="button" onClick={onExit}>
        <Activity size={18} /> ScaleLab Park
      </button>
      <HudStat icon={<Users />} label="Traffic" value={snapshot ? `${snapshot.demand.toLocaleString()}/s` : "-"} />
      <HudStat
        icon={<Banknote />}
        label={budget ? `Cost · budget ${formatMoney(budget)}` : "Running cost"}
        value={`${formatMoney(snapshot?.monthlyCost ?? monthlyCost)}/mo`}
        alert={Boolean(budget && (snapshot?.monthlyCost ?? monthlyCost) > budget)}
      />
      <HudStat icon={<Gauge />} label="Availability" value={snapshot ? `${(snapshot.availability * 100).toFixed(2)}%` : "-"} />
      <HudStat icon={<Zap />} label="p95 latency" value={snapshot ? `${snapshot.p95Ms} ms` : "-"} />
      <HudStat icon={<Shapes />} label="Complexity" value={String(complexity)} />
      <div className="hud-clock">
        <span>{phase === "planning" ? "Planning" : phase === "finished" ? "Finished" : "Run"}</span>
        <b>
          {formatClock(second)} / {formatClock(duration)}
        </b>
      </div>
      <div className="time-controls" aria-label="Run controls">
        <button type="button" aria-label={running ? "Pause" : phase === "paused" ? "Resume" : "Run the park"} onClick={onPlay}>
          {running ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
        </button>
        <button type="button" aria-label="Stop and edit" disabled={phase === "planning"} onClick={onStop}>
          <Square fill="currentColor" />
        </button>
        {([1, 2, 4] as Speed[]).map((option) => (
          <button className={speed === option ? "active" : ""} key={option} type="button" onClick={() => onSpeed(option)}>
            {option}×
          </button>
        ))}
      </div>
      <button className="journal-button" type="button" disabled={!hasRun} onClick={onReview} aria-label="Open run review" title="Run review">
        <Activity />
      </button>
      {!isSandbox && (
        <div className="navbar-hint">
          <button
            className={`journal-button advisor-hint-button ${hintOpen ? "active" : ""}`}
            type="button"
            aria-label="Hints"
            aria-expanded={hintOpen}
            aria-controls="hint-popover"
            title="Hints"
            onClick={hintsShown === 0 ? onHint : onToggleHint}
          >
            <Lightbulb />
          </button>
          <section className="exact-steps-popover" id="hint-popover" hidden={!hintOpen} aria-label="Hints">
            <b>Hints</b>
            <ol>
              {hints.slice(0, hintsShown).map((hint, index) => (
                <li key={index}>
                  <small>{["Symptom", "Where to look", "What to try"][index]}</small>
                  {hint}
                </li>
              ))}
            </ol>
            {hintsShown < hints.length && (
              <button className="hint-more" type="button" onClick={onHint}>
                {["Show a hint", "Where should I look?", "What should I try?"][hintsShown]}
              </button>
            )}
            {hintsShown >= hints.length && level.finalHint.length > 0 && (
              <details className="hint-solution">
                <summary className="hint-more">Show exact configuration</summary>
                <p>Start from Reset park, then follow these steps. Leave unlisted settings unchanged.</p>
                <ol aria-label="Exact configuration">
                  {level.finalHint.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </details>
            )}
          </section>
        </div>
      )}
      <button className="journal-button" type="button" onClick={onJournal} aria-label="System design journal" title="Journal">
        <BookOpen />
      </button>
      <button className="journal-button" type="button" onClick={onReset} aria-label="Reset to the starting park" title="Reset park">
        <RotateCcw />
      </button>
    </header>
  );
}

function HudStat({ icon, label, value, alert = false }: { icon: React.ReactNode; label: string; value: string; alert?: boolean }) {
  return (
    <div className={`hud-stat ${alert ? "alert" : ""}`}>
      {icon}
      <span>
        {label}
        <b>{value}</b>
      </span>
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
}: {
  level: SimLevel;
  moduleTitle: string;
  phase: Phase;
  result?: SimulationResult;
  second: number;
  finalTargets?: TargetResult[];
  warnings: string[];
}) {
  const showing = phase !== "planning" && result && result.validation.ok;
  const targets = showing
    ? phase === "finished" && finalTargets
      ? finalTargets
      : liveTargets(level, result, second)
    : level.targets.map((target) => ({ ...measureTarget(target, emptyResult), measured: "" }));
  return (
    <aside className="mission-rail">
      <span className="mission-kicker">
        {level.id === "sandbox" ? "Free build" : `${level.code} · ${moduleTitle}`}
      </span>
      <h1>{level.title}</h1>
      <div className="mission-objective">
        <ShieldCheck size={17} />
        <span>{level.brief}</span>
      </div>
      {level.targets.length > 0 && (
        <ul className="mission-targets" aria-label="Targets">
          {targets.map((item) => (
            <li key={item.label} className={!showing ? "" : item.pass ? "pass" : "fail"}>
              {!showing ? <CircleDashed /> : item.pass ? <CircleCheck /> : <CircleX />}
              <span>{item.label}</span>
              <b>{showing ? item.measured : item.goal}</b>
            </li>
          ))}
        </ul>
      )}
      {level.id !== "sandbox" && (
        <p className="mission-par">
          ★★ at or under {formatMoney(level.par.monthly)}/mo · ★★★ and complexity {level.par.complexity} or less
        </p>
      )}
      {phase === "planning" && warnings.length > 0 && (
        <ul className="mission-warnings">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
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
}: {
  level: SimLevel;
  architecture: Architecture;
  editable: boolean;
  onBuild: (type: NodeType) => void;
}) {
  const built = new Set(architecture.nodes.filter((node) => !nodeCatalog[node.type].multiple).map((node) => node.type));
  return (
    <aside className="build-dock" aria-label="Build">
      <div className="dock-heading">
        <Plus />
        <span>Build</span>
      </div>
      {level.unlocks.nodes.map((type) => {
        const { icon: Icon, color } = buildingLook[type];
        const disabled = !editable || built.has(type);
        return (
          <button
            disabled={disabled}
            draggable={!disabled}
            key={type}
            type="button"
            title={built.has(type) ? "Already built: scale it from its settings" : nodeCatalog[type].role}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "copy";
              event.dataTransfer.setData(DRAG_TYPE, type);
            }}
            onClick={() => onBuild(type)}
          >
            <span className={`dock-icon ${color}`}>
              <Icon />
            </span>
            <span>
              <b>{nodeCatalog[type].short}</b>
              <small>{built.has(type) ? "built" : `from ${formatMoney(buildCost[type])}/mo`}</small>
            </span>
          </button>
        );
      })}
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

export function EventTicker({ second, result, phase }: { second: number; result?: SimulationResult; phase: Phase }) {
  const latest = result?.events.filter((event) => event.second <= second).at(-1);
  const snapshot = phase === "planning" ? undefined : result?.snapshots[second];
  const worst = snapshot
    ? (["failed", "saturated", "busy", "healthy"] as const).find((state) =>
        Object.values(snapshot.nodes).some((node) => node?.health === state),
      ) ?? "healthy"
    : undefined;
  return (
    <div className="event-ticker" aria-label="Park events" aria-live="polite">
      <span className="ticker-live">
        <i /> {phase === "planning" ? "PLAN" : "LIVE"}
      </span>
      <strong>{formatClock(second)}</strong>
      <span>{phase === "planning" ? "Build and connect, then press play." : (latest?.message ?? "Traffic is arriving.")}</span>
      {worst && <span className={`ticker-health ${worst}`}>{worst === "saturated" ? "overloaded" : worst}</span>}
    </div>
  );
}
