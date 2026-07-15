import { Copy, Download, Link2, Play, Plus, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";

import { LearningModePanel } from "./learning-mode-panel";

import {
  componentTypes,
  createNode,
  exportArchitecture,
  importArchitecture,
  restoreArchitecture,
  saveArchitecture,
  starterArchitecture,
  validateArchitecture,
  type Architecture,
  type ArchitectureNode,
  type ComponentType,
  type Region,
} from "@/lib/architecture";
import {
  initialLearningState,
  learningScenario,
  reduceLearningState,
} from "@/lib/learning";
import type { SimulationCommand, SimulationResult, Snapshot } from "@/lib/simulation";
import { explainFailure, runSimulation, starterScenario } from "@/lib/simulation";

const typeNames: Record<ComponentType, string> = {
  client: "Client",
  cdn: "DNS / CDN",
  "load-balancer": "Load balancer",
  "api-server": "API server",
  cache: "Cache",
  "primary-database": "Primary database",
  "read-replica": "Read replica",
  queue: "Queue",
  worker: "Worker",
};

export function ArchitectureEditor() {
  const [architecture, setArchitecture] = useState<Architecture>(() => {
    if (typeof window === "undefined") return starterArchitecture();
    try {
      return restoreArchitecture(window.localStorage) ?? starterArchitecture();
    } catch {
      return starterArchitecture();
    }
  });
  const [selectedId, setSelectedId] = useState(architecture.nodes[0]?.id ?? "");
  const [connectionSource, setConnectionSource] = useState<string | null>(null);
  const [notice, setNotice] = useState("Select a component to inspect it.");
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [liveSnapshot, setLiveSnapshot] = useState<Snapshot | null>(null);
  const [replaySecond, setReplaySecond] = useState<number | null>(null);
  const [regionalIncident, setRegionalIncident] = useState<Region | "none">("none");
  const [learningRegion, setLearningRegion] = useState<Region>("us-east");
  const [runtimeChange, setRuntimeChange] = useState<
    "none" | "add-replica" | "remove-replica" | "double-capacity"
  >("none");
  const [learning, dispatchLearning] = useReducer(reduceLearningState, initialLearningState);
  const selected = architecture.nodes.find((node) => node.id === selectedId);
  const validation = useMemo(() => validateArchitecture(architecture), [architecture]);
  const activeRegions = useMemo(() => routedRegions(architecture), [architecture]);
  const replaySnapshot =
    simulation?.snapshots.find((snapshot) => snapshot.second === replaySecond) ??
    simulation?.snapshots.at(-1);
  const learningResult = useMemo(
    () =>
      learning.baseArchitecture
        ? runSimulation(
            learning.baseArchitecture,
            learningScenario(learning),
            learning.commands,
            1,
          )
        : null,
    [learning],
  );
  const learningSnapshot = learningResult?.snapshots[learning.second];
  const learningTraffic =
    learning.commands
      .filter(
        (command): command is Extract<SimulationCommand, { type: "traffic" }> =>
          command.type === "traffic" && command.atSecond <= learning.second,
      )
      .at(-1)?.rps ?? 500;
  const displayedSnapshot =
    learning.phase !== "idle" ? learningSnapshot : simulation ? replaySnapshot : liveSnapshot;
  const failure = simulation ? explainFailure(simulation) : null;
  const importInput = useRef<HTMLInputElement>(null);
  const worker = useRef<Worker | null>(null);

  useEffect(() => {
    saveArchitecture(window.localStorage, architecture);
  }, [architecture]);

  useEffect(() => {
    worker.current = new Worker(new URL("../workers/simulation.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.current.onmessage = (
      event: MessageEvent<
        { type: "snapshot"; snapshot: Snapshot } | { type: "complete"; result: SimulationResult }
      >,
    ) => {
      if (event.data.type === "snapshot") {
        setLiveSnapshot(event.data.snapshot);
        return;
      }
      setSimulation(event.data.result);
      const observedRecovery = event.data.result.events.some(
        (simulationEvent) => simulationEvent.type === "regional-latency",
      );
      setNotice(
        event.data.result.outcome === "failed"
          ? observedRecovery
            ? "Run captured the regional objective breach and its recovery."
            : "Run frozen at its first objective breach."
          : "Run completed within its objectives.",
      );
    };
    return () => worker.current?.terminate();
  }, []);

  useEffect(() => {
    if (learning.phase !== "running") return;
    const timer = window.setInterval(() => dispatchLearning({ type: "tick" }), 600);
    return () => window.clearInterval(timer);
  }, [learning.phase]);

  useEffect(() => {
    if (!activeRegions.includes(learningRegion) && activeRegions[0]) {
      setLearningRegion(activeRegions[0]);
    }
  }, [activeRegions, learningRegion]);

  function updateNode(id: string, update: (node: ArchitectureNode) => ArchitectureNode) {
    const currentNode = architecture.nodes.find((node) => node.id === id);
    if (!currentNode) return;
    const nextNode = update(currentNode);
    if (learning.phase !== "idle") {
      const replicaDelta = nextNode.config.replicas - currentNode.config.replicas;
      if (replicaDelta !== 0) {
        dispatchLearning({
          type: "deployment",
          command: {
            type: "capacity",
            nodeId: id,
            replicaDelta,
            deploymentDelaySeconds: Math.max(
              1,
              currentNode.config.autoscaling.startupDelaySeconds,
            ),
          },
        });
      }
      const changes = changedRuntimeConfig(currentNode, nextNode);
      if (Object.keys(changes).length > 0) {
        dispatchLearning({
          type: "deployment",
          command: {
            type: "configure",
            nodeId: id,
            changes,
            deploymentDelaySeconds: 2,
          },
        });
      }
    }
    setArchitecture((current) => ({
      ...current,
      nodes: current.nodes.map((node) => (node.id === id ? nextNode : node)),
    }));
  }

  function updateAutoscaling(
    id: string,
    key: Exclude<keyof ArchitectureNode["config"]["autoscaling"], "enabled">,
    value: number,
  ) {
    updateNode(id, (node) => {
      const autoscaling = { ...node.config.autoscaling, [key]: value };
      if (key === "minReplicas" && value > autoscaling.maxReplicas) {
        autoscaling.maxReplicas = value;
      }
      if (key === "maxReplicas" && value < autoscaling.minReplicas) {
        autoscaling.minReplicas = value;
      }
      return { ...node, config: { ...node.config, autoscaling } };
    });
  }

  function addNode(type: ComponentType) {
    const node = createNode(type, architecture.nodes.length);
    setArchitecture((current) => ({ ...current, nodes: [...current.nodes, node] }));
    setSelectedId(node.id);
    setNotice(`${typeNames[type]} added. Drag it into place or connect it to another component.`);
  }

  function selectNode(node: ArchitectureNode) {
    if (connectionSource && connectionSource !== node.id) {
      const alreadyConnected = architecture.edges.some(
        (edge) => edge.source === connectionSource && edge.target === node.id,
      );
      if (!alreadyConnected) {
        setArchitecture((current) => ({
          ...current,
          edges: [
            ...current.edges,
            { id: crypto.randomUUID(), source: connectionSource, target: node.id, weight: 100 },
          ],
        }));
        setNotice(
          "Connection added. Set routing weights in the inspector when this node has multiple paths.",
        );
      }
      setConnectionSource(null);
    }
    setSelectedId(node.id);
  }

  function duplicateSelected() {
    if (!selected) return;
    const copy = {
      ...structuredClone(selected),
      id: crypto.randomUUID(),
      x: selected.x + 35,
      y: selected.y + 35,
    };
    setArchitecture((current) => ({ ...current, nodes: [...current.nodes, copy] }));
    setSelectedId(copy.id);
    setNotice(`${selected.label} duplicated.`);
  }

  function removeSelected() {
    if (!selected) return;
    setArchitecture((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => node.id !== selected.id),
      edges: current.edges.filter(
        (edge) => edge.source !== selected.id && edge.target !== selected.id,
      ),
    }));
    setSelectedId("");
    setNotice("Component removed with its connections.");
  }

  function downloadDesign() {
    const url = URL.createObjectURL(
      new Blob([exportArchitecture(architecture)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "scalelab-architecture.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importDesign(file?: File) {
    if (!file) return;
    try {
      const next = importArchitecture(await file.text());
      setArchitecture(next);
      setSelectedId(next.nodes[0]?.id ?? "");
      setNotice("Imported design replaced the current architecture.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The design could not be imported.");
    }
  }

  function runDesign() {
    if (!validation.runnable) return setNotice(validation.errors[0]);
    if (regionalIncident !== "none" && !activeRegions.includes(regionalIncident)) {
      setRegionalIncident("none");
      return setNotice("Choose a regional incident used by an active request path.");
    }
    setNotice("Running deterministic scenario in the simulation worker…");
    setLiveSnapshot(null);
    setSimulation(null);
    const scenario =
      regionalIncident === "none"
        ? starterScenario
        : {
            ...starterScenario,
            durationSeconds: 10,
            spikeAtSecond: 99,
            observeRecovery: true,
            incidents: [
              {
                atSecond: 5,
                type: "regional-latency" as const,
                region: regionalIncident,
                durationSeconds: 3,
              },
            ],
          };
    const simulationCommands: SimulationCommand[] = [];
    if (runtimeChange !== "none") {
      if (!selected || selected.type === "client") {
        return setNotice("Select a non-client component for the runtime deployment preset.");
      }
      simulationCommands.push(
        runtimeChange === "double-capacity"
          ? {
              atSecond: 3,
              type: "configure",
              nodeId: selected.id,
              changes: { capacity: selected.config.capacity * 2 },
              deploymentDelaySeconds: 2,
            }
          : {
              atSecond: 3,
              type: "capacity",
              nodeId: selected.id,
              replicaDelta: runtimeChange === "add-replica" ? 1 : -1,
              deploymentDelaySeconds: 2,
            },
      );
    }
    worker.current?.postMessage({ architecture, scenario, commands: simulationCommands, seed: 1 });
  }

  return (
    <section className="editor-grid" aria-label="Architecture editor">
      <aside className="workspace-panel component-palette" aria-labelledby="palette-title">
        <div className="panel-heading">
          <p className="eyebrow">Build</p>
          <h2 id="palette-title">Components</h2>
        </div>
        <div className="design-actions">
          <button type="button" onClick={downloadDesign}>
            <Download size={13} /> Export
          </button>
          <button type="button" onClick={() => importInput.current?.click()}>
            <Upload size={13} /> Import
          </button>
          <input
            ref={importInput}
            type="file"
            accept="application/json"
            onChange={(event) => importDesign(event.target.files?.[0])}
          />
        </div>
        <p className="panel-intro">Add supported infrastructure to the canvas.</p>
        <div className="palette-list">
          {componentTypes.map((type) => (
            <button
              className="palette-item"
              key={type}
              type="button"
              disabled={learning.phase !== "idle"}
              onClick={() => addNode(type)}
            >
              {typeNames[type]} <Plus aria-hidden="true" size={15} />
            </button>
          ))}
        </div>
      </aside>

      <section className="architecture-canvas editor-canvas" aria-labelledby="architecture-title">
        <div className="canvas-header">
          <div>
            <p className="eyebrow">Architecture</p>
            <h2 id="architecture-title">Build a request path</h2>
          </div>
          <button
            className="run-button"
            type="button"
            disabled={learning.phase !== "idle"}
            onClick={runDesign}
          >
            <Play aria-hidden="true" size={14} /> Validate & run
          </button>
        </div>
        <div className="editor-stage">
          <svg
            aria-hidden="true"
            className="edge-layer"
            viewBox="0 0 900 480"
            preserveAspectRatio="none"
          >
            {architecture.edges.map((edge) => {
              const source = architecture.nodes.find((node) => node.id === edge.source);
              const target = architecture.nodes.find((node) => node.id === edge.target);
              if (!source || !target) return null;
              return (
                <g key={edge.id}>
                  <line
                    x1={source.x + 72}
                    y1={source.y + 20}
                    x2={target.x + 72}
                    y2={target.y + 20}
                  />
                  <text
                    x={(source.x + target.x) / 2 + 72}
                    y={(source.y + target.y) / 2 + 14}
                  >
                    {edge.weight}%
                  </text>
                </g>
              );
            })}
          </svg>
          {architecture.nodes.map((node) => {
            const health = displayedSnapshot?.nodeHealth[node.id];
            return (
              <button
                className={`editor-node ${selectedId === node.id ? "editor-node-selected" : ""} ${connectionSource === node.id ? "editor-node-connecting" : ""} ${health ? `editor-node-health-${health}` : ""}`}
                key={node.id}
                type="button"
                style={{ left: `${node.x}px`, top: `${node.y}px` }}
                onClick={() => selectNode(node)}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    updateNode(node.id, (current) => ({
                      ...current,
                      x: Math.max(0, current.x + event.movementX),
                      y: Math.max(0, current.y + event.movementY),
                    }));
                  }
                }}
              >
                <span className="editor-node-identity">
                  <span>{node.label}</span>
                  <small>
                    ×{displayedSnapshot?.activeReplicas[node.id] ?? node.config.replicas} ·{" "}
                    {node.config.region}
                  </small>
                </span>
                {health && <strong className="node-health-label">{health}</strong>}
              </button>
            );
          })}
          <p className="canvas-notice" role="status">
            {notice}
          </p>
        </div>
        <div className="canvas-footer">
          <span>
            {architecture.nodes.length} components · {architecture.edges.length} connections
          </span>
          <span className={validation.runnable ? "validation-good" : "validation-bad"}>
            {validation.runnable ? "Structurally runnable" : "Needs attention"}
          </span>
        </div>
      </section>

      <aside className="workspace-panel inspector" aria-labelledby="inspector-title">
        <div className="panel-heading">
          <p className="eyebrow">Inspect</p>
          <h2 id="inspector-title">{selected?.label ?? "No selection"}</h2>
        </div>
        {selected ? (
          <>
            <div className="inspector-actions">
              <button
                type="button"
                disabled={learning.phase !== "idle"}
                onClick={() => setConnectionSource(selected.id)}
              >
                <Link2 size={14} /> Connect
              </button>
              <button
                type="button"
                disabled={learning.phase !== "idle"}
                onClick={duplicateSelected}
              >
                <Copy size={14} /> Duplicate
              </button>
              <button
                type="button"
                disabled={learning.phase !== "idle"}
                onClick={removeSelected}
              >
                <Trash2 size={14} /> Remove
              </button>
            </div>
            <label className="config-field">
              Label
              <input
                value={selected.label}
                onChange={(event) =>
                  updateNode(selected.id, (node) => ({ ...node, label: event.target.value }))
                }
              />
            </label>
            <label className="config-field">
              Replicas
              <input
                type="number"
                min="1"
                value={selected.config.replicas}
                onChange={(event) =>
                  updateNode(selected.id, (node) => ({
                    ...node,
                    config: { ...node.config, replicas: Math.max(1, Number(event.target.value)) },
                  }))
                }
              />
            </label>
            <label className="config-field">
              Capacity / sec
              <input
                type="number"
                min="1"
                value={selected.config.capacity}
                onChange={(event) =>
                  updateNode(selected.id, (node) => ({
                    ...node,
                    config: { ...node.config, capacity: Math.max(1, Number(event.target.value)) },
                  }))
                }
              />
            </label>
            <label className="config-field">
              Service time (ms)
              <input
                type="number"
                min="1"
                value={selected.config.serviceTimeMs}
                onChange={(event) =>
                  updateNode(selected.id, (node) => ({
                    ...node,
                    config: {
                      ...node.config,
                      serviceTimeMs: Math.max(1, Number(event.target.value)),
                    },
                  }))
                }
              />
            </label>
            <label className="config-field">
              Concurrency
              <input
                type="number"
                min="1"
                value={selected.config.concurrency}
                onChange={(event) =>
                  updateNode(selected.id, (node) => ({
                    ...node,
                    config: {
                      ...node.config,
                      concurrency: Math.max(1, Number(event.target.value)),
                    },
                  }))
                }
              />
            </label>
            {(["load-balancer", "api-server", "worker"] as ComponentType[]).includes(
              selected.type,
            ) && (
              <fieldset className="autoscaling-config">
                <legend>Autoscaling policy</legend>
                <label className="config-toggle">
                  <input
                    type="checkbox"
                    checked={selected.config.autoscaling.enabled}
                    onChange={(event) =>
                      updateNode(selected.id, (node) => ({
                        ...node,
                        config: {
                          ...node.config,
                          autoscaling: {
                            ...node.config.autoscaling,
                            enabled: event.target.checked,
                          },
                        },
                      }))
                    }
                  />
                  Enabled
                </label>
                <label className="config-field">
                  Utilization threshold (%)
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={selected.config.autoscaling.threshold}
                    onChange={(event) =>
                      updateAutoscaling(
                        selected.id,
                        "threshold",
                        Math.min(100, Math.max(1, Number(event.target.value))),
                      )
                    }
                  />
                </label>
                <label className="config-field">
                  Minimum replicas
                  <input
                    type="number"
                    min="1"
                    value={selected.config.autoscaling.minReplicas}
                    onChange={(event) =>
                      updateAutoscaling(
                        selected.id,
                        "minReplicas",
                        Math.max(1, Number(event.target.value)),
                      )
                    }
                  />
                </label>
                <label className="config-field">
                  Maximum replicas
                  <input
                    type="number"
                    min="1"
                    value={selected.config.autoscaling.maxReplicas}
                    onChange={(event) =>
                      updateAutoscaling(
                        selected.id,
                        "maxReplicas",
                        Math.max(1, Number(event.target.value)),
                      )
                    }
                  />
                </label>
                <label className="config-field">
                  Startup delay (seconds)
                  <input
                    type="number"
                    min="1"
                    value={selected.config.autoscaling.startupDelaySeconds}
                    onChange={(event) =>
                      updateAutoscaling(
                        selected.id,
                        "startupDelaySeconds",
                        Math.max(1, Number(event.target.value)),
                      )
                    }
                  />
                </label>
                <label className="config-field">
                  Cooldown (seconds)
                  <input
                    type="number"
                    min="0"
                    value={selected.config.autoscaling.cooldownSeconds}
                    onChange={(event) =>
                      updateAutoscaling(
                        selected.id,
                        "cooldownSeconds",
                        Math.max(0, Number(event.target.value)),
                      )
                    }
                  />
                </label>
              </fieldset>
            )}
            {(["load-balancer", "api-server", "worker"] as ComponentType[]).includes(
              selected.type,
            ) && (
              <>
                <label className="config-field">
                  Timeout (ms)
                  <input
                    type="number"
                    min="1"
                    value={selected.config.timeoutMs}
                    onChange={(event) =>
                      updateNode(selected.id, (node) => ({
                        ...node,
                        config: {
                          ...node.config,
                          timeoutMs: Math.max(1, Number(event.target.value)),
                        },
                      }))
                    }
                  />
                </label>
                <label className="config-field">
                  Retry attempts
                  <input
                    type="number"
                    min="0"
                    max="10"
                    value={selected.config.retries}
                    onChange={(event) =>
                      updateNode(selected.id, (node) => ({
                        ...node,
                        config: {
                          ...node.config,
                          retries: Math.min(10, Math.max(0, Number(event.target.value))),
                        },
                      }))
                    }
                  />
                </label>
              </>
            )}
            {(["primary-database", "read-replica"] as ComponentType[]).includes(selected.type) && (
              <label className="config-field">
                Connection limit
                <input
                  type="number"
                  min="1"
                  value={selected.config.connectionLimit}
                  onChange={(event) =>
                    updateNode(selected.id, (node) => ({
                      ...node,
                      config: {
                        ...node.config,
                        connectionLimit: Math.max(1, Number(event.target.value)),
                      },
                    }))
                  }
                />
              </label>
            )}
            {selected.type === "queue" && (
              <label className="config-field">
                Queue capacity
                <input
                  type="number"
                  min="1"
                  value={selected.config.queueCapacity}
                  onChange={(event) =>
                    updateNode(selected.id, (node) => ({
                      ...node,
                      config: {
                        ...node.config,
                        queueCapacity: Math.max(1, Number(event.target.value)),
                      },
                    }))
                  }
                />
              </label>
            )}
            {selected.type === "cache" && (
              <>
                <label className="config-field">
                  Cache size (keys)
                  <input
                    type="number"
                    min="1"
                    value={selected.config.cacheSize}
                    onChange={(event) =>
                      updateNode(selected.id, (node) => ({
                        ...node,
                        config: {
                          ...node.config,
                          cacheSize: Math.max(1, Number(event.target.value)),
                        },
                      }))
                    }
                  />
                </label>
                <label className="config-field">
                  TTL (seconds)
                  <input
                    type="number"
                    min="1"
                    value={selected.config.ttlSeconds}
                    onChange={(event) =>
                      updateNode(selected.id, (node) => ({
                        ...node,
                        config: {
                          ...node.config,
                          ttlSeconds: Math.max(1, Number(event.target.value)),
                        },
                      }))
                    }
                  />
                </label>
              </>
            )}
            <label className="config-field">
              Region
              <select
                value={selected.config.region}
                onChange={(event) =>
                  updateNode(selected.id, (node) => ({
                    ...node,
                    config: {
                      ...node.config,
                      region: event.target.value as ArchitectureNode["config"]["region"],
                    },
                  }))
                }
              >
                <option>us-east</option>
                <option>us-west</option>
                <option>eu-west</option>
                <option>ap-south</option>
              </select>
            </label>
            {architecture.edges
              .filter((edge) => edge.source === selected.id)
              .map((edge) => (
                <label className="config-field" key={edge.id}>
                  Route to {architecture.nodes.find((node) => node.id === edge.target)?.label} (%)
                  <input
                    type="number"
                    min="1"
                    value={edge.weight}
                    onChange={(event) =>
                      setArchitecture((current) => ({
                        ...current,
                        edges: current.edges.map((currentEdge) =>
                          currentEdge.id === edge.id
                            ? { ...currentEdge, weight: Number(event.target.value) }
                            : currentEdge,
                        ),
                      }))
                    }
                  />
                </label>
              ))}
          </>
        ) : (
          <p className="panel-intro">Choose a component on the canvas to configure it.</p>
        )}
        {!validation.runnable && (
          <ul className="validation-errors">
            {validation.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}
        <LearningModePanel
          activeRegions={activeRegions}
          canStart={validation.runnable}
          dispatch={dispatchLearning}
          learning={learning}
          region={learningRegion}
          result={learningResult}
          snapshot={learningSnapshot}
          traffic={learningTraffic}
          onRegionChange={setLearningRegion}
          onStart={() => {
            if (!validation.runnable) {
              setNotice(validation.errors[0]);
              return;
            }
            setSimulation(null);
            setLiveSnapshot(null);
            dispatchLearning({ type: "start", architecture });
            setNotice("Learning mode started. Pause whenever you want to inspect or edit.");
          }}
          onReset={() => {
            dispatchLearning({ type: "reset" });
            setNotice("Learning mode reset without changing your design.");
          }}
        >
          {learningSnapshot && (
            <>
              <ScalingEvidence architecture={architecture} snapshot={learningSnapshot} />
              <RoutingEvidence architecture={architecture} snapshot={learningSnapshot} />
            </>
          )}
        </LearningModePanel>
        <label className="config-field incident-preset">
          Regional incident preset
          <select
            value={regionalIncident}
            onChange={(event) => setRegionalIncident(event.target.value as Region | "none")}
          >
            <option value="none">None</option>
            {activeRegions.map((region) => (
              <option key={region} value={region}>
                {region} latency at 05:00
              </option>
            ))}
          </select>
        </label>
        <label className="config-field incident-preset">
          Runtime deployment preset
          <select
            value={runtimeChange}
            onChange={(event) =>
              setRuntimeChange(
                event.target.value as
                  | "none"
                  | "add-replica"
                  | "remove-replica"
                  | "double-capacity",
              )
            }
          >
            <option value="none">None</option>
            <option value="add-replica">Add selected replica · effective 05:00</option>
            <option value="remove-replica">Remove selected replica · effective 05:00</option>
            <option value="double-capacity">Double selected capacity · effective 05:00</option>
          </select>
        </label>
        {simulation && (
          <section className="run-report" aria-label="Simulation result">
            <p className="eyebrow">Latest run</p>
            <strong
              className={simulation.outcome === "failed" ? "validation-bad" : "validation-good"}
            >
              {simulation.outcome === "failed"
                ? simulation.events.some((event) => event.type === "recovery")
                  ? "Objective breached · recovered"
                  : "Frozen: objective breach"
                : "Passed"}
            </strong>
            {replaySnapshot && (
              <span className={`semantic-health semantic-health-${replaySnapshot.systemHealth}`}>
                System {replaySnapshot.systemHealth}
              </span>
            )}
            {replaySnapshot && (
              <div className="run-metrics">
                <span>
                  Availability <b>{(replaySnapshot.availability * 100).toFixed(2)}%</b>
                </span>
                <span>
                  p95 <b>{replaySnapshot.p95LatencyMs}ms</b>
                </span>
                <span>
                  Throughput <b>{replaySnapshot.throughput.toLocaleString()}/s</b>
                </span>
                <span>
                  Queue <b>{replaySnapshot.queued.toLocaleString()}</b>
                </span>
                <span>
                  Cost <b>${replaySnapshot.cost}/h</b>
                </span>
                <span>
                  Network <b>{replaySnapshot.networkLatencyMs}ms</b>
                </span>
                <span>
                  Regional cost <b>${replaySnapshot.regionalCost}/h</b>
                </span>
                <span>
                  Cache hit <b>{(replaySnapshot.cacheHitRate * 100).toFixed(1)}%</b>
                </span>
                <span>
                  Origin load <b>{replaySnapshot.originLoad.toLocaleString()}/s</b>
                </span>
                <span>
                  Cache misses <b>{replaySnapshot.cacheMisses.toLocaleString()}</b>
                </span>
                <span>
                  Evictions <b>{replaySnapshot.cacheEvictions.toLocaleString()}</b>
                </span>
                <span>
                  Retry amplification <b>{replaySnapshot.retryAttempts.toLocaleString()}</b>
                </span>
                <span>
                  Downstream load <b>{replaySnapshot.amplifiedLoad.toLocaleString()}/s</b>
                </span>
                <span>
                  DB connections <b>{replaySnapshot.databaseConnections.toLocaleString()}</b>
                </span>
                <span>
                  DB wait queue <b>{replaySnapshot.databaseQueue.toLocaleString()}</b>
                </span>
                <span>
                  Message backlog <b>{replaySnapshot.queueBacklog.toLocaleString()}</b>
                </span>
                <span>
                  Messages dropped <b>{replaySnapshot.droppedMessages.toLocaleString()}</b>
                </span>
                {replaySnapshot.hotKeyPressure > 0 && (
                  <span>
                    Hot-key pressure <b>{(replaySnapshot.hotKeyPressure * 100).toFixed(0)}%</b>
                  </span>
                )}
              </div>
            )}
            {replaySnapshot && (
              <RoutingEvidence architecture={architecture} snapshot={replaySnapshot} />
            )}
            {replaySnapshot && (
              <ScalingEvidence architecture={architecture} snapshot={replaySnapshot} />
            )}
            {failure && (
              <div className="failure-evidence">
                <p>
                  First saturation:{" "}
                  <b>
                    {architecture.nodes.find((node) => node.id === failure.firstSaturatedNodeId)
                      ?.label ?? "unknown component"}
                  </b>
                </p>
                <p>
                  Queue growth {failure.queueGrowth.toLocaleString()} · latency +
                  {failure.propagatedLatencyMs}ms · {failure.successfulTraffic.toLocaleString()}{" "}
                  completed · {failure.dropped.toLocaleString()} dropped ·{" "}
                  {failure.timedOut.toLocaleString()} timed out.
                </p>
                <p>{failure.cause}</p>
              </div>
            )}
            <label className="replay-control">
              Replay second{" "}
              <input
                type="range"
                min="0"
                max={simulation.snapshots.at(-1)?.second ?? 0}
                value={replaySecond ?? simulation.snapshots.at(-1)?.second ?? 0}
                onChange={(event) => setReplaySecond(Number(event.target.value))}
              />
            </label>
            <ol className="run-events">
              {simulation.events.map((event) => (
                <li key={`${event.second}-${event.type}`}>
                  <span>{String(event.second).padStart(2, "0")}:00</span>
                  {event.message}
                </li>
              ))}
            </ol>
          </section>
        )}
        {liveSnapshot && !simulation && (
          <section className="run-report" aria-label="Live simulation metrics">
            <p className="eyebrow">Running / {liveSnapshot.second}s</p>
            <span className={`semantic-health semantic-health-${liveSnapshot.systemHealth}`}>
              System {liveSnapshot.systemHealth}
            </span>
            <div className="run-metrics">
              <span>
                Availability <b>{(liveSnapshot.availability * 100).toFixed(2)}%</b>
              </span>
              <span>
                p95 <b>{liveSnapshot.p95LatencyMs}ms</b>
              </span>
              <span>
                Throughput <b>{liveSnapshot.throughput.toLocaleString()}/s</b>
              </span>
              <span>
                Queue <b>{liveSnapshot.queued.toLocaleString()}</b>
              </span>
              <span>
                Network <b>{liveSnapshot.networkLatencyMs}ms</b>
              </span>
              <span>
                Regional cost <b>${liveSnapshot.regionalCost}/h</b>
              </span>
              <span>
                Cache hit <b>{(liveSnapshot.cacheHitRate * 100).toFixed(1)}%</b>
              </span>
              <span>
                Origin load <b>{liveSnapshot.originLoad.toLocaleString()}/s</b>
              </span>
              <span>
                Cache health <b>{liveSnapshot.cacheHealth}</b>
              </span>
              <span>
                Misses / evictions{" "}
                <b>
                  {liveSnapshot.cacheMisses.toLocaleString()} /{" "}
                  {liveSnapshot.cacheEvictions.toLocaleString()}
                </b>
              </span>
              <span>
                Retry amplification <b>{liveSnapshot.retryAttempts.toLocaleString()}</b>
              </span>
              <span>
                Downstream load <b>{liveSnapshot.amplifiedLoad.toLocaleString()}/s</b>
              </span>
              <span>
                DB connections <b>{liveSnapshot.databaseConnections.toLocaleString()}</b>
              </span>
              <span>
                DB wait queue <b>{liveSnapshot.databaseQueue.toLocaleString()}</b>
              </span>
              <span>
                Message backlog <b>{liveSnapshot.queueBacklog.toLocaleString()}</b>
              </span>
              <span>
                Messages dropped <b>{liveSnapshot.droppedMessages.toLocaleString()}</b>
              </span>
            </div>
            <RoutingEvidence architecture={architecture} snapshot={liveSnapshot} />
            <ScalingEvidence architecture={architecture} snapshot={liveSnapshot} />
          </section>
        )}
      </aside>
    </section>
  );
}

function RoutingEvidence({
  architecture,
  snapshot,
}: {
  architecture: Architecture;
  snapshot: Snapshot;
}) {
  return (
    <div className="routing-evidence">
      <strong>Active routing</strong>
      <ul>
        {snapshot.routeAllocations.map((route) => {
          const source = architecture.nodes.find((node) => node.id === route.sourceNodeId);
          const target = architecture.nodes.find((node) => node.id === route.targetNodeId);
          return (
            <li key={`${route.sourceNodeId}-${route.targetNodeId}`}>
              {source?.label ?? "Unknown"} ({source?.config.region}) → {target?.label ?? "Unknown"} (
              {target?.config.region}): {route.weight}% · {route.offered.toLocaleString()}/s · {route.latencyMs}ms
              {route.affected ? " · affected" : ""}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function routedRegions(architecture: Architecture): Region[] {
  const clients = architecture.nodes.filter((node) => node.type === "client");
  const reachable = new Set(clients.map((node) => node.id));
  const pending = [...reachable];
  while (pending.length > 0) {
    const sourceId = pending.shift()!;
    for (const edge of architecture.edges.filter((candidate) => candidate.source === sourceId)) {
      if (reachable.has(edge.target)) continue;
      reachable.add(edge.target);
      pending.push(edge.target);
    }
  }
  return [
    ...new Set(
      architecture.nodes
        .filter((node) => reachable.has(node.id))
        .map((node) => node.config.region),
    ),
  ];
}

function ScalingEvidence({
  architecture,
  snapshot,
}: {
  architecture: Architecture;
  snapshot: Snapshot;
}) {
  const scalingNodes = architecture.nodes.filter(
    (node) =>
      node.config.autoscaling.enabled ||
      snapshot.pendingDeployments.some((deployment) => deployment.nodeId === node.id) ||
      snapshot.activeReplicas[node.id] !== node.config.replicas,
  );
  if (scalingNodes.length === 0 && snapshot.pendingDeployments.length === 0) return null;
  return (
    <div className="routing-evidence scaling-evidence">
      <strong>Runtime capacity</strong>
      <ul>
        {scalingNodes.map((node) => (
          <li key={node.id}>
            {node.label}: {snapshot.activeReplicas[node.id] ?? 0} active · capacity {" "}
            {(snapshot.nodeCapacity[node.id] ?? 0).toLocaleString()}/s
          </li>
        ))}
        {snapshot.pendingDeployments.map((deployment) => (
          <li
            key={`${deployment.kind}-${deployment.nodeId}-${deployment.readyAtSecond}-${deployment.kind === "capacity" ? deployment.replicaDelta : "config"}`}
          >
            {architecture.nodes.find((node) => node.id === deployment.nodeId)?.label ?? "Component"}{" "}
            pending until {String(deployment.readyAtSecond).padStart(2, "0")}:00 · {deployment.source}
          </li>
        ))}
      </ul>
    </div>
  );
}

function changedRuntimeConfig(
  current: ArchitectureNode,
  next: ArchitectureNode,
): Extract<SimulationCommand, { type: "configure" }>["changes"] {
  const changes: Extract<SimulationCommand, { type: "configure" }>["changes"] = {};
  for (const key of Object.keys(next.config) as Array<keyof ArchitectureNode["config"]>) {
    if (key === "replicas") continue;
    if (JSON.stringify(current.config[key]) === JSON.stringify(next.config[key])) continue;
    Object.assign(changes, { [key]: structuredClone(next.config[key]) });
  }
  return changes;
}
