import {
  Activity,
  Banknote,
  BookOpen,
  Boxes,
  Cable,
  CircleDollarSign,
  Cloud,
  Database,
  Download,
  Gauge,
  Globe2,
  HardDrive,
  Heart,
  Network,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Server,
  ShieldCheck,
  Sparkles,
  TimerReset,
  Trash2,
  Upload,
  Users,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  createNode,
  exportArchitecture,
  importArchitecture,
  starterArchitecture,
  type Architecture,
  type ArchitectureEdge,
  type ArchitectureNode,
  type ComponentConfig,
  type ComponentType,
} from "@/lib/architecture";
import {
  advanceTycoonState,
  buildingCosts,
  campaignChapters,
  chapterById,
  createTycoonState,
  demandForReputation,
  emptyGameProgress,
  initialArchitecture,
  restoreGameProgress,
  sandboxChapter,
  saveGameProgress,
  type AdvisorLesson,
  type CampaignChapter,
  type GameMode,
  type GameProgress,
  type GameSpeed,
  type TycoonState,
} from "@/lib/game";
import {
  createAttempt,
  recordAttempt,
  restoreAttemptHistory,
  saveAttemptHistory,
  type AttemptHistory,
} from "@/lib/attempts";
import { scoreChallenge } from "@/lib/challenge";
import {
  explainFailure,
  runSimulation,
  type SimulationCommand,
  type SimulationEvent,
  type SimulationResult,
  type ScenarioIncident,
  type Snapshot,
} from "@/lib/simulation";

type PendingBuild = { node: ArchitectureNode; readyAt: number };
type PendingRoute = { edge: ArchitectureEdge; readyAt: number };
type PendingRemoval = { nodeId: string; readyAt: number };
type Checkpoint = { architecture: Architecture; game: TycoonState };
type GameWorkerEvent =
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "events"; events: SimulationEvent[] }
  | { type: "deployment-complete"; event: SimulationEvent }
  | { type: "failure" | "chapter-complete"; result: SimulationResult }
  | { type: "error"; message: string }
  | { type: "started" | "paused" | "resumed" | "reset" | "commands-accepted" };
const REPLICA_DEPLOYMENT_COST = 1_800;

const buildingMeta: Record<
  ComponentType,
  { name: string; short: string; icon: typeof Server; color: string }
> = {
  client: { name: "User gate", short: "Users", icon: Users, color: "mint" },
  cdn: { name: "Edge plaza", short: "CDN", icon: Globe2, color: "sky" },
  "load-balancer": { name: "Traffic tower", short: "Balancer", icon: Network, color: "violet" },
  "api-server": { name: "API workshop", short: "API", icon: Server, color: "coral" },
  cache: { name: "Cache kiosk", short: "Cache", icon: Zap, color: "yellow" },
  "primary-database": { name: "Data vault", short: "Database", icon: Database, color: "blue" },
  "read-replica": { name: "Read annex", short: "Replica", icon: HardDrive, color: "indigo" },
  queue: { name: "Queue depot", short: "Queue", icon: Boxes, color: "orange" },
  worker: { name: "Worker garage", short: "Worker", icon: TimerReset, color: "green" },
};

export function TycoonGame() {
  const [screen, setScreen] = useState<"menu" | "game">("menu");
  const [progress, setProgress] = useState<GameProgress>(emptyGameProgress);
  const [game, setGame] = useState<TycoonState>(() => createTycoonState("campaign"));
  const [architecture, setArchitecture] = useState<Architecture>(() => starterArchitecture());
  const [selectedId, setSelectedId] = useState<string>("");
  const [connectionSource, setConnectionSource] = useState<string | null>(null);
  const [pendingBuilds, setPendingBuilds] = useState<PendingBuild[]>([]);
  const [pendingRoutes, setPendingRoutes] = useState<PendingRoute[]>([]);
  const [pendingRemovals, setPendingRemovals] = useState<PendingRemoval[]>([]);
  const [advisor, setAdvisor] = useState<AdvisorLesson | null>(null);
  const [journalOpen, setJournalOpen] = useState(false);
  const [notice, setNotice] = useState("Choose a chapter to open your park.");
  const [hydrated, setHydrated] = useState(false);
  const [attemptHistory, setAttemptHistory] = useState<AttemptHistory>();
  const [liveSnapshot, setLiveSnapshot] = useState<Snapshot>();
  const [liveResult, setLiveResult] = useState<SimulationResult>();
  const worker = useRef<Worker | null>(null);
  const checkpoint = useRef<Checkpoint | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const recordedResult = useRef<SimulationResult | null>(null);

  const currentChapter = chapterById(game.chapterId);
  const previewResult = useMemo(
    () => runSimulation(architecture, currentChapter.scenario, [], 730_241),
    [architecture, currentChapter],
  );
  const snapshot = liveSnapshot ?? previewResult.snapshots[0];
  const selected = architecture.nodes.find((node) => node.id === selectedId);
  const failure = game.phase === "failed" ? explainFailure(liveResult ?? previewResult) : null;
  const score = liveResult ? scoreChallenge(liveResult, architecture) : null;

  useEffect(() => {
    const restored = restoreGameProgress(window.localStorage);
    setProgress(restored);
    setAttemptHistory(restoreAttemptHistory(window.localStorage));
    setHydrated(true);
  }, []);

  useEffect(() => {
    worker.current = new Worker(new URL("../workers/simulation.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.current.onmessage = (event: MessageEvent<GameWorkerEvent>) => {
      const data = event.data;
      if (data.type === "snapshot") {
        setLiveSnapshot(data.snapshot);
        setGame((current) => {
          const next = advanceTycoonState(current, data.snapshot);
          const chapter = chapterById(current.chapterId);
          if (
            current.mode === "campaign" &&
            next.phase === "running" &&
            data.snapshot.second < chapter.scenario.durationSeconds - 1
          ) {
            worker.current?.postMessage({
              type: "apply-command",
              commands: [
                {
                  type: "traffic",
                  atSecond: data.snapshot.second + 1,
                  rps: demandForReputation(chapter, data.snapshot.second + 1, next.reputation),
                },
              ],
            });
          }
          return next;
        });
      } else if (data.type === "events") {
        setGame((current) => ({
          ...current,
          eventLog: [
            ...data.events.map((item) => item.message).reverse(),
            ...current.eventLog,
          ].slice(0, 8),
        }));
      } else if (data.type === "deployment-complete") {
        setNotice(data.event.message);
      } else if (data.type === "failure" || data.type === "chapter-complete") {
        setLiveResult(data.result);
        setGame((current) => ({
          ...current,
          phase:
            data.result.outcome === "failed"
              ? "failed"
              : current.mode === "campaign"
                ? "completed"
                : "paused",
        }));
      } else if (data.type === "error") {
        setNotice(data.message);
        setGame((current) => ({ ...current, phase: "paused" }));
      }
    };
    worker.current.onerror = () => {
      setNotice("The simulation worker stopped. Reload the park to restart it.");
      setGame((current) => ({ ...current, phase: "paused" }));
    };
    return () => worker.current?.terminate();
  }, []);

  useEffect(() => {
    if (game.phase !== "running") return;
    const timer = window.setInterval(
      () => worker.current?.postMessage({ type: "advance" }),
      900 / game.speed,
    );
    return () => window.clearInterval(timer);
  }, [game.phase, game.speed]);

  useEffect(() => {
    if (pendingBuilds.length === 0) return;
    const ready = pendingBuilds.filter((build) => build.readyAt <= game.second);
    if (ready.length === 0) return;
    setArchitecture((current) => ({
      ...current,
      nodes: [...current.nodes, ...ready.map((build) => build.node)],
    }));
    setPendingBuilds((current) => current.filter((build) => build.readyAt > game.second));
    setNotice(`${ready.map((build) => buildingMeta[build.node.type].name).join(", ")} deployed.`);
  }, [game.second, pendingBuilds]);

  useEffect(() => {
    const readyRoutes = pendingRoutes.filter((route) => route.readyAt <= game.second);
    const readyRemovals = pendingRemovals.filter((removal) => removal.readyAt <= game.second);
    if (readyRoutes.length === 0 && readyRemovals.length === 0) return;
    setArchitecture((current) => ({
      ...current,
      nodes: current.nodes.filter(
        (node) => !readyRemovals.some((removal) => removal.nodeId === node.id),
      ),
      edges: [
        ...current.edges.filter(
          (edge) =>
            !readyRemovals.some(
              (removal) => edge.source === removal.nodeId || edge.target === removal.nodeId,
            ),
        ),
        ...readyRoutes.map((route) => route.edge),
      ],
    }));
    setPendingRoutes((current) => current.filter((route) => route.readyAt > game.second));
    setPendingRemovals((current) => current.filter((removal) => removal.readyAt > game.second));
  }, [game.second, pendingRemovals, pendingRoutes]);

  useEffect(() => {
    if (!snapshot || game.phase !== "running") return;
    const lesson = currentChapter.lessons.find(
      (item) => !game.encounteredConcepts.includes(item.concept) && shouldTeach(item, snapshot),
    );
    if (!lesson) return;
    setAdvisor(lesson);
    setGame((current) => ({
      ...current,
      phase: "paused",
      encounteredConcepts: [...current.encounteredConcepts, lesson.concept],
      eventLog: [`Advisor: ${lesson.title}`, ...current.eventLog].slice(0, 8),
    }));
    setProgress((current) => {
      const next = {
        ...current,
        encounteredConcepts: [...new Set([...current.encounteredConcepts, lesson.concept])],
      };
      saveGameProgress(window.localStorage, next);
      return next;
    });
  }, [currentChapter.lessons, game.encounteredConcepts, game.phase, snapshot]);

  useEffect(() => {
    if (game.phase !== "completed" || game.mode !== "campaign") return;
    setProgress((current) => {
      const next = {
        ...current,
        completedChapterIds: [...new Set([...current.completedChapterIds, game.chapterId])],
      };
      saveGameProgress(window.localStorage, next);
      return next;
    });
  }, [game.chapterId, game.mode, game.phase]);

  useEffect(() => {
    if (
      !liveResult ||
      game.chapterId !== "global-launch" ||
      recordedResult.current === liveResult ||
      (game.phase !== "completed" && game.phase !== "failed")
    ) {
      return;
    }
    recordedResult.current = liveResult;
    const attempt = createAttempt({
      id: crypto.randomUUID(),
      completedAt: new Date().toISOString(),
      architecture,
      result: {
        simulation: liveResult,
        score: scoreChallenge(liveResult, architecture),
        seed: 730_241,
      },
    });
    setAttemptHistory((current) => {
      const next = recordAttempt(current ?? restoreAttemptHistory(window.localStorage), attempt);
      saveAttemptHistory(window.localStorage, next);
      return next;
    });
  }, [architecture, game.chapterId, game.phase, liveResult]);

  function startGame(mode: GameMode, chapter: CampaignChapter) {
    const nextArchitecture =
      mode === "sandbox" ? initialArchitecture(progress) : architectureForChapter(chapter);
    const nextGame = createTycoonState(mode, chapter.id);
    setArchitecture(nextArchitecture);
    setGame(nextGame);
    checkpoint.current = {
      architecture: structuredClone(nextArchitecture),
      game: structuredClone(nextGame),
    };
    setLiveSnapshot(runSimulation(nextArchitecture, chapter.scenario, [], 730_241).snapshots[0]);
    setLiveResult(undefined);
    recordedResult.current = null;
    worker.current?.postMessage({
      type: "start",
      architecture: nextArchitecture,
      scenario: chapter.scenario,
      commands: [],
      seed: 730_241,
    });
    setSelectedId(nextArchitecture.nodes[0]?.id ?? "");
    setPendingBuilds([]);
    setPendingRoutes([]);
    setPendingRemovals([]);
    setConnectionSource(null);
    setAdvisor(null);
    setNotice(`${chapter.name} loaded. Press play when you are ready for traffic.`);
    setScreen("game");
  }

  function togglePlay() {
    worker.current?.postMessage({ type: game.phase === "running" ? "pause" : "resume" });
    setGame((current) => ({
      ...current,
      phase: current.phase === "running" ? "paused" : "running",
      eventLog: [
        current.phase === "running" ? "Park paused." : "Traffic is moving.",
        ...current.eventLog,
      ].slice(0, 8),
    }));
  }

  function build(type: ComponentType) {
    const cost = buildingCosts[type];
    if (game.cash < cost) {
      setNotice(`You need ${formatMoney(cost)} to build ${buildingMeta[type].name}.`);
      return;
    }
    const node = createNode(type, architecture.nodes.length + pendingBuilds.length);
    node.x = 130 + ((architecture.nodes.length * 173) % 650);
    node.y = 135 + ((architecture.nodes.length * 97) % 330);
    node.label = buildingMeta[type].name;
    setPendingBuilds((current) => [...current, { node, readyAt: game.second + 4 }]);
    postCommands([
      {
        atSecond: game.second,
        type: "add-node",
        node,
        deploymentDelaySeconds: 4,
      },
    ]);
    setGame((current) => ({
      ...current,
      cash: current.cash - cost,
      eventLog: [`${buildingMeta[type].name} starts construction.`, ...current.eventLog].slice(
        0,
        8,
      ),
    }));
    setNotice(`${buildingMeta[type].name} will open in 4 simulated seconds.`);
  }

  function selectNode(node: ArchitectureNode) {
    if (connectionSource && connectionSource !== node.id) {
      const exists = architecture.edges.some(
        (edge) => edge.source === connectionSource && edge.target === node.id,
      );
      if (!exists) {
        const edge = {
          id: crypto.randomUUID(),
          source: connectionSource,
          target: node.id,
          weight: 100,
        };
        setPendingRoutes((current) => [...current, { edge, readyAt: game.second + 2 }]);
        postCommands([
          {
            atSecond: game.second,
            type: "connect",
            edge,
            deploymentDelaySeconds: 2,
          },
        ]);
        setNotice(`Traffic route to ${node.label} deploys in 2 simulated seconds.`);
      }
      setConnectionSource(null);
    }
    setSelectedId(node.id);
  }

  function addReplica() {
    if (!selected || game.cash < REPLICA_DEPLOYMENT_COST) return;
    postCommands([
      {
        atSecond: game.second,
        type: "capacity",
        nodeId: selected.id,
        replicaDelta: 1,
        deploymentDelaySeconds: 3,
      },
    ]);
    setGame((current) => ({
      ...current,
      cash: current.cash - REPLICA_DEPLOYMENT_COST,
      eventLog: [`One ${selected.label} replica starts deployment.`, ...current.eventLog].slice(
        0,
        8,
      ),
    }));
    setNotice(`${selected.label} capacity becomes active in 3 simulated seconds.`);
  }

  function removeSelected() {
    if (!selected || selected.type === "client") return;
    setPendingRemovals((current) => [
      ...current,
      { nodeId: selected.id, readyAt: game.second + 2 },
    ]);
    postCommands([
      {
        atSecond: game.second,
        type: "remove-node",
        nodeId: selected.id,
        deploymentDelaySeconds: 2,
      },
    ]);
    setSelectedId("");
    setNotice(`${selected.label} shuts down in 2 simulated seconds.`);
  }

  function updateRouteWeight(edgeId: string, weight: number) {
    const edge = architecture.edges.find((candidate) => candidate.id === edgeId);
    if (!edge) return;
    const updated = { ...edge, weight: Math.max(1, Math.min(100, weight)) };
    setArchitecture((current) => ({
      ...current,
      edges: current.edges.map((candidate) => (candidate.id === edgeId ? updated : candidate)),
    }));
    postCommands([
      {
        atSecond: game.second,
        type: "connect",
        edge: updated,
        deploymentDelaySeconds: 2,
      },
    ]);
    setNotice("Routing weight update deploys in 2 simulated seconds.");
  }

  function setSandboxTraffic(rps: number) {
    postCommands([{ atSecond: game.second + 1, type: "traffic", rps }]);
    setNotice(`Traffic target changes to ${rps.toLocaleString()} req/s next tick.`);
  }

  function injectIncident(type: ScenarioIncident["type"]) {
    postCommands([
      {
        atSecond: game.second + 1,
        type: "incident",
        incident: {
          type,
          durationSeconds: 6,
          ...(type === "regional-latency" ? { region: "us-east" as const } : {}),
        },
        deploymentDelaySeconds: 0,
      },
    ]);
    setNotice(`${type.replaceAll("-", " ")} scheduled for the next tick.`);
  }

  function retryCheckpoint() {
    const restored = checkpoint.current;
    if (!restored) return;
    const restoredGame = structuredClone(restored.game);
    const restoredArchitecture = structuredClone(restored.architecture);
    setArchitecture(restoredArchitecture);
    setGame(restoredGame);
    setPendingBuilds([]);
    setPendingRoutes([]);
    setPendingRemovals([]);
    setLiveSnapshot(
      runSimulation(restoredArchitecture, currentChapter.scenario, [], 730_241).snapshots[0],
    );
    setLiveResult(undefined);
    recordedResult.current = null;
    worker.current?.postMessage({
      type: "start",
      architecture: restoredArchitecture,
      scenario: currentChapter.scenario,
      commands: [],
      seed: 730_241,
    });
    setAdvisor(null);
    setNotice("Checkpoint restored. Adjust the park before traffic resumes.");
  }

  function updateSelectedConfig(changes: SimulationCommand & { type: "configure" }) {
    if (!selected) return;
    postCommands([changes]);
    setArchitecture((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === selected.id
          ? { ...node, config: { ...node.config, ...changes.changes } }
          : node,
      ),
    }));
    setNotice(`${selected.label} configuration deploys in 2 simulated seconds.`);
  }

  function postCommands(commands: SimulationCommand[]) {
    worker.current?.postMessage({ type: "apply-command", commands });
  }

  function downloadArchitecture() {
    const url = URL.createObjectURL(
      new Blob([exportArchitecture(architecture)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "scalelab-park.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function loadArchitecture(file?: File) {
    if (!file) return;
    try {
      const next = importArchitecture(await file.text());
      setArchitecture(next);
      setSelectedId(next.nodes[0]?.id ?? "");
      worker.current?.postMessage({
        type: "start",
        architecture: next,
        scenario: currentChapter.scenario,
        commands: [],
        seed: 730_241,
      });
      setNotice("Imported park loaded and the live session restarted.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The park file could not be imported.");
    }
  }

  if (screen === "menu") {
    return (
      <GameMenu
        ready={hydrated}
        attemptHistory={attemptHistory}
        progress={progress}
        onCampaign={(chapter) => startGame("campaign", chapter)}
        onSandbox={() => startGame("sandbox", sandboxChapter)}
      />
    );
  }

  return (
    <main className="tycoon-shell">
      <GameHud
        game={game}
        snapshot={snapshot}
        onExit={() => setScreen("menu")}
        onJournal={() => setJournalOpen(true)}
        onExport={downloadArchitecture}
        onImport={() => importInput.current?.click()}
        onPlay={togglePlay}
        onSpeed={(speed) => setGame((current) => ({ ...current, speed }))}
      />
      <input
        ref={importInput}
        hidden
        type="file"
        accept="application/json,.json"
        onChange={(event) => loadArchitecture(event.target.files?.[0])}
      />

      <section className="game-stage" aria-label="ScaleLab technology park">
        <aside className="mission-rail">
          <span className="mission-kicker">
            {game.mode === "sandbox" ? "Free build" : `Chapter ${currentChapter.number}`}
          </span>
          <h1>{currentChapter.name}</h1>
          <p>{currentChapter.strapline}</p>
          <div className="mission-objective">
            <ShieldCheck size={17} />
            <span>{currentChapter.objective}</span>
          </div>
          <div className="mission-progress">
            <span
              style={{ width: `${(game.second / currentChapter.scenario.durationSeconds) * 100}%` }}
            />
          </div>
          <small>Next traffic wave at {formatClock(currentChapter.scenario.spikeAtSecond)}</small>
        </aside>

        <BuildDock cash={game.cash} chapter={currentChapter} onBuild={build} />
        {game.mode === "sandbox" && (
          <SandboxControls onIncident={injectIncident} onTraffic={setSandboxTraffic} />
        )}

        <ParkMap
          architecture={architecture}
          connectionSource={connectionSource}
          pendingBuilds={pendingBuilds}
          selectedId={selectedId}
          snapshot={snapshot}
          onSelect={selectNode}
        />

        {selected && (
          <BuildingInspector
            connecting={connectionSource === selected.id}
            node={selected}
            snapshot={snapshot}
            onClose={() => setSelectedId("")}
            onConnect={() => {
              setConnectionSource(selected.id);
              setNotice("Choose the next building on the traffic route.");
            }}
            onReplica={addReplica}
            onRemove={removeSelected}
            routes={architecture.edges
              .filter((edge) => edge.source === selected.id)
              .map((edge) => ({
                edge,
                label:
                  architecture.nodes.find((node) => node.id === edge.target)?.label ??
                  "Destination",
              }))}
            onRouteWeight={updateRouteWeight}
            onConfigure={(changes) =>
              updateSelectedConfig({
                atSecond: game.second,
                type: "configure",
                nodeId: selected.id,
                changes,
                deploymentDelaySeconds: 2,
              })
            }
          />
        )}

        <div className="park-notice" role="status">
          <Sparkles size={14} /> {notice}
        </div>

        <EventTicker game={game} snapshot={snapshot} />
      </section>

      {advisor && (
        <AdvisorDialog
          lesson={advisor}
          onClose={() => {
            setAdvisor(null);
            setNotice("Lesson saved to the system-design journal.");
          }}
        />
      )}

      {journalOpen && <Journal progress={progress} onClose={() => setJournalOpen(false)} />}

      {(game.phase === "failed" || game.phase === "completed") && (
        <OutcomeDialog
          completed={game.phase === "completed"}
          failure={failure}
          game={game}
          snapshot={snapshot}
          score={score}
          onMenu={() => setScreen("menu")}
          onRetry={retryCheckpoint}
        />
      )}
    </main>
  );
}

function GameMenu({
  ready,
  attemptHistory,
  progress,
  onCampaign,
  onSandbox,
}: {
  ready: boolean;
  attemptHistory?: AttemptHistory;
  progress: GameProgress;
  onCampaign: (chapter: CampaignChapter) => void;
  onSandbox: () => void;
}) {
  return (
    <main className="game-menu">
      <div className="menu-sky" aria-hidden="true">
        <Cloud className="cloud cloud-one" />
        <Cloud className="cloud cloud-two" />
      </div>
      <section className="menu-hero">
        <div className="menu-brand">
          <span className="menu-brand-mark">
            <Activity />
          </span>
          <span>ScaleLab Park</span>
        </div>
        <p className="menu-eyebrow">A system design tycoon</p>
        <h1>
          Grow the crowd.
          <br />
          Keep the links alive.
        </h1>
        <p className="menu-lede">
          Build a tiny URL-shortener startup into global infrastructure. Watch every queue, outage,
          cache hit, and scaling decision play out on the park floor.
        </p>
        <button
          className="menu-primary"
          disabled={!ready}
          type="button"
          onClick={() => onCampaign(campaignChapters[0]!)}
        >
          <Play size={18} fill="currentColor" /> Open the park
        </button>
        <button className="menu-secondary" disabled={!ready} type="button" onClick={onSandbox}>
          <Boxes size={18} /> Enter sandbox
        </button>
        {attemptHistory && attemptHistory.attempts.length > 0 && (
          <p className="legacy-score">
            Previous challenge record · best {attemptHistory.bestScore?.toLocaleString()} / 1,000 ·{" "}
            {attemptHistory.attempts.length} saved attempts
          </p>
        )}
      </section>

      <section className="chapter-path" aria-label="Campaign chapters">
        <div className="chapter-path-heading">
          <span>Campaign map</span>
          <small>{progress.completedChapterIds.length} / 5 complete</small>
        </div>
        {campaignChapters.map((chapter, index) => {
          const unlocked =
            index === 0 || progress.completedChapterIds.includes(campaignChapters[index - 1]!.id);
          const complete = progress.completedChapterIds.includes(chapter.id);
          return (
            <button
              className={`chapter-stop ${complete ? "complete" : ""}`}
              disabled={!ready || !unlocked}
              key={chapter.id}
              type="button"
              onClick={() => onCampaign(chapter)}
            >
              <span className="chapter-number">{complete ? "✓" : chapter.number}</span>
              <span>
                <b>{chapter.name}</b>
                <small>{unlocked ? chapter.concept : "Complete the previous chapter"}</small>
              </span>
            </button>
          );
        })}
      </section>

      <p className="menu-disclaimer">
        Educational simulation · local progress · no production forecast
      </p>
    </main>
  );
}

function GameHud({
  game,
  snapshot,
  onExit,
  onJournal,
  onExport,
  onImport,
  onPlay,
  onSpeed,
}: {
  game: TycoonState;
  snapshot?: Snapshot;
  onExit: () => void;
  onJournal: () => void;
  onExport: () => void;
  onImport: () => void;
  onPlay: () => void;
  onSpeed: (speed: GameSpeed) => void;
}) {
  return (
    <header className="game-hud">
      <button className="hud-brand" type="button" onClick={onExit}>
        <Activity size={18} /> ScaleLab Park
      </button>
      <div className="hud-stat">
        <Users />
        <span>
          Active users<b>{game.activeUsers.toLocaleString()}</b>
        </span>
      </div>
      <div className="hud-stat">
        <Banknote />
        <span>
          Cash<b>{formatMoney(game.cash)}</b>
        </span>
      </div>
      <div className="hud-stat">
        <Heart />
        <span>
          Reputation<b>{game.reputation.toFixed(0)}%</b>
        </span>
      </div>
      <div className="hud-stat">
        <Gauge />
        <span>
          Availability<b>{snapshot ? `${(snapshot.availability * 100).toFixed(2)}%` : "—"}</b>
        </span>
      </div>
      <div className="hud-stat">
        <Zap />
        <span>
          p95 latency<b>{snapshot ? `${snapshot.p95LatencyMs}ms` : "—"}</b>
        </span>
      </div>
      <div className="hud-clock">
        <span>Day 1</span>
        <b>{formatClock(game.second)}</b>
      </div>
      <div className="time-controls" aria-label="Game speed controls">
        <button
          type="button"
          aria-label={game.phase === "running" ? "Pause park" : "Start park"}
          onClick={onPlay}
        >
          {game.phase === "running" ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
        </button>
        {([1, 2, 4] as GameSpeed[]).map((speed) => (
          <button
            className={game.speed === speed ? "active" : ""}
            key={speed}
            type="button"
            onClick={() => onSpeed(speed)}
          >
            {speed}×
          </button>
        ))}
      </div>
      <button
        className="journal-button"
        type="button"
        onClick={onJournal}
        aria-label="Open system design journal"
      >
        <BookOpen />
      </button>
      <button className="journal-button" type="button" onClick={onExport} aria-label="Export park">
        <Download />
      </button>
      <button className="journal-button" type="button" onClick={onImport} aria-label="Import park">
        <Upload />
      </button>
    </header>
  );
}

function BuildDock({
  cash,
  chapter,
  onBuild,
}: {
  cash: number;
  chapter: CampaignChapter;
  onBuild: (type: ComponentType) => void;
}) {
  return (
    <aside className="build-dock" aria-label="Build infrastructure">
      <div className="dock-heading">
        <Plus />
        <span>Build</span>
      </div>
      {chapter.unlocked
        .filter((type) => type !== "client")
        .map((type) => {
          const item = buildingMeta[type];
          const Icon = item.icon;
          return (
            <button
              disabled={cash < buildingCosts[type]}
              key={type}
              type="button"
              onClick={() => onBuild(type)}
            >
              <span className={`dock-icon ${item.color}`}>
                <Icon />
              </span>
              <span>
                <b>{item.short}</b>
                <small>{formatMoney(buildingCosts[type])}</small>
              </span>
            </button>
          );
        })}
    </aside>
  );
}

function SandboxControls({
  onIncident,
  onTraffic,
}: {
  onIncident: (type: ScenarioIncident["type"]) => void;
  onTraffic: (rps: number) => void;
}) {
  return (
    <aside className="sandbox-controls" aria-label="Sandbox controls">
      <span>Traffic lab</span>
      <div>
        {[2_000, 8_000, 18_000].map((rps) => (
          <button key={rps} type="button" onClick={() => onTraffic(rps)}>
            {rps / 1_000}k users
          </button>
        ))}
      </div>
      <span>Inject incident</span>
      <div>
        <button type="button" onClick={() => onIncident("cache-failure")}>
          Cache fail
        </button>
        <button type="button" onClick={() => onIncident("database-slowdown")}>
          DB slow
        </button>
        <button type="button" onClick={() => onIncident("regional-latency")}>
          Region lag
        </button>
      </div>
    </aside>
  );
}

function ParkMap({
  architecture,
  connectionSource,
  pendingBuilds,
  selectedId,
  snapshot,
  onSelect,
}: {
  architecture: Architecture;
  connectionSource: string | null;
  pendingBuilds: PendingBuild[];
  selectedId: string;
  snapshot?: Snapshot;
  onSelect: (node: ArchitectureNode) => void;
}) {
  const paths = architecture.edges
    .map((edge) => {
      const source = architecture.nodes.find((node) => node.id === edge.source);
      const target = architecture.nodes.find((node) => node.id === edge.target);
      if (!source || !target) return null;
      return { edge, source, target, d: routePath(source, target) };
    })
    .filter(Boolean) as {
    edge: Architecture["edges"][number];
    source: ArchitectureNode;
    target: ArchitectureNode;
    d: string;
  }[];
  return (
    <div className="park-map">
      <div className="park-hills" aria-hidden="true" />
      <div className="park-road" aria-hidden="true" />
      <div className="park-gate" aria-hidden="true">
        <Users />
        <span>THE INTERNET</span>
      </div>
      <svg className="route-layer" aria-label="Active traffic routes">
        {paths.map(({ edge, d }) => {
          const allocation = snapshot?.routeAllocations.find(
            (route) => route.sourceNodeId === edge.source && route.targetNodeId === edge.target,
          );
          const routeDemand = allocation?.offered ?? snapshot?.offered ?? 1;
          const packetCount = Math.max(1, Math.min(5, Math.ceil(routeDemand / 4_000)));
          const congested = Boolean(snapshot?.queued) || allocation?.affected === true;
          const packetDuration = allocation?.affected
            ? 5
            : congested
              ? 4.2
              : routeDemand > 10_000
                ? 1.6
                : 2.6;
          return (
            <g key={edge.id}>
              <path className="route-shadow" d={d} />
              <path
                className={allocation?.affected ? "route-line interrupted" : "route-line"}
                d={d}
              />
              {Array.from({ length: packetCount }, (_, dot) => (
                <circle
                  className={congested ? "traffic-packet congested" : "traffic-packet"}
                  key={dot}
                  r="5"
                >
                  <animateMotion
                    begin={`${dot * -(packetDuration / packetCount)}s`}
                    dur={`${packetDuration}s`}
                    path={d}
                    repeatCount="indefinite"
                  />
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
      <div className="park-tree tree-a" aria-hidden="true">
        ♣
      </div>
      <div className="park-tree tree-b" aria-hidden="true">
        ♣
      </div>
      <div className="park-tree tree-c" aria-hidden="true">
        ♣
      </div>
      {architecture.nodes.map((node) => (
        <Building
          connecting={connectionSource === node.id}
          health={snapshot?.nodeHealth[node.id]}
          key={node.id}
          node={node}
          selected={selectedId === node.id}
          onClick={() => onSelect(node)}
        />
      ))}
      {pendingBuilds.map(({ node, readyAt }) => (
        <div className="building-site" key={node.id} style={{ left: node.x, top: node.y }}>
          <div className="construction-crane">┐</div>
          <span>Building · {Math.max(0, readyAt - (snapshot?.second ?? 0))}s</span>
        </div>
      ))}
    </div>
  );
}

function Building({
  node,
  health,
  selected,
  connecting,
  onClick,
}: {
  node: ArchitectureNode;
  health?: string;
  selected: boolean;
  connecting: boolean;
  onClick: () => void;
}) {
  const item = buildingMeta[node.type];
  const Icon = item.icon;
  return (
    <button
      className={`park-building ${item.color} health-${health ?? "healthy"} ${selected ? "selected" : ""} ${connecting ? "connecting" : ""}`}
      style={{ left: node.x, top: node.y }}
      type="button"
      onClick={onClick}
      aria-label={`${node.label}, ${health ?? "healthy"}, ${node.config.replicas} replicas`}
    >
      <span className="building-status">{health ?? "healthy"}</span>
      <span className="building-roof">
        <Icon />
      </span>
      <span className="building-body">
        <i />
        <i />
        <i />
      </span>
      <span className="building-label">
        <b>{node.label}</b>
        <small>×{node.config.replicas}</small>
      </span>
      {(health === "heating" || health === "saturated" || health === "failed") && (
        <span className="building-smoke">● ●</span>
      )}
    </button>
  );
}

function BuildingInspector({
  node,
  snapshot,
  connecting,
  onClose,
  onConnect,
  onReplica,
  onRemove,
  onConfigure,
  routes,
  onRouteWeight,
}: {
  node: ArchitectureNode;
  snapshot?: Snapshot;
  connecting: boolean;
  onClose: () => void;
  onConnect: () => void;
  onReplica: () => void;
  onRemove: () => void;
  onConfigure: (changes: Partial<Omit<ComponentConfig, "replicas">>) => void;
  routes: { edge: ArchitectureEdge; label: string }[];
  onRouteWeight: (edgeId: string, weight: number) => void;
}) {
  const item = buildingMeta[node.type];
  const Icon = item.icon;
  return (
    <aside className="building-inspector" aria-label={`${node.label} controls`}>
      <button
        className="inspector-close"
        type="button"
        onClick={onClose}
        aria-label="Close building controls"
      >
        <X />
      </button>
      <div className={`inspector-avatar ${item.color}`}>
        <Icon />
      </div>
      <div>
        <span className="inspector-kicker">{item.name}</span>
        <h2>{node.label}</h2>
      </div>
      <div className="inspector-health">
        <Activity />
        <span>
          Current state<b>{snapshot?.nodeHealth[node.id] ?? "healthy"}</b>
        </span>
      </div>
      <dl>
        <div>
          <dt>Replicas</dt>
          <dd>{snapshot?.activeReplicas[node.id] ?? node.config.replicas}</dd>
        </div>
        <div>
          <dt>Capacity</dt>
          <dd>{node.config.capacity.toLocaleString()}/s</dd>
        </div>
        <div>
          <dt>Service time</dt>
          <dd>{node.config.serviceTimeMs}ms</dd>
        </div>
        <div>
          <dt>Region</dt>
          <dd>{node.config.region}</dd>
        </div>
      </dl>
      <div className="inspector-config">
        <label>
          Region
          <select
            aria-label="Building region"
            value={node.config.region}
            onChange={(event) =>
              onConfigure({ region: event.target.value as ComponentConfig["region"] })
            }
          >
            <option value="us-east">US East</option>
            <option value="us-west">US West</option>
            <option value="eu-west">EU West</option>
            <option value="ap-south">AP South</option>
          </select>
        </label>
        {node.type === "cache" && (
          <>
            <label>
              Cache size
              <input
                aria-label="Cache size"
                type="number"
                min="100"
                value={node.config.cacheSize}
                onChange={(event) => onConfigure({ cacheSize: Number(event.target.value) })}
              />
            </label>
            <label>
              TTL seconds
              <input
                aria-label="TTL seconds"
                type="number"
                min="1"
                value={node.config.ttlSeconds}
                onChange={(event) => onConfigure({ ttlSeconds: Number(event.target.value) })}
              />
            </label>
          </>
        )}
        {(["load-balancer", "api-server", "worker"] as ComponentType[]).includes(node.type) && (
          <>
            <label>
              Timeout ms
              <input
                aria-label="Timeout milliseconds"
                type="number"
                min="1"
                value={node.config.timeoutMs}
                onChange={(event) => onConfigure({ timeoutMs: Number(event.target.value) })}
              />
            </label>
            <label>
              Retries
              <input
                aria-label="Retry attempts"
                type="number"
                min="0"
                max="10"
                value={node.config.retries}
                onChange={(event) => onConfigure({ retries: Number(event.target.value) })}
              />
            </label>
            <label className="inspector-check">
              <input
                aria-label="Enable autoscaling"
                type="checkbox"
                checked={node.config.autoscaling.enabled}
                onChange={(event) =>
                  onConfigure({
                    autoscaling: { ...node.config.autoscaling, enabled: event.target.checked },
                  })
                }
              />
              Autoscaling
            </label>
          </>
        )}
        {node.type === "queue" && (
          <label>
            Queue capacity
            <input
              aria-label="Queue capacity"
              type="number"
              min="1"
              value={node.config.queueCapacity}
              onChange={(event) => onConfigure({ queueCapacity: Number(event.target.value) })}
            />
          </label>
        )}
        {(["primary-database", "read-replica"] as ComponentType[]).includes(node.type) && (
          <label>
            Connection limit
            <input
              aria-label="Database connection limit"
              type="number"
              min="1"
              value={node.config.connectionLimit}
              onChange={(event) => onConfigure({ connectionLimit: Number(event.target.value) })}
            />
          </label>
        )}
        {routes.map(({ edge, label }) => (
          <label key={edge.id}>
            Route to {label} %
            <input
              aria-label={`Route to ${label} percent`}
              type="number"
              min="1"
              max="100"
              value={edge.weight}
              onChange={(event) => onRouteWeight(edge.id, Number(event.target.value))}
            />
          </label>
        ))}
      </div>
      <button className="inspector-primary" type="button" onClick={onReplica}>
        <Plus /> Deploy replica <span>$1.8k</span>
      </button>
      <button
        className={connecting ? "inspector-route active" : "inspector-route"}
        type="button"
        onClick={onConnect}
      >
        <Cable /> {connecting ? "Choose destination…" : "Connect traffic route"}
      </button>
      {node.type !== "client" && (
        <button className="inspector-remove" type="button" onClick={onRemove}>
          <Trash2 /> Demolish building
        </button>
      )}
    </aside>
  );
}

function EventTicker({ game, snapshot }: { game: TycoonState; snapshot?: Snapshot }) {
  return (
    <div className="event-ticker" aria-label="Live park events">
      <span className="ticker-live">
        <i /> LIVE
      </span>
      <strong>{formatClock(game.second)}</strong>
      <span>{game.eventLog[0]}</span>
      {snapshot && (
        <span className={`ticker-health ${snapshot.systemHealth}`}>
          System {snapshot.systemHealth}
        </span>
      )}
    </div>
  );
}

function AdvisorDialog({ lesson, onClose }: { lesson: AdvisorLesson; onClose: () => void }) {
  return (
    <div className="game-overlay">
      <section
        className="advisor-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="advisor-title"
      >
        <div className="advisor-character" aria-hidden="true">
          <span>!</span>
          <Users />
        </div>
        <div className="advisor-copy">
          <span className="advisor-label">Mina · Systems coach</span>
          <h2 id="advisor-title">{lesson.title}</h2>
          <p>{lesson.message}</p>
          <div className="advisor-detail">
            <BookOpen />
            {lesson.detail}
          </div>
          <button type="button" onClick={onClose}>
            Got it — show me the park
          </button>
        </div>
      </section>
    </div>
  );
}

function Journal({ progress, onClose }: { progress: GameProgress; onClose: () => void }) {
  const lessons = campaignChapters
    .flatMap((chapter) => chapter.lessons)
    .filter((lesson) => progress.encounteredConcepts.includes(lesson.concept));
  return (
    <div className="game-overlay">
      <section className="journal" role="dialog" aria-modal="true" aria-labelledby="journal-title">
        <button type="button" onClick={onClose} aria-label="Close journal">
          <X />
        </button>
        <span className="journal-label">Field notes</span>
        <h2 id="journal-title">System design journal</h2>
        {lessons.length ? (
          lessons.map((lesson) => (
            <article key={lesson.concept}>
              <span>{lesson.concept}</span>
              <h3>{lesson.title}</h3>
              <p>{lesson.detail}</p>
            </article>
          ))
        ) : (
          <div className="journal-empty">
            <BookOpen />
            <p>Lessons appear here after you encounter them in the park.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function OutcomeDialog({
  completed,
  failure,
  game,
  snapshot,
  score,
  onMenu,
  onRetry,
}: {
  completed: boolean;
  failure: ReturnType<typeof explainFailure>;
  game: TycoonState;
  snapshot?: Snapshot;
  score: ReturnType<typeof scoreChallenge> | null;
  onMenu: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="game-overlay">
      <section
        className={`outcome-dialog ${completed ? "won" : "lost"}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="outcome-title"
      >
        <span className="outcome-icon">{completed ? "★" : "!"}</span>
        <span className="outcome-label">{completed ? "Chapter complete" : "Park frozen"}</span>
        <h2 id="outcome-title">
          {completed ? "The crowd made it through." : "Traffic overwhelmed the park."}
        </h2>
        <p>
          {completed
            ? "You balanced growth, reliability, and cost long enough to unlock the next chapter."
            : (failure?.cause ?? "The service crossed a critical business limit.")}
        </p>
        <div className="outcome-stats">
          <span>
            <Users />
            {game.activeUsers.toLocaleString()} users
          </span>
          <span>
            <Gauge />
            {snapshot ? `${(snapshot.availability * 100).toFixed(2)}%` : "—"}
          </span>
          <span>
            <CircleDollarSign />
            {formatMoney(game.cash)}
          </span>
        </div>
        {score && (
          <div className="score-summary">
            <b>{score.total.toLocaleString()} / 1,000</b>
            <span>
              {score.factors.map((factor) => `${factor.label} ${factor.earned}`).join(" · ")}
            </span>
          </div>
        )}
        {failure && (
          <div className="causal-chain">
            <b>First bottleneck</b>
            <span>{failure.queueGrowth.toLocaleString()} requests joined the queue</span>
            <span>Latency climbed by {failure.propagatedLatencyMs}ms</span>
          </div>
        )}
        <div className="outcome-actions">
          <button type="button" onClick={onRetry}>
            <RotateCcw /> Retry checkpoint
          </button>
          <button type="button" onClick={onMenu}>
            Campaign map
          </button>
        </div>
      </section>
    </div>
  );
}

function architectureForChapter(chapter: CampaignChapter): Architecture {
  const base = starterArchitecture();
  const allowed = new Set(chapter.unlocked);
  const nodes = base.nodes.filter((node) => allowed.has(node.type));
  const ids = new Set(nodes.map((node) => node.id));
  let edges = base.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  const client = nodes.find((node) => node.type === "client");
  const api = nodes.find((node) => node.type === "api-server");
  if (client && api && !edges.some((edge) => edge.source === client.id))
    edges = [{ id: crypto.randomUUID(), source: client.id, target: api.id, weight: 100 }, ...edges];
  return { ...base, name: `${chapter.name} park`, nodes, edges };
}

function shouldTeach(lesson: AdvisorLesson, snapshot: Snapshot) {
  if (lesson.concept === "queue") return snapshot.queued > 0;
  if (lesson.concept === "scaling") return snapshot.systemHealth === "saturated";
  if (lesson.concept === "cache") return snapshot.originLoad > 5_000;
  if (lesson.concept === "backpressure")
    return snapshot.retryAttempts > 0 || snapshot.databaseQueue > 0;
  if (lesson.concept === "regions") return snapshot.networkLatencyMs > 10;
  return false;
}

function routePath(source: ArchitectureNode, target: ArchitectureNode) {
  const startX = source.x + 54;
  const startY = source.y + 48;
  const endX = target.x + 54;
  const endY = target.y + 48;
  const middleX = startX + (endX - startX) / 2;
  return `M ${startX} ${startY} C ${middleX} ${startY}, ${middleX} ${endY}, ${endX} ${endY}`;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
    notation: Math.abs(value) >= 10_000 ? "compact" : "standard",
  }).format(value);
}

function formatClock(second: number) {
  return `${String(Math.floor(second / 60)).padStart(2, "0")}:${String(second % 60).padStart(2, "0")}`;
}
