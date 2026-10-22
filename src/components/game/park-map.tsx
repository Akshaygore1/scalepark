import { ArrowRight, Trash2, Users } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import {
  canConnect,
  nodeCatalog,
  nodeTypes,
  type Architecture,
  type NodeType,
  type ParkEdge,
  type ParkNode,
} from "@/lib/model";
import type { Health, Snapshot } from "@/lib/simulation";

import { buildingLook } from "./buildings";

const BUILDING_WIDTH = 110;
const BUILDING_HEIGHT = 118;
export const DRAG_TYPE = "application/x-scalelab-building";

type Gesture = {
  sourceId: string;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  moved: boolean;
  targetId: string | null;
};

export function ParkMap({
  architecture,
  snapshot,
  selectedId,
  connectionSource,
  editable,
  onBuild,
  onCancelConnection,
  onConnect,
  onConnectionSource,
  onDisconnect,
  onMove,
  onSelect,
}: {
  architecture: Architecture;
  snapshot?: Snapshot;
  selectedId: string | null;
  connectionSource: string | null;
  editable: boolean;
  onBuild: (type: NodeType, position: { x: number; y: number }) => void;
  onCancelConnection: () => void;
  onConnect: (sourceId: string, targetId: string) => void;
  onConnectionSource: (sourceId: string) => void;
  onDisconnect: (edgeId: string) => void;
  onMove: (nodeId: string, position: { x: number; y: number }) => void;
  onSelect: (nodeId: string | null) => void;
}) {
  const [dropActive, setDropActive] = useState(false);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [gesture, setGestureState] = useState<Gesture | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const suppressConnectorClick = useRef<string | null>(null);
  const activeSource = gesture?.sourceId ?? connectionSource;
  const byId = new Map(architecture.nodes.map((node) => [node.id, node]));

  const setGesture = (next: Gesture | null) => {
    gestureRef.current = next;
    setGestureState(next);
  };
  const isEligible = (sourceId: string, targetId: string) => {
    const source = byId.get(sourceId);
    const target = byId.get(targetId);
    return Boolean(
      source &&
        target &&
        sourceId !== targetId &&
        canConnect(source.type, target.type) &&
        !architecture.edges.some((edge) => edge.source === sourceId && edge.target === targetId),
    );
  };
  const hasDestination = (sourceId: string) => architecture.nodes.some((node) => isEligible(sourceId, node.id));

  useEffect(() => {
    if (selectedEdgeId && !architecture.edges.some((edge) => edge.id === selectedEdgeId)) setSelectedEdgeId(null);
  }, [architecture.edges, selectedEdgeId]);

  useEffect(() => {
    if (!connectionSource && !selectedEdgeId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSelectedEdgeId(null);
      setGesture(null);
      if (connectionSource) onCancelConnection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [connectionSource, onCancelConnection, selectedEdgeId]);

  useEffect(() => {
    if (!selectedEdgeId) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".route-action, .route-hitbox")) return;
      setSelectedEdgeId(null);
    };
    window.addEventListener("pointerdown", dismiss);
    return () => window.removeEventListener("pointerdown", dismiss);
  }, [selectedEdgeId]);

  function beginConnectorDrag(event: ReactPointerEvent<HTMLButtonElement>, sourceId: string) {
    if (event.button !== 0 || !event.isPrimary || !hasDestination(sourceId)) return;
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
    const current = gestureRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const map = event.currentTarget.closest(".park-map");
    if (!(map instanceof HTMLElement)) return;
    const bounds = map.getBoundingClientRect();
    const hovered = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
    setGesture({
      ...current,
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
      moved: current.moved || Math.hypot(event.clientX - current.startX, event.clientY - current.startY) >= 4,
      targetId: hovered && isEligible(current.sourceId, hovered) ? hovered : null,
    });
  }

  function finishConnector(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = gestureRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setGesture(null);
    if (!current.moved) return;
    if (current.targetId) onConnect(current.sourceId, current.targetId);
    else onCancelConnection();
  }

  const paths = architecture.edges.flatMap((edge) => {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    return source && target ? [{ edge, source, target, d: routePath(source, target) }] : [];
  });
  const selectedPath = paths.find(({ edge }) => edge.id === selectedEdgeId);

  return (
    <div
      className={`park-map ${dropActive ? "drop-active" : ""} ${activeSource ? "choosing-destination" : ""}`}
      onClick={(event) => {
        if (event.target instanceof Element && event.target.closest(".park-building, .route-action, .route-hitbox")) {
          return;
        }
        if (connectionSource) {
          setGesture(null);
          onCancelConnection();
        } else {
          onSelect(null);
        }
      }}
      onDragOver={(event) => {
        if (!editable || !event.dataTransfer.types.includes(DRAG_TYPE)) return;
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
        const type = event.dataTransfer.getData(DRAG_TYPE) as NodeType;
        if (!editable || !nodeTypes.includes(type)) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        onBuild(type, {
          x: Math.max(0, Math.min(bounds.width - BUILDING_WIDTH, event.clientX - bounds.left - BUILDING_WIDTH / 2)),
          y: Math.max(0, Math.min(bounds.height - BUILDING_HEIGHT, event.clientY - bounds.top - BUILDING_HEIGHT / 2)),
        });
      }}
    >
      <div className="park-hills" aria-hidden="true" />
      <div className="park-road" aria-hidden="true" />
      <div className="park-gate" aria-hidden="true">
        <Users />
        <span>THE INTERNET</span>
      </div>
      <svg className="route-layer" role="group" aria-label="Traffic routes">
        <defs>
          <marker id="connection-preview-arrow" markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="4" viewBox="0 0 8 8">
            <path d="M0 0 8 4 0 8Z" />
          </marker>
        </defs>
        {paths.map(({ edge, source, target, d }) => {
          const flow = snapshot?.nodes[target.type];
          const health = flow?.health;
          const congested = health === "saturated" || health === "failed";
          const packets = flow ? Math.max(1, Math.min(5, Math.ceil(flow.load / 1_500))) : 0;
          const duration = congested ? 4.2 : flow && flow.load > 6_000 ? 1.6 : 2.6;
          const selected = selectedEdgeId === edge.id;
          return (
            <g key={edge.id}>
              <path className={`route-shadow ${selected ? "selected" : ""}`} d={d} />
              <path className={`route-line ${health === "failed" ? "interrupted" : ""} ${selected ? "selected" : ""}`} d={d} />
              {Array.from({ length: packets }, (_, index) => (
                <circle className={congested ? "traffic-packet congested" : "traffic-packet"} key={index} r="5">
                  <animateMotion begin={`${index * -(duration / packets)}s`} dur={`${duration}s`} path={d} repeatCount="indefinite" />
                </circle>
              ))}
              <path
                className="route-hitbox"
                d={d}
                role="button"
                tabIndex={editable ? 0 : -1}
                aria-label={`Route from ${nodeCatalog[source.type].label} to ${nodeCatalog[target.type].label}`}
                aria-pressed={selected}
                onClick={(event) => {
                  event.stopPropagation();
                  if (editable) setSelectedEdgeId(edge.id);
                }}
                onKeyDown={(event) => {
                  if (!editable || (event.key !== "Enter" && event.key !== " ")) return;
                  event.preventDefault();
                  setSelectedEdgeId(edge.id);
                }}
              />
            </g>
          );
        })}
        {gesture?.moved &&
          (() => {
            const source = byId.get(gesture.sourceId);
            if (!source) return null;
            const target = gesture.targetId ? byId.get(gesture.targetId) : undefined;
            const end = target ? routeCenter(target) : { x: gesture.x, y: gesture.y };
            return (
              <path
                className={`connection-preview ${target ? "valid" : ""}`}
                d={curve({ x: source.x + 108, y: source.y + 57 }, end)}
                markerEnd="url(#connection-preview-arrow)"
              />
            );
          })()}
      </svg>
      {selectedPath && editable && (
        <RouteAction
          edge={selectedPath.edge}
          source={selectedPath.source}
          target={selectedPath.target}
          onDisconnect={() => {
            setSelectedEdgeId(null);
            onDisconnect(selectedPath.edge.id);
          }}
        />
      )}
      <div className="park-tree tree-a" aria-hidden="true">♣</div>
      <div className="park-tree tree-b" aria-hidden="true">♣</div>
      <div className="park-tree tree-c" aria-hidden="true">♣</div>
      {architecture.nodes.map((node) => (
        <Building
          key={node.id}
          node={node}
          health={snapshot ? (snapshot.nodes[node.type]?.health ?? "idle") : undefined}
          selected={selectedId === node.id}
          editable={editable}
          connecting={activeSource === node.id}
          eligible={Boolean(activeSource) && isEligible(activeSource!, node.id)}
          target={gesture?.targetId === node.id}
          connectorDisabled={!hasDestination(node.id)}
          onClick={() => {
            setSelectedEdgeId(null);
            if (connectionSource && connectionSource !== node.id && isEligible(connectionSource, node.id)) {
              onConnect(connectionSource, node.id);
            } else if (connectionSource === node.id) {
              onCancelConnection();
            } else {
              onSelect(node.id);
            }
          }}
          onConnectorClick={() => {
            if (suppressConnectorClick.current === node.id) {
              suppressConnectorClick.current = null;
              return;
            }
            if (connectionSource === node.id) onCancelConnection();
            else onConnectionSource(node.id);
          }}
          onConnectorPointerDown={(event) => beginConnectorDrag(event, node.id)}
          onConnectorPointerMove={moveConnector}
          onConnectorPointerUp={finishConnector}
          onConnectorPointerCancel={(event) => {
            if (gestureRef.current?.pointerId !== event.pointerId) return;
            setGesture(null);
            onCancelConnection();
          }}
          onMove={onMove}
        />
      ))}
    </div>
  );
}

function RouteAction({
  edge,
  source,
  target,
  onDisconnect,
}: {
  edge: ParkEdge;
  source: ParkNode;
  target: ParkNode;
  onDisconnect: () => void;
}) {
  const from = routeCenter(source);
  const to = routeCenter(target);
  return (
    <div
      className="route-action"
      role="group"
      aria-label={`Route from ${nodeCatalog[source.type].label} to ${nodeCatalog[target.type].label}`}
      style={{ left: (from.x + to.x) / 2, top: (from.y + to.y) / 2 }}
      onClick={(event) => event.stopPropagation()}
      data-edge-id={edge.id}
    >
      <span>
        <b>{nodeCatalog[source.type].short}</b>
        <i aria-hidden="true">→</i>
        <b>{nodeCatalog[target.type].short}</b>
      </span>
      <button type="button" onClick={onDisconnect}>
        <Trash2 aria-hidden="true" />
        Disconnect
      </button>
    </div>
  );
}

function buildingSubtitle(node: ParkNode) {
  switch (node.type) {
    case "api":
      return `${node.config.size} ×${node.config.autoscaling.enabled ? "auto" : node.config.instances}`;
    case "replica":
      return `${node.config.size} ×${node.config.instances}`;
    case "worker":
      return `×${node.config.instances}`;
    case "database":
      return node.config.shards > 1 ? `${node.config.size} ×${node.config.shards} shards` : node.config.size;
    case "cache":
      return `${node.config.size} · ${node.config.ttlSeconds}s`;
    default:
      return "";
  }
}

const healthLabel: Record<Health, string> = {
  idle: "idle",
  healthy: "healthy",
  busy: "busy",
  saturated: "overloaded",
  failed: "failing",
};

function Building({
  node,
  health,
  selected,
  editable,
  connecting,
  eligible,
  target,
  connectorDisabled,
  onClick,
  onConnectorClick,
  onConnectorPointerDown,
  onConnectorPointerMove,
  onConnectorPointerUp,
  onConnectorPointerCancel,
  onMove,
}: {
  node: ParkNode;
  health?: Health;
  selected: boolean;
  editable: boolean;
  connecting: boolean;
  eligible: boolean;
  target: boolean;
  connectorDisabled: boolean;
  onClick: () => void;
  onConnectorClick: () => void;
  onConnectorPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onConnectorPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onConnectorPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onConnectorPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onMove: (nodeId: string, position: { x: number; y: number }) => void;
}) {
  const { icon: Icon, color } = buildingLook[node.type];
  const drag = useRef<{ pointerId: number; x: number; y: number; nodeX: number; nodeY: number; maxX: number; maxY: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(false);
  const status = health ? healthLabel[health] : "ready";
  const subtitle = buildingSubtitle(node);
  return (
    <div
      className={`park-building ${color} health-${health ?? "ready"} ${selected ? "selected" : ""} ${connecting ? "connecting" : ""} ${eligible ? "connection-eligible" : ""} ${target ? "connection-target" : ""} ${dragging ? "dragging" : ""}`}
      data-node-id={node.id}
      style={{ left: node.x, top: node.y }}
    >
      <button
        className="building-select"
        type="button"
        aria-label={`${nodeCatalog[node.type].label}${subtitle ? `, ${subtitle}` : ""}, ${status}`}
        onClick={(event) => {
          event.stopPropagation();
          if (!suppressClick.current) onClick();
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || !event.isPrimary) return;
          const bounds = event.currentTarget.closest(".park-map")?.getBoundingClientRect();
          if (!bounds) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            nodeX: node.x,
            nodeY: node.y,
            maxX: Math.max(0, bounds.width - BUILDING_WIDTH),
            maxY: Math.max(0, bounds.height - BUILDING_HEIGHT),
            moved: false,
          };
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || current.pointerId !== event.pointerId) return;
          const dx = event.clientX - current.x;
          const dy = event.clientY - current.y;
          if (!current.moved && Math.hypot(dx, dy) < 4) return;
          current.moved = true;
          setDragging(true);
          onMove(node.id, {
            x: Math.max(0, Math.min(current.maxX, current.nodeX + dx)),
            y: Math.max(0, Math.min(current.maxY, current.nodeY + dy)),
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
      >
        <span className="building-status">{status}</span>
        <span className="building-roof">
          <Icon />
        </span>
        <span className="building-body">
          <i />
          <i />
          <i />
        </span>
        <span className="building-label">
          <b>{nodeCatalog[node.type].label}</b>
          {subtitle && <small>{subtitle}</small>}
        </span>
        {(health === "busy" || health === "saturated" || health === "failed") && (
          <span className="building-smoke">● ●</span>
        )}
      </button>
      {editable && (
        <button
          className="connection-handle"
          type="button"
          aria-label={`Connect from ${nodeCatalog[node.type].label}`}
          aria-pressed={connecting}
          disabled={connectorDisabled}
          onClick={(event) => {
            event.stopPropagation();
            onConnectorClick();
          }}
          onPointerDown={onConnectorPointerDown}
          onPointerMove={onConnectorPointerMove}
          onPointerUp={onConnectorPointerUp}
          onPointerCancel={onConnectorPointerCancel}
        >
          <ArrowRight aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function routeCenter(node: ParkNode) {
  return { x: node.x + 54, y: node.y + 48 };
}

function curve(start: { x: number; y: number }, end: { x: number; y: number }) {
  const middle = start.x + (end.x - start.x) / 2;
  return `M ${start.x} ${start.y} C ${middle} ${start.y}, ${middle} ${end.y}, ${end.x} ${end.y}`;
}

function routePath(source: ParkNode, target: ParkNode) {
  return curve(routeCenter(source), routeCenter(target));
}
