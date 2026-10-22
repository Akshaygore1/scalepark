import type { SimLevel } from "@/lib/curriculum";
import type { Outcome } from "@/lib/evaluate";
import type { Architecture, NodeType } from "@/lib/model";
import type { Scenario, SimulationResult } from "@/lib/simulation";

export type Dialog =
  | { kind: "refresher"; step: number }
  | { kind: "before-quiz" }
  | { kind: "prediction" }
  | { kind: "outcome" }
  | { kind: "review" }
  | { kind: "journal" }
  | { kind: "after-quiz" };

export type Run = {
  result: SimulationResult;
  architecture: Architecture;
  outcome: Outcome;
  second: number;
  /** The capstone's design-review questions have been answered for this run. */
  reviewed?: boolean;
};

export type Phase = "planning" | "running" | "paused" | "finished";
export type Speed = 1 | 2 | 4;
export type Prediction = NodeType | "none";

export type GameState = {
  architecture: Architecture;
  scenario: Scenario;
  selectedId: string | null;
  connectionSource: string | null;
  phase: Phase;
  run: Run | null;
  speed: Speed;
  dialogs: Dialog[];
  hintsShown: number;
  hintOpen: boolean;
  prediction: Prediction | null;
  attempts: number;
  notice: string;
};

export type GameAction =
  | { type: "edit"; architecture: Architecture; notice?: string }
  | { type: "move"; nodeId: string; x: number; y: number }
  | { type: "select"; nodeId: string | null }
  | { type: "connection-source"; nodeId: string | null; notice?: string }
  | { type: "start-run"; run: Run }
  | { type: "tick" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "stop" }
  | { type: "seek"; second: number }
  | { type: "speed"; speed: Speed }
  | { type: "update-outcome"; outcome: Outcome }
  | { type: "open"; dialog: Dialog }
  | { type: "replace"; dialog: Dialog }
  | { type: "close" }
  | { type: "hint" }
  | { type: "toggle-hint" }
  | { type: "predict"; prediction: Prediction }
  | { type: "notice"; notice: string }
  | { type: "scenario"; scenario: Scenario };

export function initialGameState(
  level: SimLevel,
  architecture: Architecture,
  options: { completed: boolean },
): GameState {
  const dialogs: Dialog[] = [];
  if (level.refresher.length > 0) dialogs.push({ kind: "refresher", step: 0 });
  if (level.before && !options.completed) dialogs.push({ kind: "before-quiz" });
  return {
    architecture,
    scenario: level.scenario,
    selectedId: null,
    connectionSource: null,
    phase: "planning",
    run: null,
    speed: 1,
    dialogs,
    hintsShown: 0,
    hintOpen: false,
    prediction: null,
    attempts: 0,
    notice:
      level.id === "sandbox"
        ? "Build anything, set traffic in the lab, then press play."
        : "Plan your park, then press play to send traffic.",
  };
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "edit":
      return {
        ...state,
        architecture: action.architecture,
        phase: "planning",
        notice: action.notice ?? state.notice,
      };
    case "move":
      return {
        ...state,
        architecture: {
          ...state.architecture,
          nodes: state.architecture.nodes.map((node) =>
            node.id === action.nodeId ? { ...node, x: action.x, y: action.y } : node,
          ),
        },
      };
    case "select":
      return { ...state, selectedId: action.nodeId, connectionSource: null };
    case "connection-source":
      return {
        ...state,
        connectionSource: action.nodeId,
        selectedId: action.nodeId ?? state.selectedId,
        notice: action.notice ?? state.notice,
      };
    case "start-run":
      return {
        ...state,
        run: action.run,
        phase: "running",
        attempts: state.attempts + 1,
        connectionSource: null,
        notice: "Traffic is flowing. Watch for the first building to struggle.",
      };
    case "tick": {
      if (!state.run || state.phase !== "running") return state;
      const last = state.run.result.snapshots.length - 1;
      const second = Math.min(last, state.run.second + 1);
      const finished = second >= last;
      return {
        ...state,
        run: { ...state.run, second },
        phase: finished ? "finished" : "running",
        dialogs: finished ? [...state.dialogs, { kind: "outcome" }] : state.dialogs,
        notice: finished ? "Run finished. Review it, or change the park and run again." : state.notice,
      };
    }
    case "pause":
      return state.phase === "running" ? { ...state, phase: "paused" } : state;
    case "resume":
      return state.phase === "paused" ? { ...state, phase: "running" } : state;
    case "stop":
      return { ...state, phase: "planning", notice: "Run stopped. Adjust the park and try again." };
    case "seek":
      return state.run ? { ...state, run: { ...state.run, second: action.second } } : state;
    case "speed":
      return { ...state, speed: action.speed };
    case "update-outcome":
      return state.run ? { ...state, run: { ...state.run, outcome: action.outcome, reviewed: true } } : state;
    case "open":
      return { ...state, dialogs: [action.dialog, ...state.dialogs], hintOpen: false };
    case "replace":
      return { ...state, dialogs: [action.dialog, ...state.dialogs.slice(1)] };
    case "close":
      return { ...state, dialogs: state.dialogs.slice(1) };
    case "hint":
      return { ...state, hintsShown: Math.min(3, state.hintsShown + 1), hintOpen: true };
    case "toggle-hint":
      return { ...state, hintOpen: !state.hintOpen };
    case "predict":
      return { ...state, prediction: action.prediction };
    case "notice":
      return { ...state, notice: action.notice };
    case "scenario":
      return { ...state, scenario: action.scenario, phase: "planning" };
  }
}
