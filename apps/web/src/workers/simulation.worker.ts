import { runSimulation, type Scenario, type SimulationCommand } from "@/lib/simulation";
import type { Architecture } from "@/lib/architecture";

self.onmessage = (
  event: MessageEvent<{
    architecture: Architecture;
    scenario?: Scenario;
    commands?: SimulationCommand[];
    seed?: number;
  }>,
) => {
  const { architecture, scenario, commands, seed } = event.data;
  const result = runSimulation(architecture, scenario, commands, seed);
  result.snapshots.forEach((snapshot, index) =>
    setTimeout(() => self.postMessage({ type: "snapshot", snapshot }), index * 80),
  );
  setTimeout(() => self.postMessage({ type: "complete", result }), result.snapshots.length * 80);
};
