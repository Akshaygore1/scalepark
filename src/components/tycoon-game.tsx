import {
  Activity,
  ArrowRight,
  Banknote,
  BookOpen,
  Boxes,
  CircleDollarSign,
  CircleCheck,
  CircleDashed,
  CircleHelp,
  Cloud,
  Database,
  Download,
  Gauge,
  Globe2,
  HardDrive,
  Heart,
  ListChecks,
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
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Link, useNavigate } from "react-router";

import {
  canConnectComponents,
  componentRoles,
  controlsReplicas,
  createNode,
  databaseCapacityLevel,
  databaseUpgrade,
  exportArchitecture,
  importArchitecture,
  starterArchitecture,
  trafficPurposeForConnection,
  trafficPurposeLabel,
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
  type ChapterGuidanceStatus,
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
type CampaignSession = "progression" | "replay";
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
const WORKER_REPLICA_DEPLOYMENT_COST = 1_200;
const DATABASE_UPGRADE_COST = 4_000;

const buildingMeta: Record<
  ComponentType,
  { name: string; short: string; icon: typeof Server; color: string }
> = {
  client: { name: "Clients", short: "Clients", icon: Users, color: "mint" },
  dns: { name: "DNS", short: "DNS", icon: Globe2, color: "mint" },
  cdn: { name: "CDN", short: "CDN", icon: Globe2, color: "sky" },
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
  const [refresherStep, setRefresherStep] = useState<number | null>(null);
  const [advisorHintOpen, setAdvisorHintOpen] = useState(false);
  const [exactStepsOpen, setExactStepsOpen] = useState(false);
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
  const campaignSession = useRef<CampaignSession | null>(null);

  const currentChapter = chapterById(game.chapterId);
  const refresher = refresherStep === null ? null : currentChapter.refresher[refresherStep] ?? null;
  const pendingDisconnectionIds = useMemo(
    () => new Set(pendingDisconnections.map((disconnection) => disconnection.edgeId)),
    [pendingDisconnections],
  );
  const pendingRemovalIds = useMemo(
    () => new Set(pendingRemovals.map((removal) => removal.nodeId)),
    [pendingRemovals],
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
    if (
      game.phase !== "completed" ||
      game.mode !== "campaign" ||
      campaignSession.current !== "progression" ||
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
    if (
      game.mode !== "campaign" ||
      campaignSession.current !== "progression" ||
      !activeLevelId
    ) {
      return;
    }
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
    const carriedPark = mode === "campaign" ? campaignParkForChapter(progress, chapter) : null;
    if (
      mode === "campaign" &&
      !validateChapterStartingState(chapter, carriedPark!.architecture).safe
    ) {
      setNotice("This chapter's starting runway is unsafe. Please reload after it is repaired.");
      return;
    }
    campaignSession.current =
      mode === "campaign"
        ? progress.completedChapterIds.includes(chapter.id)
          ? "replay"
          : "progression"
        : null;
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
    setRefresherStep(mode === "campaign" ? 0 : null);
    setAdvisorHintOpen(false);
    setNotice(
      mode === "campaign"
        ? `Mina has a refresher for ${chapter.name}.`
        : `${chapter.name} loaded. Press play when you are ready for traffic.`,
    );
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
    const source = architecture.nodes.find((node) => node.id === sourceId);
    const target = architecture.nodes.find((node) => node.id === targetId);
    if (!source || !target) return false;
    if (sourceId === targetId) {
      setNotice("A component cannot route traffic to itself.");
      return false;
    }
    if (!canConnectComponents(source.type, target.type)) {
      setNotice(`${source.label} cannot connect to ${target.label}. Choose a valid system path.`);
      return false;
    }
    if (pendingRemovalIds.has(sourceId) || pendingRemovalIds.has(targetId)) {
      setNotice("Wait for the pending component removal before changing its routes.");
      return false;
    }
    const exists = architecture.edges.some(
      (edge) => edge.source === sourceId && edge.target === targetId,
    );
    if (exists) {
      setNotice("That traffic route is already active.");
      return false;
    }
    const pending = pendingRoutes.some(
      ({ edge }) => edge.source === sourceId && edge.target === targetId,
    );
    if (pending) {
      setNotice("That traffic route is already deploying.");
      return false;
    }
    const edge = {
      id: crypto.randomUUID(),
      source: sourceId,
      target: targetId,
      weight: 100,
      purpose: trafficPurposeForConnection(source.type, target.type),
    };
    if (isPlanningPhase) {
      syncPlanningArchitecture(
        { ...architecture, edges: [...architecture.edges, edge] },
        `Route to ${target.label} added to the opening plan.`,
      );
      setSelectedId(target.id);
      setConnectionSource(null);
      return true;
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
    setSelectedId(target.id);
    setConnectionSource(null);
    return true;
  }

  function selectNode(node: ArchitectureNode) {
    if (connectionSource) {
      if (connectionSource === node.id) {
        setConnectionSource(null);
        setNotice("Connection cancelled.");
        return;
      }
      if (connectRoute(connectionSource, node.id)) return;
    }
    setSelectedId(node.id);
  }

  function beginConnection(sourceId: string) {
    if (connectionSource === sourceId) {
      setConnectionSource(null);
      setNotice("Connection cancelled.");
      return;
    }
    const source = architecture.nodes.find((node) => node.id === sourceId);
    if (!source || pendingRemovalIds.has(sourceId)) {
      setNotice("Wait for the pending component removal before changing its routes.");
      return;
    }
    const hasDestination = architecture.nodes.some(
      (node) =>
        node.id !== sourceId &&
        canConnectComponents(source.type, node.type) &&
        !pendingRemovalIds.has(node.id) &&
        !architecture.edges.some(
          (edge) => edge.source === sourceId && edge.target === node.id,
        ) &&
        !pendingRoutes.some(
          ({ edge }) => edge.source === sourceId && edge.target === node.id,
        ),
    );
    if (!hasDestination) {
      setNotice(`No available destinations for ${source.label}.`);
      return;
    }
    setSelectedId(sourceId);
    setConnectionSource(sourceId);
    setNotice(`Choose a destination for ${source.label}. Press Escape to cancel.`);
  }

  function cancelConnection() {
    setConnectionSource(null);
    setNotice("Connection cancelled.");
  }

  function addReplica(replicaDelta: number) {
    if (!selected || !controlsReplicas(selected.type)) return;
    const unitCost = selected.type === "worker" ? WORKER_REPLICA_DEPLOYMENT_COST : REPLICA_DEPLOYMENT_COST;
    const deploymentCost = replicaDelta * unitCost;
    if (replicaDelta < 1 || game.cash < deploymentCost)
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

  function upgradeSelectedDatabase() {
    if (!selected || selected.type !== "primary-database") return;
    const changes = databaseUpgrade(selected);
    if (!changes) return setNotice("Primary database capacity is already at the V1 maximum.");
    if (game.cash < DATABASE_UPGRADE_COST) {
      return setNotice(`You need ${formatMoney(DATABASE_UPGRADE_COST)} to upgrade the database.`);
    }
    updateSelectedConfig({
      atSecond: game.second,
      type: "configure",
      nodeId: selected.id,
      changes,
      deploymentDelaySeconds: 2,
    });
    setGame((current) => ({
      ...current,
      cash: current.cash - DATABASE_UPGRADE_COST,
      eventLog: [`${selected.label} capacity upgrade ordered.`, ...current.eventLog].slice(0, 8),
    }));
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
        guidance={guidance}
        exactStepsOpen={exactStepsOpen}
        onExactSteps={() => {
          setAdvisorHintOpen(false);
          setExactStepsOpen((open) => !open);
        }}
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
          {game.mode === "campaign" && guidance.length > 0 && (
            <div className="advisor-hint">
              <button
                className={`journal-button advisor-hint-button ${advisorHintOpen ? "active" : ""}`}
                type="button"
                aria-label={advisorHintOpen ? "Hide advisor plan" : "Show advisor plan"}
                aria-expanded={advisorHintOpen}
                aria-controls="advisor-hint-popover"
                onClick={() => {
                  setExactStepsOpen(false);
                  setAdvisorHintOpen((open) => !open);
                }}
              >
                <ListChecks />
              </button>
              <section
                className="advisor-hint-popover"
                id="advisor-hint-popover"
                hidden={!advisorHintOpen}
                aria-label="Advisor plan"
              >
                <div className="advisor-hint-heading">
                  <b>Advisor plan</b>
                  <span>{guidance.filter((item) => item.complete).length}/{guidance.length}</span>
                </div>
                {isPlanningPhase && <p>Prepare your park before launching the traffic wave.</p>}
                <ul className="advisor-hint-checklist">
                  {guidance.map((item) => (
                    <li className={item.complete ? "complete" : ""} key={item.label}>
                      {item.complete ? <CircleCheck /> : <CircleDashed />}
                      <span>{item.label}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          )}
          <h1>{currentChapter.name}</h1>
          <div className="mission-objective">
            <ShieldCheck size={17} />
            <span>{currentChapter.objective}</span>
          </div>
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
          pendingRemovalIds={pendingRemovalIds}
          pendingRoutes={pendingRoutes}
          selectedId={selectedId}
          snapshot={snapshot}
          onBuild={build}
          onCancelConnection={cancelConnection}
          onConnect={connectRoute}
          onConnectionSource={beginConnection}
          onDisconnectRoute={disconnectRoute}
          onMove={moveNode}
          onSelect={selectNode}
        />

        {selected && (
          <BuildingInspector
            cash={game.cash}
            chapterNumber={currentChapter.number}
            node={selected}
            snapshot={snapshot}
            onClose={() => setSelectedId("")}
            onReplica={addReplica}
            onUpgradeDatabase={upgradeSelectedDatabase}
            onRemove={removeSelected}
            routes={architecture.edges
              .filter((edge) => edge.source === selected.id)
              .map((edge) => ({
                edge,
                label:
                  architecture.nodes.find((node) => node.id === edge.target)?.label ??
                  "Destination",
                purpose: trafficPurposeLabel(edge.purpose),
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

      {refresher && (
        <AdvisorDialog
          lesson={refresher}
          progress={{ current: refresherStep! + 1, total: currentChapter.refresher.length }}
          actionLabel={
            refresherStep! + 1 === currentChapter.refresher.length
              ? "Start planning"
              : "Next refresher"
          }
          onContinue={() => {
            if (refresherStep! + 1 < currentChapter.refresher.length) {
              setRefresherStep(refresherStep! + 1);
              return;
            }
            setProgress((current) => {
              const next = {
                ...current,
                encounteredConcepts: [
                  ...new Set([
                    ...current.encounteredConcepts,
                    ...currentChapter.lessons.map((lesson) => lesson.concept),
                  ]),
                ],
              };
              saveGameProgress(window.localStorage, next);
              return next;
            });
            setRefresherStep(null);
            setNotice("Refresher complete. Adjust the park, then press play when ready.");
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
  guidance,
  exactStepsOpen,
  onExactSteps,
}: {
  game: TycoonState;
  snapshot?: Snapshot;
  onExit: () => void;
  onJournal: () => void;
  onExport: () => void;
  onImport: () => void;
  onPlay: () => void;
  onSpeed: (speed: GameSpeed) => void;
  guidance: ChapterGuidanceStatus[];
  exactStepsOpen: boolean;
  onExactSteps: () => void;
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
      {game.mode === "campaign" && guidance.length > 0 && (
        <div className="navbar-hint">
          <button
            className={`journal-button advisor-hint-button ${exactStepsOpen ? "active" : ""}`}
            type="button"
            aria-label={exactStepsOpen ? "Hide exact steps" : "Show exact steps"}
            aria-expanded={exactStepsOpen}
            aria-controls="exact-steps-popover"
            onClick={onExactSteps}
          >
            <CircleHelp />
          </button>
          <section
            className="exact-steps-popover"
            id="exact-steps-popover"
            hidden={!exactStepsOpen}
            aria-label="Exact steps"
          >
            <b>Exact steps</b>
            <ul>
              {guidance.map((item) => (
                <li key={item.hint}>{item.hint}</li>
              ))}
            </ul>
          </section>
        </div>
      )}
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
  pendingRemovalIds,
  pendingRoutes,
  selectedId,
  snapshot,
  onBuild,
  onCancelConnection,
  onConnect,
  onConnectionSource,
  onDisconnectRoute,
  onMove,
  onSelect,
}: {
  architecture: Architecture;
  connectionSource: string | null;
  pendingBuilds: PendingBuild[];
  pendingDisconnectionIds: ReadonlySet<string>;
  pendingRemovalIds: ReadonlySet<string>;
  pendingRoutes: PendingRoute[];
  selectedId: string;
  snapshot?: Snapshot;
  onBuild: (type: ComponentType, position?: { x: number; y: number }) => void;
  onCancelConnection: () => void;
  onConnect: (sourceId: string, targetId: string) => boolean;
  onConnectionSource: (sourceId: string) => void;
  onDisconnectRoute: (edgeId: string) => void;
  onMove: (nodeId: string, position: { x: number; y: number }) => void;
  onSelect: (node: ArchitectureNode) => void;
}) {
  const [dropActive, setDropActive] = useState(false);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [connectionGesture, setConnectionGesture] = useState<{
    sourceId: string;
    pointerId: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
    moved: boolean;
    targetId: string | null;
  } | null>(null);
  const connectionGestureRef = useRef(connectionGesture);
  const suppressConnectorClick = useRef<string | null>(null);
  const activeConnectionSource = connectionGesture?.sourceId ?? connectionSource;
  const isEligibleDestination = (sourceId: string, targetId: string) => {
    const source = architecture.nodes.find((node) => node.id === sourceId);
    const target = architecture.nodes.find((node) => node.id === targetId);
    return Boolean(
    source && target &&
    sourceId !== targetId &&
    canConnectComponents(source.type, target.type) &&
    !pendingRemovalIds.has(sourceId) &&
    !pendingRemovalIds.has(targetId) &&
    !architecture.edges.some(
      (edge) => edge.source === sourceId && edge.target === targetId,
    ) &&
    !pendingRoutes.some(
      ({ edge }) => edge.source === sourceId && edge.target === targetId,
    ));
  };
  const hasEligibleDestination = (sourceId: string) =>
    architecture.nodes.some((node) => isEligibleDestination(sourceId, node.id));
  const setGesture = (
    gesture: typeof connectionGesture | ((current: typeof connectionGesture) => typeof connectionGesture),
  ) => {
    setConnectionGesture((current) => {
      const next = typeof gesture === "function" ? gesture(current) : gesture;
      connectionGestureRef.current = next;
      return next;
    });
  };

  function beginConnectorDrag(event: ReactPointerEvent<HTMLButtonElement>, sourceId: string) {
    if (event.button !== 0 || !event.isPrimary || !hasEligibleDestination(sourceId)) return;
    event.preventDefault();
    event.stopPropagation();
    suppressConnectorClick.current = sourceId;
    if (connectionSource === sourceId) {
      onCancelConnection();
      setGesture(null);
      return;
    }
    const map = event.currentTarget.closest(".park-map");
    if (!(map instanceof HTMLElement)) return;
    const bounds = map.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    onConnectionSource(sourceId);
    setGesture({
      sourceId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
      moved: false,
      targetId: null,
    });
  }

  function moveConnector(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = connectionGestureRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const map = event.currentTarget.closest(".park-map");
    if (!(map instanceof HTMLElement)) return;
    const bounds = map.getBoundingClientRect();
    const moved = current.moved || Math.hypot(event.clientX - current.startX, event.clientY - current.startY) >= 4;
    const hovered = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-node-id]");
    const targetId = hovered?.dataset.nodeId ?? null;
    setGesture({
      ...current,
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
      moved,
      targetId: targetId && isEligibleDestination(current.sourceId, targetId) ? targetId : null,
    });
  }

  function finishConnector(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = connectionGestureRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setGesture(null);
    if (!current.moved) return;
    if (current.targetId && isEligibleDestination(current.sourceId, current.targetId)) {
      onConnect(current.sourceId, current.targetId);
    } else {
      onCancelConnection();
    }
  }
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
    if (!connectionSource) return;
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setGesture(null);
      onCancelConnection();
    };
    window.addEventListener("keydown", cancelOnEscape);
    return () => window.removeEventListener("keydown", cancelOnEscape);
  }, [connectionSource, onCancelConnection]);

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
      className={`park-map ${dropActive ? "drop-active" : ""} ${activeConnectionSource ? "choosing-destination" : ""}`}
      onClick={(event) => {
        if (!connectionSource) return;
        if (
          event.target instanceof Element &&
          event.target.closest(".park-building, .route-action, .route-hitbox")
        )
          return;
        setGesture(null);
        onCancelConnection();
      }}
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
        <defs>
          <marker
            id="connection-preview-arrow"
            markerHeight="8"
            markerWidth="8"
            orient="auto"
            refX="7"
            refY="4"
            viewBox="0 0 8 8"
          >
            <path d="M0 0 8 4 0 8Z" />
          </marker>
        </defs>
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
        {connectionGesture?.moved && (() => {
          const source = architecture.nodes.find((node) => node.id === connectionGesture.sourceId);
          if (!source) return null;
          const target = connectionGesture.targetId
            ? architecture.nodes.find((node) => node.id === connectionGesture.targetId)
            : null;
          const end = target ? routeCenter(target) : { x: connectionGesture.x, y: connectionGesture.y };
          return (
            <path
              className={`connection-preview ${target ? "valid" : ""}`}
              d={routePreviewPath(routeOutput(source), end)}
              markerEnd="url(#connection-preview-arrow)"
            />
          );
        })()}
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
          connecting={activeConnectionSource === node.id}
          connectionEligible={
            Boolean(activeConnectionSource) &&
            isEligibleDestination(activeConnectionSource as string, node.id)
          }
          connectionTarget={connectionGesture?.targetId === node.id}
          connectorDisabled={pendingRemovalIds.has(node.id) || !hasEligibleDestination(node.id)}
          health={snapshot?.nodeHealth[node.id]}
          key={node.id}
          node={node}
          replicas={snapshot?.activeReplicas[node.id] ?? node.config.replicas}
          selected={selectedId === node.id}
          onConnectorClick={() => {
            if (suppressConnectorClick.current === node.id) {
              suppressConnectorClick.current = null;
              return;
            }
            onConnectionSource(node.id);
          }}
          onConnectorPointerCancel={(event) => {
            if (connectionGestureRef.current?.pointerId !== event.pointerId) return;
            setGesture(null);
            onCancelConnection();
          }}
          onConnectorPointerDown={(event) => beginConnectorDrag(event, node.id)}
          onConnectorPointerMove={moveConnector}
          onConnectorPointerUp={finishConnector}
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
  connectionEligible,
  connectionTarget,
  connectorDisabled,
  onConnectorClick,
  onConnectorPointerCancel,
  onConnectorPointerDown,
  onConnectorPointerMove,
  onConnectorPointerUp,
  onMove,
  onClick,
}: {
  node: ArchitectureNode;
  health?: string;
  replicas: number;
  selected: boolean;
  connecting: boolean;
  connectionEligible: boolean;
  connectionTarget: boolean;
  connectorDisabled: boolean;
  onConnectorClick: () => void;
  onConnectorPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onConnectorPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onConnectorPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onConnectorPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
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
    <div
      className={`park-building ${item.color} health-${health ?? "healthy"} ${selected ? "selected" : ""} ${connecting ? "connecting" : ""} ${connectionEligible ? "connection-eligible" : ""} ${connectionTarget ? "connection-target" : ""} ${dragging ? "dragging" : ""}`}
      data-node-id={node.id}
      style={{ left: node.x, top: node.y }}
    >
      <button
        className="building-select"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          if (suppressClick.current) return;
          onClick();
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || !event.isPrimary) return;
          const bounds = event.currentTarget.closest(".park-map")?.getBoundingClientRect();
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
        aria-label={`${node.label}, ${health ?? "healthy"}${controlsReplicas(node.type) ? `, ${replicas} replicas` : ""}`}
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
          {controlsReplicas(node.type) && <small>×{replicas}</small>}
        </span>
        {(health === "heating" || health === "saturated" || health === "failed") && (
          <span className="building-smoke">● ●</span>
        )}
      </button>
      <button
        className="connection-handle"
        type="button"
        aria-label={`Connect from ${node.label}`}
        aria-pressed={connecting}
        disabled={connectorDisabled}
        onClick={(event) => {
          event.stopPropagation();
          onConnectorClick();
        }}
        onPointerCancel={onConnectorPointerCancel}
        onPointerDown={onConnectorPointerDown}
        onPointerMove={onConnectorPointerMove}
        onPointerUp={onConnectorPointerUp}
      >
        <ArrowRight aria-hidden="true" />
      </button>
    </div>
  );
}

function BuildingInspector({
  node,
  snapshot,
  cash,
  chapterNumber,
  onClose,
  onReplica,
  onUpgradeDatabase,
  onRemove,
  onConfigure,
  routes,
  onRouteWeight,
  onDisconnectRoute,
}: {
  node: ArchitectureNode;
  snapshot?: Snapshot;
  cash: number;
  chapterNumber: number;
  onClose: () => void;
  onReplica: (replicaDelta: number) => void;
  onUpgradeDatabase: () => void;
  onRemove: () => void;
  onConfigure: (changes: Partial<Omit<ComponentConfig, "replicas">>) => void;
  routes: {
    edge: ArchitectureEdge;
    label: string;
    purpose: string;
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
  useEffect(() => {
    setDesiredReplicas(activeReplicas);
  }, [activeReplicas, node.id]);
  useEffect(() => {
    setOpenSection("configuration");
  }, [node.id]);
  const replicaDelta = Math.max(0, desiredReplicas - activeReplicas);
  const replicaUnitCost = node.type === "worker" ? WORKER_REPLICA_DEPLOYMENT_COST : REPLICA_DEPLOYMENT_COST;
  const replicaCost = replicaDelta * replicaUnitCost;
  const routedTraffic = snapshot?.routeAllocations
    .filter((route) => route.sourceNodeId === node.id)
    .reduce((total, route) => total + route.offered, 0) ?? 0;
  const primaryMetric = componentPrimaryMetric(node, snapshot, activeReplicas, routedTraffic);
  const canEditCacheTtl = node.type === "cache" && (chapterNumber === 0 || chapterNumber >= 3);
  const canEditRetries = node.type === "api-server" && (chapterNumber === 0 || chapterNumber === 4);
  const canEditRegion = ["load-balancer", "api-server"].includes(node.type) && (chapterNumber === 0 || chapterNumber >= 5);
  const hasConfiguration = canEditCacheTtl || canEditRetries || canEditRegion || node.type === "primary-database";
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
            <dt>{primaryMetric.label}</dt>
            <dd>{primaryMetric.value}</dd>
          </div>
          <div>
            <dt>Health</dt>
            <dd>{nodeHealth}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>{controlsReplicas(node.type) ? `${activeReplicas} running` : "Managed"}</dd>
          </div>
        </dl>
        <p className="inspector-role">{componentRoles[node.type]}</p>
      </header>

      <div className="inspector-scroll">
        {hasConfiguration && <section className="inspector-section inspector-accordion">
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
              {canEditRegion && <label>
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
              </label>}
              {canEditCacheTtl && (
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
              )}
              {canEditRetries && (
                  <label className="inspector-check">
                    <span>
                      <b>Retry failed requests</b>
                      <small>Retries can amplify a slow dependency</small>
                    </span>
                    <input
                      aria-label="Retry failed requests"
                      type="checkbox"
                      checked={node.config.retries > 0}
                      onChange={(event) => onConfigure({ retries: event.target.checked ? 1 : 0 })}
                    />
                  </label>
              )}
              {node.type === "primary-database" && (
                <div className="database-upgrade">
                  <span>Capacity level {databaseCapacityLevel(node)} of 3</span>
                  <button
                    type="button"
                    disabled={!databaseUpgrade(node) || cash < DATABASE_UPGRADE_COST}
                    onClick={onUpgradeDatabase}
                  >
                    Upgrade capacity <b>{formatMoney(DATABASE_UPGRADE_COST)}</b>
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>}

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
                {routes.map(({ edge, label, purpose, pendingDisconnect }) => (
                  <div className="inspector-route-config" key={edge.id}>
                    <div className="inspector-route-destination">
                      <span>Destination</span>
                      <strong title={label}>{label}</strong>
                      <small>{purpose}</small>
                    </div>
                    {node.type === "dns" && (chapterNumber === 0 || chapterNumber >= 5) && <label>
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
                    </label>}
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
        {controlsReplicas(node.type) && (
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
        {node.type !== "client" && (
          <button className="inspector-delete" type="button" onClick={onRemove}>
            <Trash2 /> Delete component
          </button>
        )}
      </footer>
    </aside>
  );
}

function componentPrimaryMetric(
  node: ArchitectureNode,
  snapshot: Snapshot | undefined,
  activeReplicas: number,
  routedTraffic: number,
) {
  if (node.type === "client") return { label: "Requests", value: `${(snapshot?.offered ?? 0).toLocaleString()}/s` };
  if (node.type === "cdn") {
    return { label: "Edge hit", value: `${Math.round((snapshot?.cdnHitRate ?? 0) * 100)}%` };
  }
  if (node.type === "cache") {
    return { label: "Cache hit", value: `${Math.round((snapshot?.cacheHitRate ?? 0) * 100)}%` };
  }
  if (node.type === "primary-database") {
    return { label: "DB load", value: (snapshot?.databaseConnections ?? 0).toLocaleString() };
  }
  if (node.type === "queue") {
    return { label: "Backlog", value: (snapshot?.queueBacklog ?? 0).toLocaleString() };
  }
  if (controlsReplicas(node.type)) {
    return { label: "Utilization", value: `${snapshot?.nodeUtilization[node.id] ?? 0}%` };
  }
  return { label: "Traffic", value: `${routedTraffic.toLocaleString()}/s` };
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

function AdvisorDialog({
  lesson,
  progress,
  actionLabel,
  onContinue,
}: {
  lesson: AdvisorLesson;
  progress?: { current: number; total: number };
  actionLabel: string;
  onContinue: () => void;
}) {
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
          {progress && <span className="advisor-progress">Refresher {progress.current} of {progress.total}</span>}
          <h2 id="advisor-title">{lesson.title}</h2>
          <p>{lesson.message}</p>
          <div className="advisor-detail">
            <BookOpen />
            {lesson.detail}
          </div>
          <button type="button" onClick={onContinue}>
            {actionLabel}
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

function routePath(source: ArchitectureNode, target: ArchitectureNode) {
  const { x: startX, y: startY } = routeCenter(source);
  const { x: endX, y: endY } = routeCenter(target);
  const middleX = startX + (endX - startX) / 2;
  return `M ${startX} ${startY} C ${middleX} ${startY}, ${middleX} ${endY}, ${endX} ${endY}`;
}

function routePreviewPath(start: { x: number; y: number }, end: { x: number; y: number }) {
  const middleX = start.x + (end.x - start.x) / 2;
  return `M ${start.x} ${start.y} C ${middleX} ${start.y}, ${middleX} ${end.y}, ${end.x} ${end.y}`;
}

function routeOutput(node: ArchitectureNode) {
  return { x: node.x + 108, y: node.y + 57 };
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
