import { Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { moduleFor, nextLevel, type SimLevel } from "@/lib/curriculum";
import { evaluateRun } from "@/lib/evaluate";
import {
  architectureComplexity,
  architectureMonthlyCost,
  canConnect,
  createEdge,
  createNode,
  nodeCatalog,
  type Architecture,
  type NodeConfigs,
  type NodeType,
  type ParkNode,
} from "@/lib/model";
import { exportPark, importPark } from "@/lib/park-file";
import { forgetPark, recordResult, savePark } from "@/lib/progress";
import { runSimulation } from "@/lib/simulation";
import { validatePark } from "@/lib/topology";

import { updateProgress, useProgress } from "../progress-store";
import { JournalDialog, OutcomeDialog, PredictionDialog, QuizDialog, RefresherDialog } from "./dialogs";
import { gameReducer, initialGameState, type Prediction } from "./game-state";
import { Inspector } from "./inspector";
import {
  BuildDock,
  EventTicker,
  GameHud,
  MissionRail,
  SandboxControls,
  defaultSandbox,
  sandboxScenario,
  type SandboxSettings,
} from "./panels";
import { ParkMap } from "./park-map";
import { RunReview } from "./run-review";

/** Milliseconds per simulated second at 1× speed. */
const TICK_MS = 400;

export function GameScreen({ level }: { level: SimLevel }) {
  const navigate = useNavigate();
  const progress = useProgress();
  const isSandbox = level.id === "sandbox";
  const [state, dispatch] = useReducer(gameReducer, undefined, () =>
    initialGameState(level, structuredClone(progress.parks[level.id] ?? level.start()), {
      completed: Boolean(progress.levels[level.id]?.completed),
    }),
  );
  const [sandbox, setSandbox] = useState<SandboxSettings>(defaultSandbox);
  const importInput = useRef<HTMLInputElement>(null);
  const recordedRun = useRef<unknown>(null);

  const features = useMemo(() => new Set(level.unlocks.features), [level]);
  const validation = useMemo(() => validatePark(state.architecture), [state.architecture]);
  const monthlyCost = architectureMonthlyCost(state.architecture);
  const complexity = architectureComplexity(state.architecture);
  const run = state.run;
  const showingRun = state.phase !== "planning" && run !== null;
  const snapshot = showingRun ? run.result.snapshots[run.second] : undefined;
  const second = showingRun ? run.second : 0;
  const editable = state.phase === "planning" || state.phase === "finished";
  const selected = state.architecture.nodes.find((node) => node.id === state.selectedId);
  const dialog = state.dialogs[0];
  const budget = level.targets.find((target) => target.kind === "budget");
  const next = nextLevel(level.id);

  useEffect(() => {
    updateProgress((current) => savePark(current, level.id, state.architecture), { debounce: true });
  }, [level.id, state.architecture]);

  useEffect(() => {
    if (state.phase !== "running") return;
    const timer = window.setInterval(() => dispatch({ type: "tick" }), TICK_MS / state.speed);
    return () => window.clearInterval(timer);
  }, [state.phase, state.speed]);

  // The capstone asks its design-review questions before the score is final.
  useEffect(() => {
    if (state.phase !== "finished" || !run || recordedRun.current === run.result || isSandbox) return;
    if (!run.outcome.passed) return;
    if (level.after && !run.reviewed) {
      if (!state.dialogs.some((item) => item.kind === "after-quiz")) dispatch({ type: "open", dialog: { kind: "after-quiz" } });
      return;
    }
    recordedRun.current = run.result;
    updateProgress((current) => recordResult(current, level.id, { stars: run.outcome.stars, score: run.outcome.score?.total }));
  }, [isSandbox, level, run, state.dialogs, state.phase]);

  const edit = useCallback(
    (change: (architecture: Architecture) => Architecture, notice?: string) => {
      if (!editable) {
        dispatch({ type: "notice", notice: "Stop the run to change the park." });
        return;
      }
      dispatch({ type: "edit", architecture: change(state.architecture), notice });
    },
    [editable, state.architecture],
  );

  function startRun() {
    if (!validation.ok) {
      dispatch({ type: "notice", notice: validation.errors[0]! });
      return;
    }
    const architecture = structuredClone(state.architecture);
    const result = runSimulation(architecture, isSandbox ? sandboxScenario(sandbox) : level.scenario);
    dispatch({ type: "start-run", run: { result, architecture, outcome: evaluateRun(level, architecture, result), second: 0 } });
  }

  const predictionOptions = state.architecture.nodes
    .map((node) => node.type)
    .filter((type) => type !== "client");

  function play() {
    if (state.phase === "running") return dispatch({ type: "pause" });
    if (state.phase === "paused") return dispatch({ type: "resume" });
    if (!validation.ok) return dispatch({ type: "notice", notice: validation.errors[0]! });
    if (!isSandbox && state.attempts === 0 && state.prediction === null && predictionOptions.length > 0) {
      return dispatch({ type: "open", dialog: { kind: "prediction" } });
    }
    startRun();
  }

  function build(type: NodeType, position?: { x: number; y: number }) {
    if (state.architecture.nodes.some((node) => node.type === type)) {
      dispatch({ type: "notice", notice: `There is already a ${nodeCatalog[type].label.toLowerCase()}. Scale it from its settings.` });
      return;
    }
    const node = createNode(type, {}, position) as ParkNode;
    edit((architecture) => ({ ...architecture, nodes: [...architecture.nodes, node] }), `${nodeCatalog[type].label} built. Drag its arrow to connect it.`);
    dispatch({ type: "select", nodeId: node.id });
  }

  const connect = useCallback(
    (sourceId: string, targetId: string) => {
      const source = state.architecture.nodes.find((node) => node.id === sourceId);
      const target = state.architecture.nodes.find((node) => node.id === targetId);
      if (!source || !target || !canConnect(source.type, target.type)) {
        dispatch({ type: "connection-source", nodeId: null, notice: "Those buildings cannot be connected." });
        return;
      }
      edit(
        (architecture) => ({
          ...architecture,
          edges: architecture.edges.some((edge) => edge.source === sourceId && edge.target === targetId)
            ? architecture.edges
            : [...architecture.edges, createEdge(source, target)],
        }),
        `Routed ${nodeCatalog[source.type].label} → ${nodeCatalog[target.type].label}.`,
      );
      dispatch({ type: "connection-source", nodeId: null });
    },
    [edit, state.architecture.nodes],
  );

  const beginConnection = useCallback(
    (sourceId: string) => {
      const source = state.architecture.nodes.find((node) => node.id === sourceId);
      if (!source || !editable) return;
      dispatch({ type: "connection-source", nodeId: sourceId, notice: `Choose where ${nodeCatalog[source.type].label} sends traffic. Escape cancels.` });
    },
    [editable, state.architecture.nodes],
  );

  const cancelConnection = useCallback(
    () => dispatch({ type: "connection-source", nodeId: null, notice: "Connection cancelled." }),
    [],
  );

  function disconnect(edgeId: string) {
    edit((architecture) => ({ ...architecture, edges: architecture.edges.filter((edge) => edge.id !== edgeId) }), "Route removed.");
  }

  function remove(nodeId: string) {
    edit(
      (architecture) => ({
        ...architecture,
        nodes: architecture.nodes.filter((node) => node.id !== nodeId),
        edges: architecture.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
      }),
      "Building removed.",
    );
    dispatch({ type: "select", nodeId: null });
  }

  function configure(nodeId: string, change: Partial<NodeConfigs[NodeType]>) {
    edit((architecture) => ({
      ...architecture,
      nodes: architecture.nodes.map((node) =>
        node.id === nodeId ? ({ ...node, config: { ...node.config, ...change } } as ParkNode) : node,
      ),
    }));
  }

  function reset() {
    if (!editable) return dispatch({ type: "notice", notice: "Stop the run before resetting the park." });
    updateProgress((current) => forgetPark(current, level.id));
    dispatch({ type: "edit", architecture: level.start(), notice: "Back to the starting park." });
    dispatch({ type: "select", nodeId: null });
  }

  function download() {
    const url = URL.createObjectURL(new Blob([exportPark(state.architecture)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `scalelab-${level.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function upload(file?: File) {
    if (!file) return;
    try {
      const park = importPark(await file.text());
      const locked = park.nodes.filter((node) => node.type !== "client" && !level.unlocks.nodes.includes(node.type));
      if (locked.length > 0) {
        throw new Error(`This level has not unlocked: ${[...new Set(locked.map((node) => nodeCatalog[node.type].label))].join(", ")}.`);
      }
      edit(() => park, "Park imported.");
    } catch (error) {
      dispatch({ type: "notice", notice: error instanceof Error ? error.message : "That park could not be imported." });
    }
  }

  const firstSaturated = run?.result.totals.firstSaturated?.node;

  return (
    <main className="tycoon-shell">
      <GameHud
        level={level}
        phase={state.phase}
        speed={state.speed}
        snapshot={snapshot}
        second={second}
        duration={(isSandbox ? 60 : level.scenario.durationSeconds) - 1}
        monthlyCost={monthlyCost}
        complexity={complexity}
        budget={budget?.kind === "budget" ? budget.maxMonthly : undefined}
        hasRun={run !== null}
        hints={level.hints}
        hintsShown={state.hintsShown}
        hintOpen={state.hintOpen}
        onExit={() => navigate("/")}
        onPlay={play}
        onStop={() => dispatch({ type: "stop" })}
        onSpeed={(speed) => dispatch({ type: "speed", speed })}
        onReview={() => {
          if (state.phase === "running") dispatch({ type: "pause" });
          dispatch({ type: "open", dialog: { kind: "review" } });
        }}
        onHint={() => dispatch({ type: "hint" })}
        onToggleHint={() => dispatch({ type: "toggle-hint" })}
        onJournal={() => dispatch({ type: "open", dialog: { kind: "journal" } })}
        onExport={download}
        onImport={() => importInput.current?.click()}
        onReset={reset}
      />
      <input
        ref={importInput}
        hidden
        type="file"
        accept="application/json,.json"
        onChange={(event) => {
          void upload(event.target.files?.[0]);
          event.target.value = "";
        }}
      />

      <section className="game-stage" aria-label="ScaleLab technology park">
        <ParkMap
          architecture={state.architecture}
          snapshot={snapshot}
          selectedId={state.selectedId}
          connectionSource={state.connectionSource}
          editable={editable}
          onBuild={build}
          onCancelConnection={cancelConnection}
          onConnect={connect}
          onConnectionSource={beginConnection}
          onDisconnect={disconnect}
          onMove={(nodeId, position) => dispatch({ type: "move", nodeId, ...position })}
          onSelect={(nodeId) => dispatch({ type: "select", nodeId })}
        />
        <div className="stage-left">
          <MissionRail
            level={level}
            moduleTitle={moduleFor(level)?.title ?? ""}
            phase={state.phase}
            result={run?.result}
            second={second}
            finalTargets={run?.outcome.targets}
            warnings={validation.ok ? validation.warnings : validation.errors}
          />
          <BuildDock level={level} architecture={state.architecture} editable={editable} onBuild={(type) => build(type)} />
        </div>
        {isSandbox && <SandboxControls settings={sandbox} editable={editable} onChange={setSandbox} />}
        {selected && (
          <Inspector
            node={selected}
            architecture={state.architecture}
            features={features}
            metrics={snapshot?.nodes[selected.type]}
            editable={editable}
            onChange={(change) => configure(selected.id, change)}
            onRemove={() => remove(selected.id)}
            onDisconnect={disconnect}
            onClose={() => dispatch({ type: "select", nodeId: null })}
          />
        )}
        <div className="park-notice" role="status">
          <Sparkles size={14} /> {state.notice}
        </div>
        <EventTicker second={second} result={run?.result} phase={state.phase} />
      </section>

      {dialog?.kind === "refresher" && (
        <RefresherDialog
          lesson={level.refresher[dialog.step]!}
          step={dialog.step}
          total={level.refresher.length}
          onNext={() =>
            dialog.step + 1 < level.refresher.length
              ? dispatch({ type: "replace", dialog: { kind: "refresher", step: dialog.step + 1 } })
              : dispatch({ type: "close" })
          }
        />
      )}
      {dialog?.kind === "before-quiz" && level.before && (
        <QuizDialog title="Design first" steps={level.before} onComplete={() => dispatch({ type: "close" })} />
      )}
      {dialog?.kind === "after-quiz" && level.after && run && (
        <QuizDialog
          title="Design review"
          steps={level.after}
          onComplete={(reasoning) => {
            dispatch({ type: "update-outcome", outcome: evaluateRun(level, run.architecture, run.result, reasoning) });
            dispatch({ type: "close" });
          }}
        />
      )}
      {dialog?.kind === "prediction" && (
        <PredictionDialog
          options={[...new Set(predictionOptions)]}
          onPredict={(prediction: Prediction) => {
            dispatch({ type: "predict", prediction });
            dispatch({ type: "close" });
            startRun();
          }}
        />
      )}
      {dialog?.kind === "outcome" && run && (
        <OutcomeDialog
          outcome={run.outcome}
          prediction={state.attempts === 1 ? state.prediction : null}
          firstSaturated={firstSaturated}
          isSandbox={isSandbox}
          hasNext={Boolean(next)}
          onReview={() => dispatch({ type: "open", dialog: { kind: "review" } })}
          onEdit={() => dispatch({ type: "close" })}
          onNext={() => next && navigate(`/game/${next.id}`)}
          onMap={() => navigate("/")}
        />
      )}
      {dialog?.kind === "review" && run && (
        <RunReview
          result={run.result}
          second={run.second}
          onSeek={(target) => dispatch({ type: "seek", second: target })}
          onClose={() => dispatch({ type: "close" })}
        />
      )}
      {dialog?.kind === "journal" && <JournalDialog progress={progress} onClose={() => dispatch({ type: "close" })} />}
    </main>
  );
}
