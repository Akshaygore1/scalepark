import type { Architecture } from "./model";
import { runServiceSimulation, validateServices, type ServiceScenario } from "./services";
import { runSimulation, type Scenario, type SimulationResult } from "./simulation";
import { validatePark, type ValidationSummary } from "./topology";

/** Part 1 parks run on the single-path engine; parks of services run on the service engine. */
export function runScenario(architecture: Architecture, scenario: Scenario | ServiceScenario): SimulationResult {
  return "kind" in scenario ? runServiceSimulation(architecture, scenario) : runSimulation(architecture, scenario);
}

export function validateFor(architecture: Architecture, scenario: Scenario | ServiceScenario): ValidationSummary {
  return "kind" in scenario ? validateServices(architecture, scenario) : validatePark(architecture);
}
