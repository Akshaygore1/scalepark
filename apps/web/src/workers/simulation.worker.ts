import {
  createSimulationSession,
  queueSimulationCommands,
  stepSimulation,
  type Scenario,
  type SimulationCommand,
  type SimulationSession,
} from "@/lib/simulation";
import type { Architecture } from "@/lib/architecture";

export type SimulationWorkerCommand =
  | {
      type: "start";
      architecture: Architecture;
      scenario?: Scenario;
      commands?: SimulationCommand[];
      seed?: number;
    }
  | { type: "advance" }
  | { type: "apply-command"; commands: SimulationCommand[] }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "reset" };

let session: SimulationSession | null = null;
let paused = true;

self.onmessage = (event: MessageEvent<SimulationWorkerCommand>) => {
  try {
    if (event.data.type === "start") {
      session = createSimulationSession(event.data);
      paused = false;
      self.postMessage({ type: "started" });
      return;
    }
    if (event.data.type === "reset") {
      session = null;
      paused = true;
      self.postMessage({ type: "reset" });
      return;
    }
    if (event.data.type === "pause") {
      paused = true;
      self.postMessage({ type: "paused" });
      return;
    }
    if (event.data.type === "resume") {
      paused = false;
      self.postMessage({ type: "resumed" });
      return;
    }
    if (!session || (paused && event.data.type === "advance")) return;
    if (event.data.type === "apply-command") {
      session = queueSimulationCommands(session, event.data.commands);
      self.postMessage({ type: "commands-accepted" });
      return;
    }
    const step = stepSimulation(session, []);
    session = step.session;
    if (step.snapshot) self.postMessage({ type: "snapshot", snapshot: step.snapshot });
    if (step.events.length) self.postMessage({ type: "events", events: step.events });
    for (const simulationEvent of step.events.filter(
      (item) => item.type === "deployment-applied" || item.type === "capacity-removed",
    )) {
      self.postMessage({ type: "deployment-complete", event: simulationEvent });
    }
    if (step.snapshot?.systemHealth === "failed") {
      self.postMessage({ type: "failure", snapshot: step.snapshot, result: session.result });
    } else if (step.complete) {
      self.postMessage({ type: "chapter-complete", result: session.result });
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "Simulation worker failed.",
    });
  }
};
