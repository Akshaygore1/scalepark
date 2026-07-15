import { Copy, Download, Link2, Play, Plus, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

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
} from "@/lib/architecture";
import type { SimulationResult, Snapshot } from "@/lib/simulation";
import { explainFailure } from "@/lib/simulation";

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
  const selected = architecture.nodes.find((node) => node.id === selectedId);
  const validation = useMemo(() => validateArchitecture(architecture), [architecture]);
  const replaySnapshot =
    simulation?.snapshots.find((snapshot) => snapshot.second === replaySecond) ??
    simulation?.snapshots.at(-1);
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
      setNotice(
        event.data.result.outcome === "failed"
          ? "Run frozen at its first objective breach."
          : "Run completed within its objectives.",
      );
    };
    return () => worker.current?.terminate();
  }, []);

  function updateNode(id: string, update: (node: ArchitectureNode) => ArchitectureNode) {
    setArchitecture((current) => ({
      ...current,
      nodes: current.nodes.map((node) => (node.id === id ? update(node) : node)),
    }));
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
    setNotice("Running deterministic scenario in the simulation worker…");
    setLiveSnapshot(null);
    setSimulation(null);
    worker.current?.postMessage({ architecture, seed: 1 });
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
            <button className="palette-item" key={type} type="button" onClick={() => addNode(type)}>
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
          <button className="run-button" type="button" onClick={runDesign}>
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
                <line
                  key={edge.id}
                  x1={source.x + 72}
                  y1={source.y + 20}
                  x2={target.x + 72}
                  y2={target.y + 20}
                />
              );
            })}
          </svg>
          {architecture.nodes.map((node) => (
            <button
              className={`editor-node ${selectedId === node.id ? "editor-node-selected" : ""} ${connectionSource === node.id ? "editor-node-connecting" : ""} ${simulation?.firstSaturatedNodeId === node.id ? "editor-node-saturated" : ""}`}
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
              <span>{node.label}</span>
              <small>×{node.config.replicas}</small>
            </button>
          ))}
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
              <button type="button" onClick={() => setConnectionSource(selected.id)}>
                <Link2 size={14} /> Connect
              </button>
              <button type="button" onClick={duplicateSelected}>
                <Copy size={14} /> Duplicate
              </button>
              <button type="button" onClick={removeSelected}>
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
                  Route weight %
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
        {simulation && (
          <section className="run-report" aria-label="Simulation result">
            <p className="eyebrow">Latest run</p>
            <strong
              className={simulation.outcome === "failed" ? "validation-bad" : "validation-good"}
            >
              {simulation.outcome === "failed" ? "Frozen: objective breach" : "Passed"}
            </strong>
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
              </div>
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
            </div>
          </section>
        )}
      </aside>
    </section>
  );
}
