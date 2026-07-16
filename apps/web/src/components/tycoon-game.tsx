import {
  Activity,
  ArrowRight,
  Banknote,
  BookOpen,
  Boxes,
  Cable,
  CircleDollarSign,
  CircleCheck,
  CircleDashed,
  Cloud,
  Database,
  Download,
  Ellipsis,
  Gauge,
  Globe2,
  HardDrive,
  Heart,
  Minus,
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
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@infraplay/ui/components/dropdown-menu";

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
  CAMPAIGN_SIMULATION_SEED,
  campaignParkForChapter,
  campaignChapters,
  chapterById,
  completeCampaignChapter,
  createTycoonState,
  demandForReputation,
  evaluateChapterGuidance,
  gameLevelById,
  initialArchitecture,
  isGameLevelUnlocked,
  restoreGameProgress,
  sandboxChapter,
  saveGameProgress,
  type AdvisorLesson,
  type CampaignChapter,
  type GameMode,
  type GameProgress,
  type GameSpeed,
  type TycoonState,
  validateChapterStartingState,
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
type PendingDisconnection = { edgeId: string; readyAt: number };
type PendingRemoval = { nodeId: string; readyAt: number };
type Checkpoint = { architecture: Architecture; game: TycoonState };
type GameWorkerEvent =
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "events"; events: SimulationEvent[] }
  | { type: "deployment-complete"; event: SimulationEvent }
  | {
      type: "topology-complete";
      commands: Array<Exclude<SimulationCommand, { type: "traffic" | "configure" | "capacity" }>>;
    }
  | { type: "failure" | "chapter-complete"; result: SimulationResult }
  | { type: "error"; message: string }
  | { type: "started" | "paused" | "resumed" | "reset" | "commands-accepted" };
const REPLICA_DEPLOYMENT_COST = 1_800;

const buildingMeta: Record<
  ComponentType,
  { name: string; short: string; icon: typeof Server; color: string }
> = {
  client: { name: "Clients", short: "Clients", icon: Users, color: "mint" },
  cdn: { name: "DNS / CDN", short: "DNS / CDN", icon: Globe2, color: "sky" },
  "load-balancer": {
    name: "Load balancer",
    short: "Balancer",
    icon: Network,
    color: "violet",
  },
  "api-server": {
    name: "API server",
    short: "API server",
    icon: Server,
    color: "coral",
  },
  cache: { name: "Cache", short: "Cache", icon: Zap, color: "yellow" },
  "primary-database": {
    name: "Primary database",
    short: "Primary DB",
    icon: Database,
    color: "blue",
  },
  "read-replica": {
    name: "Read replica",
    short: "Read replica",
    icon: HardDrive,
    color: "indigo",
  },
  queue: { name: "Queue", short: "Queue", icon: Boxes, color: "orange" },
  worker: { name: "Worker", short: "Worker", icon: TimerReset, color: "green" },
};

export function TycoonGame({ levelId }: { levelId?: string }) {
  const navigate = useNavigate();
  const [progress, setProgress] = useState<GameProgress>(() =>
    restoreGameProgress(window.localStorage),
  );
  const [activeLevelId, setActiveLevelId] = useState<string | null>(null);
  const [game, setGame] = useState<TycoonState>(() => createTycoonState("campaign"));
  const [architecture, setArchitecture] = useState<Architecture>(() => starterArchitecture());
  const [selectedId, setSelectedId] = useState<string>("");
  const [connectionSource, setConnectionSource] = useState<string | null>(null);
  const [pendingBuilds, setPendingBuilds] = useState<PendingBuild[]>([]);
  const [pendingRoutes, setPendingRoutes] = useState<PendingRoute[]>([]);
  const [pendingDisconnections, setPendingDisconnections] = useState<PendingDisconnection[]>([]);
  const [pendingRemovals, setPendingRemovals] = useState<PendingRemoval[]>([]);
  const [advisor, setAdvisor] = useState<AdvisorLesson | null>(null);
  const [journalOpen, setJournalOpen] = useState(false);
  const [notice, setNotice] = useState("Choose a chapter to open your park.");
  const [attemptHistory, setAttemptHistory] = useState<AttemptHistory>(() =>
    restoreAttemptHistory(window.localStorage),
  );
  const [liveSnapshot, setLiveSnapshot] = useState<Snapshot>();
  const [liveResult, setLiveResult] = useState<SimulationResult>();
  const [completionReward, setCompletionReward] = useState(0);
  const [hasTrafficStarted, setHasTrafficStarted] = useState(false);
  const worker = useRef<Worker | null>(null);
  const checkpoint = useRef<Checkpoint | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const recordedResult = useRef<SimulationResult | null>(null);
  const completionHandled = useRef<string | null>(null);

  const currentChapter = chapterById(game.chapterId);
  const pendingDisconnectionIds = useMemo(
    () => new Set(pendingDisconnections.map((disconnection) => disconnection.edgeId)),
    [pendingDisconnections],
  );
  const previewResult = useMemo(
    () => runSimulation(architecture, currentChapter.scenario, [], CAMPAIGN_SIMULATION_SEED),
    [architecture, currentChapter],
  );
  const snapshot = liveSnapshot ?? previewResult.snapshots[0];
  const selected = architecture.nodes.find((node) => node.id === selectedId);
  const isPlanningPhase = game.mode === "campaign" && !hasTrafficStarted;
  const guidanceArchitecture = useMemo(
    () => ({
      ...architecture,
      nodes: architecture.nodes.map((node) => ({
        ...node,
        config: {
          ...node.config,
          replicas: snapshot?.activeReplicas[node.id] ?? node.config.replicas,
        },
      })),
    }),
    [architecture, snapshot?.activeReplicas],
  );
  const guidance = useMemo(
    () => evaluateChapterGuidance(currentChapter, guidanceArchitecture),
    [currentChapter, guidanceArchitecture],
  );
  const failure = game.phase === "failed" ? explainFailure(liveResult ?? previewResult) : null;
  const score = liveResult ? scoreChallenge(liveResult, architecture) : null;

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
      } else if (data.type === "topology-complete") {
        const disconnectedEdgeIds = data.commands
          .filter(
            (command): command is Extract<SimulationCommand, { type: "disconnect" }> =>
              command.type === "disconnect",
          )
          .map((command) => command.edgeId);
        if (disconnectedEdgeIds.length > 0) {
          setArchitecture((current) => ({
            ...current,
            edges: current.edges.filter((edge) => !disconnectedEdgeIds.includes(edge.id)),
          }));
          setPendingDisconnections((current) =>
            current.filter((disconnection) => !disconnectedEdgeIds.includes(disconnection.edgeId)),
          );
          setNotice("Traffic route disconnected.");
        }
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
    const readyDisconnections = pendingDisconnections.filter(
      (disconnection) => disconnection.readyAt <= game.second,
    );
    const readyRemovals = pendingRemovals.filter((removal) => removal.readyAt <= game.second);
    if (readyRoutes.length === 0 && readyDisconnections.length === 0 && readyRemovals.length === 0)
      return;
    setArchitecture((current) => ({
      ...current,
      nodes: current.nodes.filter(
        (node) => !readyRemovals.some((removal) => removal.nodeId === node.id),
      ),
      edges: [
        ...current.edges.filter(
          (edge) =>
            !readyDisconnections.some((disconnection) => disconnection.edgeId === edge.id) &&
            !readyRemovals.some(
              (removal) => edge.source === removal.nodeId || edge.target === removal.nodeId,
            ),
        ),
        ...readyRoutes.map((route) => route.edge),
      ],
    }));
    setPendingRoutes((current) => current.filter((route) => route.readyAt > game.second));
    setPendingDisconnections((current) =>
      current.filter((disconnection) => disconnection.readyAt > game.second),
    );
    setPendingRemovals((current) => current.filter((removal) => removal.readyAt > game.second));
  }, [game.second, pendingDisconnections, pendingRemovals, pendingRoutes]);

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
    if (
      game.phase !== "completed" ||
      game.mode !== "campaign" ||
      completionHandled.current === game.chapterId
    ) {
      return;
    }
    completionHandled.current = game.chapterId;
    const completion = completeCampaignChapter(progress, currentChapter, {
      architecture: structuredClone(architecture),
      cash: game.cash,
      reputation: game.reputation,
      revenue: game.revenue,
      operatingCost: game.operatingCost,
    });
    const { reward } = completion;
    setCompletionReward(reward);
    const next = completion.progress;
    saveGameProgress(window.localStorage, next);
    setProgress(next);
    if (reward > 0) {
      setGame((currentGame) => ({
        ...currentGame,
        cash: currentGame.cash + reward,
        eventLog: [
          `${formatMoney(reward)} mission reward added to the treasury.`,
          ...currentGame.eventLog,
        ].slice(0, 8),
      }));
      setNotice(
        `${currentChapter.name} complete — ${formatMoney(reward)} added to your persistent park.`,
      );
    }
  }, [
    architecture,
    currentChapter,
    game.cash,
    game.chapterId,
    game.mode,
    game.operatingCost,
    game.phase,
    game.reputation,
    game.revenue,
    progress,
  ]);

  useLayoutEffect(() => {
    if (game.mode !== "campaign" || !activeLevelId) return;
    setProgress((current) => {
      const next = {
        ...current,
        campaignPark: {
          architecture: structuredClone(architecture),
          cash: game.cash,
          reputation: game.reputation,
          revenue: game.revenue,
          operatingCost: game.operatingCost,
        },
      };
      saveGameProgress(window.localStorage, next);
      return next;
    });
  }, [
    activeLevelId,
    architecture,
    game.cash,
    game.mode,
    game.operatingCost,
    game.reputation,
    game.revenue,
  ]);

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
        seed: CAMPAIGN_SIMULATION_SEED,
      },
    });
    setAttemptHistory((current) => {
      const next = recordAttempt(current ?? restoreAttemptHistory(window.localStorage), attempt);
      saveAttemptHistory(window.localStorage, next);
      return next;
    });
  }, [architecture, game.chapterId, game.phase, liveResult]);

  function startGame(mode: GameMode, chapter: CampaignChapter) {
    if (mode === "campaign" && !validateChapterStartingState(chapter).safe) {
      setNotice("This chapter's starting runway is unsafe. Please reload after it is repaired.");
      return;
    }
    const carriedPark = mode === "campaign" ? campaignParkForChapter(progress, chapter) : null;
    const nextArchitecture =
      mode === "sandbox" ? initialArchitecture(progress) : carriedPark!.architecture;
    const nextGame = {
      ...createTycoonState(mode, chapter.id),
      ...(carriedPark
        ? {
            cash: carriedPark.cash,
            reputation: carriedPark.reputation,
            revenue: carriedPark.revenue,
            operatingCost: carriedPark.operatingCost,
          }
        : {}),
    };
    setArchitecture(nextArchitecture);
    setGame(nextGame);
    checkpoint.current = {
      architecture: structuredClone(nextArchitecture),
      game: structuredClone(nextGame),
    };
    setLiveSnapshot(
      runSimulation(nextArchitecture, chapter.scenario, [], CAMPAIGN_SIMULATION_SEED).snapshots[0],
    );
    setLiveResult(undefined);
    setCompletionReward(0);
    setHasTrafficStarted(false);
    recordedResult.current = null;
    completionHandled.current = null;
    worker.current?.postMessage({
      type: "start",
      architecture: nextArchitecture,
      scenario: chapter.scenario,
      commands: [],
      seed: CAMPAIGN_SIMULATION_SEED,
    });
    setSelectedId(nextArchitecture.nodes[0]?.id ?? "");
    setPendingBuilds([]);
    setPendingRoutes([]);
    setPendingDisconnections([]);
    setPendingRemovals([]);
    setConnectionSource(null);
    setAdvisor(null);
    setNotice(`${chapter.name} loaded. Press play when you are ready for traffic.`);
    setActiveLevelId(chapter.id);
  }

  useEffect(() => {
    if (!levelId || activeLevelId === levelId) return;
    const chapter = gameLevelById(levelId);
    if (!chapter || !isGameLevelUnlocked(levelId, progress)) {
      navigate("/", { replace: true });
      return;
    }
    startGame(levelId === sandboxChapter.id ? "sandbox" : "campaign", chapter);
  }, [activeLevelId, levelId, navigate, progress]);

  function togglePlay() {
    if (game.phase !== "running") setHasTrafficStarted(true);
    worker.current?.postMessage({
      type: game.phase === "running" ? "pause" : "resume",
    });
    setGame((current) => ({
      ...current,
      phase: current.phase === "running" ? "paused" : "running",
      eventLog: [
        current.phase === "running" ? "Park paused." : "Traffic is moving.",
        ...current.eventLog,
      ].slice(0, 8),
    }));
  }

  function build(type: ComponentType, position?: { x: number; y: number }) {
    const cost = buildingCosts[type];
    if (game.cash < cost) {
      setNotice(`You need ${formatMoney(cost)} to build ${buildingMeta[type].name}.`);
      return;
    }
    const node = createNode(type, architecture.nodes.length + pendingBuilds.length);
    node.x = position?.x ?? 320 + ((architecture.nodes.length * 173) % 480);
    node.y = position?.y ?? 120 + ((architecture.nodes.length * 97) % 330);
    node.label = buildingMeta[type].name;
    if (isPlanningPhase) {
      const nextArchitecture = {
        ...architecture,
        nodes: [...architecture.nodes, node],
      };
      syncPlanningArchitecture(
        nextArchitecture,
        `${buildingMeta[type].name} is ready for opening day.`,
      );
      setGame((current) => ({
        ...current,
        cash: current.cash - cost,
        eventLog: [
          `${buildingMeta[type].name} added to the opening plan.`,
          ...current.eventLog,
        ].slice(0, 8),
      }));
      return;
    }
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
      eventLog: [`${buildingMeta[type].name} deployment started.`, ...current.eventLog].slice(0, 8),
    }));
    setNotice(`${buildingMeta[type].name} will be ready in 4 simulated seconds.`);
  }

  function moveNode(nodeId: string, position: { x: number; y: number }) {
    setArchitecture((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === nodeId ? { ...node, x: position.x, y: position.y } : node,
      ),
    }));
  }

  function connectRoute(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    const exists = architecture.edges.some(
      (edge) => edge.source === sourceId && edge.target === targetId,
    );
    if (exists) {
      setNotice("That traffic route is already active.");
      return;
    }
    const target = architecture.nodes.find((node) => node.id === targetId);
    if (!target) return;
    const edge = {
      id: crypto.randomUUID(),
      source: sourceId,
      target: targetId,
      weight: 100,
    };
    if (isPlanningPhase) {
      syncPlanningArchitecture(
        { ...architecture, edges: [...architecture.edges, edge] },
        `Route to ${target.label} added to the opening plan.`,
      );
      return;
    }
    setPendingRoutes((current) => [...current, { edge, readyAt: game.second + 2 }]);
    postCommands([
      {
        atSecond: game.second,
        type: "connect",
        edge,
        deploymentDelaySeconds: 2,
      },
    ]);
    setNotice(`Traffic route to ${target.label} deploys in 2 simulated seconds.`);
  }

  function selectNode(node: ArchitectureNode) {
    if (connectionSource && connectionSource !== node.id) {
      connectRoute(connectionSource, node.id);
      setConnectionSource(null);
    }
    setSelectedId(node.id);
  }

  function addReplica(replicaDelta: number) {
    const deploymentCost = replicaDelta * REPLICA_DEPLOYMENT_COST;
    if (!selected || selected.type === "client" || replicaDelta < 1 || game.cash < deploymentCost)
      return setNotice(
        `You need ${formatMoney(deploymentCost)} to deploy ${replicaDelta} replicas.`,
      );
    if (isPlanningPhase) {
      const nextArchitecture = {
        ...architecture,
        nodes: architecture.nodes.map((node) =>
          node.id === selected.id
            ? {
                ...node,
                config: {
                  ...node.config,
                  replicas: node.config.replicas + replicaDelta,
                },
              }
            : node,
        ),
      };
      syncPlanningArchitecture(
        nextArchitecture,
        `${selected.label} will open with ${selected.config.replicas + replicaDelta} replicas.`,
      );
      setGame((current) => ({
        ...current,
        cash: current.cash - deploymentCost,
        eventLog: [
          `${selected.label} capacity added to the opening plan.`,
          ...current.eventLog,
        ].slice(0, 8),
      }));
      return;
    }
    postCommands([
      {
        atSecond: game.second,
        type: "capacity",
        nodeId: selected.id,
        replicaDelta,
        deploymentDelaySeconds: 3,
      },
    ]);
    setGame((current) => ({
      ...current,
      cash: current.cash - deploymentCost,
      eventLog: [
        `${replicaDelta} ${selected.label} ${replicaDelta === 1 ? "replica starts" : "replicas start"} deployment.`,
        ...current.eventLog,
      ].slice(0, 8),
    }));
    setNotice(
      `${selected.label} gains ${replicaDelta} ${replicaDelta === 1 ? "replica" : "replicas"} in 3 simulated seconds.`,
    );
  }

  function removeSelected() {
    if (!selected || selected.type === "client") return;
    if (isPlanningPhase) {
      syncPlanningArchitecture(
        {
          ...architecture,
          nodes: architecture.nodes.filter((node) => node.id !== selected.id),
          edges: architecture.edges.filter(
            (edge) => edge.source !== selected.id && edge.target !== selected.id,
          ),
        },
        `${selected.label} removed from the opening plan.`,
      );
      setSelectedId("");
      return;
    }
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
    if (isPlanningPhase) {
      syncPlanningArchitecture(
        {
          ...architecture,
          edges: architecture.edges.map((candidate) =>
            candidate.id === edgeId ? updated : candidate,
          ),
        },
        "Routing weight saved to the opening plan.",
      );
      return;
    }
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

  function disconnectRoute(edgeId: string) {
    const edge = architecture.edges.find((candidate) => candidate.id === edgeId);
    if (!edge || pendingDisconnectionIds.has(edgeId)) return;
    if (isPlanningPhase) {
      syncPlanningArchitecture(
        {
          ...architecture,
          edges: architecture.edges.filter((candidate) => candidate.id !== edgeId),
        },
        "Route removed from the opening plan.",
      );
      return;
    }
    setPendingDisconnections((current) => [...current, { edgeId, readyAt: game.second + 2 }]);
    postCommands([
      {
        atSecond: game.second,
        type: "disconnect",
        edgeId,
        deploymentDelaySeconds: 2,
      },
    ]);
    setNotice(
      `Traffic route to ${architecture.nodes.find((node) => node.id === edge.target)?.label ?? "destination"} disconnects in 2 simulated seconds.`,
    );
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
    setPendingDisconnections([]);
    setPendingRemovals([]);
    setLiveSnapshot(
      runSimulation(restoredArchitecture, currentChapter.scenario, [], CAMPAIGN_SIMULATION_SEED)
        .snapshots[0],
    );
    setLiveResult(undefined);
    setHasTrafficStarted(false);
    recordedResult.current = null;
    worker.current?.postMessage({
      type: "start",
      architecture: restoredArchitecture,
      scenario: currentChapter.scenario,
      commands: [],
      seed: CAMPAIGN_SIMULATION_SEED,
    });
    setAdvisor(null);
    setNotice("Checkpoint restored. Adjust the park before traffic resumes.");
  }

  function updateSelectedConfig(changes: SimulationCommand & { type: "configure" }) {
    if (!selected) return;
    if (isPlanningPhase) {
      syncPlanningArchitecture(
        {
          ...architecture,
          nodes: architecture.nodes.map((node) =>
            node.id === selected.id
              ? { ...node, config: { ...node.config, ...changes.changes } }
              : node,
          ),
        },
        `${selected.label} configuration saved to the opening plan.`,
      );
      return;
    }
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

  function syncPlanningArchitecture(nextArchitecture: Architecture, nextNotice: string) {
    setArchitecture(nextArchitecture);
    setLiveSnapshot(
      runSimulation(nextArchitecture, currentChapter.scenario, [], CAMPAIGN_SIMULATION_SEED)
        .snapshots[0],
    );
    worker.current?.postMessage({
      type: "start",
      architecture: nextArchitecture,
      scenario: currentChapter.scenario,
      commands: [],
      seed: CAMPAIGN_SIMULATION_SEED,
    });
    setNotice(nextNotice);
  }

  function downloadArchitecture() {
    const url = URL.createObjectURL(
      new Blob([exportArchitecture(architecture)], {
        type: "application/json",
      }),
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
      setPendingBuilds([]);
      setPendingRoutes([]);
      setPendingDisconnections([]);
      setPendingRemovals([]);
      worker.current?.postMessage({
        type: "start",
        architecture: next,
        scenario: currentChapter.scenario,
        commands: [],
        seed: CAMPAIGN_SIMULATION_SEED,
      });
      setNotice("Imported park loaded and the live session restarted.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The park file could not be imported.");
    }
  }

  if (!levelId) {
    return <GameMenu attemptHistory={attemptHistory} progress={progress} />;
  }

  if (activeLevelId !== levelId) {
    return (
      <main className="game-menu" aria-busy="true">
        <p>Loading park…</p>
      </main>
    );
  }

  return (
    <main className="tycoon-shell">
      <GameHud
        game={game}
        snapshot={snapshot}
        onExit={() => navigate("/")}
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
          {game.mode === "campaign" && (
            <div className="mission-reward">
              <Banknote size={14} />
              <span>Mission reward</span>
              <b>{formatMoney(currentChapter.completionReward)}</b>
            </div>
          )}
          {game.mode === "campaign" && guidance.length > 0 && (
            <div className="mission-readiness" aria-label="Suggested upgrades">
              <div className="mission-readiness-heading">
                <b>Advisor plan</b>
                <span>
                  {guidance.filter((item) => item.complete).length}/{guidance.length}
                </span>
              </div>
              {isPlanningPhase && (
                <p>Upgrade your persistent park before launching this traffic wave.</p>
              )}
              <ul>
                {guidance.map((item) => (
                  <li className={item.complete ? "complete" : ""} key={item.label}>
                    {item.complete ? <CircleCheck /> : <CircleDashed />}
                    <span>{item.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mission-progress">
            <span
              style={{
                width: `${(game.second / currentChapter.scenario.durationSeconds) * 100}%`,
              }}
            />
          </div>
          <small>Next traffic wave at {formatClock(currentChapter.scenario.spikeAtSecond)}</small>
        </aside>

        <BuildDock cash={game.cash} chapter={currentChapter} onBuild={(type) => build(type)} />
        {game.mode === "sandbox" && (
          <SandboxControls onIncident={injectIncident} onTraffic={setSandboxTraffic} />
        )}

        <ParkMap
          architecture={architecture}
          connectionSource={connectionSource}
          pendingBuilds={pendingBuilds}
          pendingDisconnectionIds={pendingDisconnectionIds}
          selectedId={selectedId}
          snapshot={snapshot}
          onBuild={build}
          onDisconnectRoute={disconnectRoute}
          onMove={moveNode}
          onSelect={selectNode}
        />

        {selected && (
          <BuildingInspector
            cash={game.cash}
            destinations={architecture.nodes.filter(
              (node) =>
                node.id !== selected.id &&
                !architecture.edges.some(
                  (edge) => edge.source === selected.id && edge.target === node.id,
                ),
            )}
            node={selected}
            snapshot={snapshot}
            onClose={() => setSelectedId("")}
            onConnectTo={(targetId) => connectRoute(selected.id, targetId)}
            onReplica={addReplica}
            onRemove={removeSelected}
            routes={architecture.edges
              .filter((edge) => edge.source === selected.id)
              .map((edge) => ({
                edge,
                label:
                  architecture.nodes.find((node) => node.id === edge.target)?.label ??
                  "Destination",
                pendingDisconnect: pendingDisconnectionIds.has(edge.id),
              }))}
            onRouteWeight={updateRouteWeight}
            onDisconnectRoute={disconnectRoute}
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
          onContinue={() => {
            setAdvisor(null);
            setNotice("Lesson saved. Adjust the park, then press play when ready.");
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
          onMenu={() => navigate("/")}
          onContinue={
            game.phase === "completed"
              ? () => {
                  const next = campaignChapters.find(
                    (chapter) => chapter.number === currentChapter.number + 1,
                  );
                  navigate(next ? `/game/${next.id}` : "/game/sandbox");
                }
              : undefined
          }
          onRetry={retryCheckpoint}
          reward={completionReward}
        />
      )}
    </main>
  );
}

function GameMenu({
  attemptHistory,
  progress,
}: {
  attemptHistory?: AttemptHistory;
  progress: GameProgress;
}) {
  const nextMission =
    campaignChapters.find((chapter) => !progress.completedChapterIds.includes(chapter.id)) ??
    campaignChapters.at(-1)!;
  const savedPark = progress.campaignPark;
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
        <Link className="menu-primary" to={`/game/${nextMission.id}`}>
          <Play size={18} fill="currentColor" />
          {savedPark ? `Continue · ${nextMission.name}` : "Open the park"}
        </Link>
        <Link className="menu-secondary" to={`/game/${sandboxChapter.id}`}>
          <Boxes size={18} /> Enter sandbox
        </Link>
        {savedPark && (
          <div className="persistent-park-summary" aria-label="Persistent park">
            <span>
              <Banknote />
              <b>{formatMoney(savedPark.cash)}</b>
              treasury
            </span>
            <span>
              <Heart />
              <b>{Math.round(savedPark.reputation)}%</b>
              reputation
            </span>
            <span>
              <Server />
              <b>{savedPark.architecture.nodes.length}</b>
              buildings
            </span>
          </div>
        )}
        {attemptHistory && attemptHistory.attempts.length > 0 && (
          <p className="legacy-score">
            Previous challenge record · best {attemptHistory.bestScore?.toLocaleString()} / 1,000 ·{" "}
            {attemptHistory.attempts.length} saved attempts
          </p>
        )}
      </section>

      <section className="chapter-path" aria-label="Campaign chapters">
        <div className="chapter-path-heading">
          <span>Growth missions</span>
          <small>{progress.completedChapterIds.length} / 5 complete</small>
        </div>
        {campaignChapters.map((chapter) => {
          const unlocked = isGameLevelUnlocked(chapter.id, progress);
          const complete = progress.completedChapterIds.includes(chapter.id);
          return (
            <Link
              className={`chapter-stop ${complete ? "complete" : ""}`}
              aria-disabled={!unlocked}
              key={chapter.id}
              to={unlocked ? `/game/${chapter.id}` : "#"}
              onClick={unlocked ? undefined : (event) => event.preventDefault()}
            >
              <span className="chapter-number">{complete ? "✓" : chapter.number}</span>
              <span>
                <b>{chapter.name}</b>
                <small>
                  {unlocked
                    ? `${chapter.concept} · ${formatMoney(chapter.completionReward)} reward`
                    : "Complete the previous mission"}
                </small>
              </span>
            </Link>
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
          Availability
          <b>{snapshot ? `${(snapshot.availability * 100).toFixed(2)}%` : "—"}</b>
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
              draggable={cash >= buildingCosts[type]}
              key={type}
              type="button"
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "copy";
                event.dataTransfer.setData("application/x-scalelab-component", type);
              }}
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
  pendingDisconnectionIds,
  selectedId,
  snapshot,
  onBuild,
  onDisconnectRoute,
  onMove,
  onSelect,
}: {
  architecture: Architecture;
  connectionSource: string | null;
  pendingBuilds: PendingBuild[];
  pendingDisconnectionIds: ReadonlySet<string>;
  selectedId: string;
  snapshot?: Snapshot;
  onBuild: (type: ComponentType, position?: { x: number; y: number }) => void;
  onDisconnectRoute: (edgeId: string) => void;
  onMove: (nodeId: string, position: { x: number; y: number }) => void;
  onSelect: (node: ArchitectureNode) => void;
}) {
  const [dropActive, setDropActive] = useState(false);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
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
  const selectedPath = paths.find(({ edge }) => edge.id === selectedEdgeId);
  const selectedPathDisconnecting = selectedPath
    ? pendingDisconnectionIds.has(selectedPath.edge.id)
    : false;

  useEffect(() => {
    if (
      selectedEdgeId &&
      !architecture.edges.some(
        (edge) =>
          edge.id === selectedEdgeId &&
          architecture.nodes.some((node) => node.id === edge.source) &&
          architecture.nodes.some((node) => node.id === edge.target),
      )
    )
      setSelectedEdgeId(null);
  }, [architecture.edges, architecture.nodes, selectedEdgeId]);

  useEffect(() => {
    if (!selectedEdgeId) return;
    const dismissSelectedRoute = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedEdgeId(null);
    };
    window.addEventListener("keydown", dismissSelectedRoute);
    return () => window.removeEventListener("keydown", dismissSelectedRoute);
  }, [selectedEdgeId]);

  useEffect(() => {
    if (!selectedEdgeId) return;
    const dismissOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".route-action, .route-hitbox"))
        return;
      setSelectedEdgeId(null);
    };
    window.addEventListener("pointerdown", dismissOnOutsidePointer);
    return () => window.removeEventListener("pointerdown", dismissOnOutsidePointer);
  }, [selectedEdgeId]);

  return (
    <div
      className={`park-map ${dropActive ? "drop-active" : ""}`}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("application/x-scalelab-component")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDropActive(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDropActive(false);
        const type = event.dataTransfer.getData("application/x-scalelab-component");
        if (!Object.hasOwn(buildingMeta, type)) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        onBuild(type as ComponentType, {
          x: Math.max(0, Math.min(bounds.width - 110, event.clientX - bounds.left - 55)),
          y: Math.max(0, Math.min(bounds.height - 118, event.clientY - bounds.top - 59)),
        });
      }}
    >
      <div className="park-hills" aria-hidden="true" />
      <div className="park-road" aria-hidden="true" />
      <div className="park-gate" aria-hidden="true">
        <Users />
        <span>THE INTERNET</span>
      </div>
      <svg className="route-layer" role="group" aria-label="Active traffic routes">
        {paths.map(({ edge, source, target, d }) => {
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
          const selected = selectedEdgeId === edge.id;
          const pendingDisconnect = pendingDisconnectionIds.has(edge.id);
          const accessibleLabel = `Select traffic route from ${source.label} to ${target.label}`;
          return (
            <g key={edge.id}>
              <path
                className={`route-shadow ${selected ? "selected" : ""} ${pendingDisconnect ? "disconnecting" : ""}`}
                d={d}
              />
              <path
                className={`route-line ${allocation?.affected ? "interrupted" : ""} ${selected ? "selected" : ""} ${pendingDisconnect ? "disconnecting" : ""}`}
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
              <path
                className="route-hitbox"
                d={d}
                role="button"
                tabIndex={0}
                aria-label={accessibleLabel}
                aria-pressed={selected}
                onClick={(event) => {
                  event.stopPropagation();
                  setSelectedEdgeId(edge.id);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  setSelectedEdgeId(edge.id);
                }}
              />
            </g>
          );
        })}
      </svg>
      {selectedPath && (
        <div
          className="route-action"
          role="group"
          aria-label={`Traffic route from ${selectedPath.source.label} to ${selectedPath.target.label}`}
          style={routeActionPosition(selectedPath.source, selectedPath.target)}
          onClick={(event) => event.stopPropagation()}
        >
          <span>
            <b>{selectedPath.source.label}</b>
            <i aria-hidden="true">→</i>
            <b>{selectedPath.target.label}</b>
          </span>
          <button
            type="button"
            disabled={selectedPathDisconnecting}
            onClick={() => onDisconnectRoute(selectedPath.edge.id)}
          >
            <Trash2 aria-hidden="true" />
            {selectedPathDisconnecting ? "Disconnecting…" : "Disconnect"}
          </button>
        </div>
      )}
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
          replicas={snapshot?.activeReplicas[node.id] ?? node.config.replicas}
          selected={selectedId === node.id}
          onMove={onMove}
          onClick={() => {
            setSelectedEdgeId(null);
            onSelect(node);
          }}
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
  replicas,
  selected,
  connecting,
  onMove,
  onClick,
}: {
  node: ArchitectureNode;
  health?: string;
  replicas: number;
  selected: boolean;
  connecting: boolean;
  onMove: (nodeId: string, position: { x: number; y: number }) => void;
  onClick: () => void;
}) {
  const item = buildingMeta[node.type];
  const Icon = item.icon;
  const drag = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startNodeX: number;
    startNodeY: number;
    maxX: number;
    maxY: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(false);
  return (
    <button
      className={`park-building ${item.color} health-${health ?? "healthy"} ${selected ? "selected" : ""} ${connecting ? "connecting" : ""} ${dragging ? "dragging" : ""}`}
      style={{ left: node.x, top: node.y }}
      type="button"
      onClick={() => {
        if (suppressClick.current) return;
        onClick();
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
        if (!bounds) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          startNodeX: node.x,
          startNodeY: node.y,
          maxX: Math.max(0, bounds.width - 110),
          maxY: Math.max(0, bounds.height - 118),
          moved: false,
        };
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        const deltaX = event.clientX - current.startClientX;
        const deltaY = event.clientY - current.startClientY;
        if (!current.moved && Math.hypot(deltaX, deltaY) < 4) return;
        current.moved = true;
        setDragging(true);
        onMove(node.id, {
          x: Math.max(0, Math.min(current.maxX, current.startNodeX + deltaX)),
          y: Math.max(0, Math.min(current.maxY, current.startNodeY + deltaY)),
        });
      }}
      onPointerUp={(event) => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        suppressClick.current = current.moved;
        drag.current = null;
        setDragging(false);
        event.currentTarget.releasePointerCapture(event.pointerId);
        window.setTimeout(() => {
          suppressClick.current = false;
        }, 0);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDragging(false);
      }}
      aria-label={`${node.label}, ${health ?? "healthy"}, ${replicas} replicas`}
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
        <small>×{replicas}</small>
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
  cash,
  destinations,
  onClose,
  onConnectTo,
  onReplica,
  onRemove,
  onConfigure,
  routes,
  onRouteWeight,
  onDisconnectRoute,
}: {
  node: ArchitectureNode;
  snapshot?: Snapshot;
  cash: number;
  destinations: ArchitectureNode[];
  onClose: () => void;
  onConnectTo: (targetId: string) => void;
  onReplica: (replicaDelta: number) => void;
  onRemove: () => void;
  onConfigure: (changes: Partial<Omit<ComponentConfig, "replicas">>) => void;
  routes: {
    edge: ArchitectureEdge;
    label: string;
    pendingDisconnect: boolean;
  }[];
  onRouteWeight: (edgeId: string, weight: number) => void;
  onDisconnectRoute: (edgeId: string) => void;
}) {
  const item = buildingMeta[node.type];
  const Icon = item.icon;
  const nodeHealth = snapshot?.nodeHealth[node.id] ?? "healthy";
  const activeReplicas = snapshot?.activeReplicas[node.id] ?? node.config.replicas;
  const [desiredReplicas, setDesiredReplicas] = useState(activeReplicas);
  const [openSection, setOpenSection] = useState<"configuration" | "traffic" | null>(
    "configuration",
  );
  const [actionsOpen, setActionsOpen] = useState(false);
  const [destinationsOpen, setDestinationsOpen] = useState(false);
  useEffect(() => {
    setDesiredReplicas(activeReplicas);
  }, [activeReplicas, node.id]);
  useEffect(() => {
    setOpenSection("configuration");
    setActionsOpen(false);
    setDestinationsOpen(false);
  }, [node.id]);
  const replicaDelta = Math.max(0, desiredReplicas - activeReplicas);
  const replicaCost = replicaDelta * REPLICA_DEPLOYMENT_COST;
  const configurationPanelId = `inspector-configuration-${node.id}`;
  const trafficPanelId = `inspector-traffic-${node.id}`;
  return (
    <aside className="building-inspector" aria-label={`${node.label} controls`}>
      <header className="inspector-header">
        <div className="inspector-header-main">
          <div className={`inspector-avatar ${item.color}`}>
            <Icon />
          </div>
          <div className="inspector-identity">
            <span className="inspector-kicker">{item.name}</span>
            <h2>{node.label}</h2>
            <div className={`inspector-health status-${nodeHealth}`}>
              <Activity />
              <span>{nodeHealth}</span>
            </div>
          </div>
          <button
            className="inspector-close"
            type="button"
            onClick={onClose}
            aria-label="Close building controls"
          >
            <X />
          </button>
        </div>
        <dl className="inspector-overview">
          <div>
            <dt>Replicas</dt>
            <dd>{activeReplicas}</dd>
          </div>
          <div>
            <dt>Capacity</dt>
            <dd>{(node.config.capacity * activeReplicas).toLocaleString()}/sec</dd>
          </div>
          <div>
            <dt>Service time</dt>
            <dd>{node.config.serviceTimeMs} ms</dd>
          </div>
        </dl>
      </header>

      <div className="inspector-scroll">
        <section className="inspector-section inspector-accordion">
          <button
            className="inspector-accordion-trigger"
            type="button"
            aria-expanded={openSection === "configuration"}
            aria-controls={configurationPanelId}
            onClick={() =>
              setOpenSection((current) => (current === "configuration" ? null : "configuration"))
            }
          >
            <span>Configuration</span>
            <Plus aria-hidden="true" />
          </button>
          <div
            className="inspector-accordion-panel"
            id={configurationPanelId}
            hidden={openSection !== "configuration"}
          >
            <div className="inspector-config">
              <label>
                <span>Region</span>
                <select
                  aria-label="Component region"
                  value={node.config.region}
                  onChange={(event) =>
                    onConfigure({
                      region: event.target.value as ComponentConfig["region"],
                    })
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
                    <span>
                      Cache size <small>entries</small>
                    </span>
                    <input
                      aria-label="Cache size"
                      type="number"
                      min="100"
                      value={node.config.cacheSize}
                      onChange={(event) => onConfigure({ cacheSize: Number(event.target.value) })}
                    />
                  </label>
                  <label>
                    <span>
                      TTL <small>sec</small>
                    </span>
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
              {(["load-balancer", "api-server", "worker"] as ComponentType[]).includes(
                node.type,
              ) && (
                <>
                  <label>
                    <span>
                      Timeout <small>ms</small>
                    </span>
                    <input
                      aria-label="Timeout milliseconds"
                      type="number"
                      min="1"
                      value={node.config.timeoutMs}
                      onChange={(event) => onConfigure({ timeoutMs: Number(event.target.value) })}
                    />
                  </label>
                  <label>
                    <span>Retries</span>
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
                    <span>
                      <b>Autoscaling</b>
                      <small>Adjust replicas with demand</small>
                    </span>
                    <input
                      aria-label="Enable autoscaling"
                      type="checkbox"
                      checked={node.config.autoscaling.enabled}
                      onChange={(event) =>
                        onConfigure({
                          autoscaling: {
                            ...node.config.autoscaling,
                            enabled: event.target.checked,
                          },
                        })
                      }
                    />
                  </label>
                </>
              )}
              {node.type === "queue" && (
                <label>
                  <span>
                    Queue capacity <small>requests</small>
                  </span>
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
                  <span>Connection limit</span>
                  <input
                    aria-label="Database connection limit"
                    type="number"
                    min="1"
                    value={node.config.connectionLimit}
                    onChange={(event) =>
                      onConfigure({
                        connectionLimit: Number(event.target.value),
                      })
                    }
                  />
                </label>
              )}
            </div>
          </div>
        </section>

        <section className="inspector-section inspector-accordion inspector-routes">
          <button
            className="inspector-accordion-trigger"
            type="button"
            aria-expanded={openSection === "traffic"}
            aria-controls={trafficPanelId}
            onClick={() => setOpenSection((current) => (current === "traffic" ? null : "traffic"))}
          >
            <span>Traffic routes</span>
            <small>{routes.length}</small>
            <Plus aria-hidden="true" />
          </button>
          <div
            className="inspector-accordion-panel"
            id={trafficPanelId}
            hidden={openSection !== "traffic"}
          >
            {routes.length === 0 ? (
              <p className="inspector-empty">No outbound routes</p>
            ) : (
              <div className="inspector-route-list">
                {routes.map(({ edge, label, pendingDisconnect }) => (
                  <div className="inspector-route-config" key={edge.id}>
                    <div className="inspector-route-destination">
                      <span>Destination</span>
                      <strong title={label}>{label}</strong>
                    </div>
                    <label>
                      <span>
                        Traffic <small>%</small>
                      </span>
                      <input
                        aria-label={`Route to ${label} percent`}
                        type="number"
                        min="1"
                        max="100"
                        value={edge.weight}
                        onChange={(event) => onRouteWeight(edge.id, Number(event.target.value))}
                      />
                    </label>
                    <button
                      type="button"
                      disabled={pendingDisconnect}
                      onClick={() => onDisconnectRoute(edge.id)}
                      aria-label={`${pendingDisconnect ? "Disconnecting" : "Disconnect"} route to ${label}`}
                    >
                      <Trash2 />
                      {pendingDisconnect ? "Disconnecting…" : "Disconnect"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      <footer className="inspector-actions">
        {node.type !== "client" && (
          <div className="replica-planner">
            <div className="replica-target">
              <div>
                <label htmlFor={`desired-replicas-${node.id}`}>Desired replicas</label>
                <span className="replica-running">{activeReplicas} running now</span>
              </div>
              <div className="replica-stepper">
                <button
                  className="replica-stepper-button"
                  type="button"
                  disabled={desiredReplicas <= activeReplicas}
                  onClick={() => setDesiredReplicas(desiredReplicas - 1)}
                  aria-label="Decrease desired replicas"
                >
                  <Minus />
                </button>
                <input
                  id={`desired-replicas-${node.id}`}
                  type="number"
                  min={activeReplicas}
                  max="12"
                  value={desiredReplicas}
                  onChange={(event) =>
                    setDesiredReplicas(
                      Math.max(activeReplicas, Math.min(12, Number(event.target.value))),
                    )
                  }
                />
                <button
                  className="replica-stepper-button"
                  type="button"
                  disabled={desiredReplicas >= 12}
                  onClick={() => setDesiredReplicas(desiredReplicas + 1)}
                  aria-label="Increase desired replicas"
                >
                  <Plus />
                </button>
              </div>
            </div>
            <button
              className="inspector-primary"
              type="button"
              disabled={replicaDelta === 0 || cash < replicaCost}
              onClick={() => onReplica(replicaDelta)}
            >
              <Plus />{" "}
              {replicaDelta > 0
                ? `Deploy ${replicaDelta} ${replicaDelta === 1 ? "replica" : "replicas"}`
                : "Choose a higher target"}
              <span>{replicaDelta ? formatMoney(replicaCost) : "—"}</span>
            </button>
          </div>
        )}
        <DropdownMenu open={actionsOpen} onOpenChange={setActionsOpen}>
          <DropdownMenuTrigger
            render={<button className="inspector-actions-trigger" type="button" />}
          >
            <Ellipsis /> Actions
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="inspector-actions-menu">
            <DropdownMenuSub open={destinationsOpen} onOpenChange={setDestinationsOpen}>
              <DropdownMenuSubTrigger
                className="inspector-menu-item"
                disabled={destinations.length === 0}
              >
                <Cable /> Add traffic route
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="inspector-destination-menu">
                {destinations.map((destination) => (
                  <DropdownMenuItem
                    className="inspector-destination-item"
                    key={destination.id}
                    onClick={() => onConnectTo(destination.id)}
                  >
                    <span>{destination.label}</span>
                    <small>
                      {buildingMeta[destination.type].name} · {destination.config.region}
                    </small>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {node.type !== "client" && (
              <>
                <DropdownMenuSeparator className="inspector-menu-separator" />
                <DropdownMenuItem
                  className="inspector-menu-item"
                  variant="destructive"
                  onClick={onRemove}
                >
                  <Trash2 /> Remove component
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </footer>
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

function AdvisorDialog({ lesson, onContinue }: { lesson: AdvisorLesson; onContinue: () => void }) {
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
          <button type="button" onClick={onContinue}>
            Review park while paused
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
  onContinue,
  onRetry,
  reward,
}: {
  completed: boolean;
  failure: ReturnType<typeof explainFailure>;
  game: TycoonState;
  snapshot?: Snapshot;
  score: ReturnType<typeof scoreChallenge> | null;
  onMenu: () => void;
  onContinue?: () => void;
  onRetry: () => void;
  reward: number;
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
            ? reward > 0
              ? `Your park keeps every building, upgrade, and dollar. ${formatMoney(reward)} has been added for the next mission.`
              : "Your park keeps every building, upgrade, and dollar for the next mission."
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
          {completed && onContinue ? (
            <button type="button" onClick={onContinue}>
              Continue with this park <ArrowRight />
            </button>
          ) : (
            <button type="button" onClick={onRetry}>
              <RotateCcw /> Retry checkpoint
            </button>
          )}
          <button type="button" onClick={onMenu}>
            Campaign map
          </button>
        </div>
      </section>
    </div>
  );
}

function shouldTeach(lesson: AdvisorLesson, snapshot: Snapshot) {
  if (lesson.promptAtSecond !== undefined && snapshot.second >= lesson.promptAtSecond) return true;
  if (lesson.concept === "queue") return snapshot.queued > 0;
  if (lesson.concept === "scaling") return snapshot.systemHealth === "saturated";
  if (lesson.concept === "cache") return snapshot.originLoad > 5_000;
  if (lesson.concept === "backpressure")
    return snapshot.retryAttempts > 0 || snapshot.databaseQueue > 0;
  if (lesson.concept === "regions") return snapshot.networkLatencyMs > 10;
  return false;
}

function routePath(source: ArchitectureNode, target: ArchitectureNode) {
  const { x: startX, y: startY } = routeCenter(source);
  const { x: endX, y: endY } = routeCenter(target);
  const middleX = startX + (endX - startX) / 2;
  return `M ${startX} ${startY} C ${middleX} ${startY}, ${middleX} ${endY}, ${endX} ${endY}`;
}

function routeActionPosition(source: ArchitectureNode, target: ArchitectureNode) {
  const sourceCenter = routeCenter(source);
  const targetCenter = routeCenter(target);
  return {
    left: (sourceCenter.x + targetCenter.x) / 2,
    top: (sourceCenter.y + targetCenter.y) / 2,
  };
}

function routeCenter(node: ArchitectureNode) {
  return { x: node.x + 54, y: node.y + 48 };
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
