import type { Architecture, Region } from "./architecture";
import type { Scenario, ScenarioIncident, SimulationCommand } from "./simulation";

export type LearningPhase = "idle" | "running" | "paused" | "completed";

export type LearningState = {
  phase: LearningPhase;
  second: number;
  durationSeconds: number;
  baseArchitecture?: Architecture;
  commands: SimulationCommand[];
  incidents: ScenarioIncident[];
};

type LearningDeploymentCommand =
  | Omit<Extract<SimulationCommand, { type: "configure" }>, "atSecond">
  | Omit<Extract<SimulationCommand, { type: "capacity" }>, "atSecond">;

export type LearningAction =
  | { type: "start"; architecture: Architecture }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "reset" }
  | { type: "tick" }
  | { type: "step" }
  | { type: "traffic"; rps: number }
  | { type: "incident"; incident: Omit<ScenarioIncident, "atSecond"> }
  | { type: "deployment"; command: LearningDeploymentCommand };

export const initialLearningState: LearningState = {
  phase: "idle",
  second: 0,
  durationSeconds: 120,
  commands: [],
  incidents: [],
};

export function reduceLearningState(
  state: LearningState,
  action: LearningAction,
): LearningState {
  if (action.type === "start") {
    return {
      ...initialLearningState,
      phase: "running",
      baseArchitecture: structuredClone(action.architecture),
    };
  }
  if (action.type === "reset") return initialLearningState;
  if (action.type === "pause" && state.phase === "running") {
    return { ...state, phase: "paused" };
  }
  if (action.type === "resume" && state.phase === "paused") {
    return { ...state, phase: "running" };
  }
  if (action.type === "tick" && state.phase === "running") return advance(state);
  if (action.type === "step" && state.phase === "paused") return advance(state, "paused");
  if (action.type === "traffic" && state.phase !== "idle") {
    return {
      ...state,
      commands: [
        ...state.commands,
        { atSecond: state.second, type: "traffic", rps: Math.max(0, action.rps) },
      ],
    };
  }
  if (action.type === "incident" && state.phase !== "idle") {
    return {
      ...state,
      incidents: [...state.incidents, { ...action.incident, atSecond: state.second }],
    };
  }
  if (action.type === "deployment" && state.phase !== "idle") {
    return {
      ...state,
      commands: [...state.commands, { ...action.command, atSecond: state.second }],
    };
  }
  return state;
}

export function learningScenario(state: LearningState): Scenario {
  return {
    version: 1,
    durationSeconds: state.durationSeconds,
    normalRps: 500,
    spikeRps: 500,
    spikeAtSecond: state.durationSeconds + 1,
    availabilityTarget: 0,
    p95TargetMs: 10_000_000,
    throughputTarget: 0,
    costCeiling: 1_000_000,
    observeRecovery: true,
    incidents: state.incidents,
  };
}

export function regionalLearningIncident(region: Region): Omit<ScenarioIncident, "atSecond"> {
  return { type: "regional-latency", region, durationSeconds: 4 };
}

function advance(state: LearningState, phase: LearningPhase = "running"): LearningState {
  const second = Math.min(state.durationSeconds - 1, state.second + 1);
  return {
    ...state,
    second,
    phase: second === state.durationSeconds - 1 ? "completed" : phase,
  };
}
