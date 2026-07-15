import {
  Activity,
  ArrowRight,
  Boxes,
  Cloud,
  Database,
  Gauge,
  Globe2,
  Network,
  Server,
  ShieldAlert,
  Timer,
  Users,
} from "lucide-react";

const objectives = [
  { label: "Traffic", value: "18k req/s peak", icon: Activity },
  { label: "Availability", value: "99.95%", icon: ShieldAlert },
  { label: "p95 latency", value: "< 180 ms", icon: Timer },
  { label: "Success floor", value: "17.1k req/s", icon: Gauge },
  { label: "Cost ceiling", value: "$42 / simulated hour", icon: Boxes },
];

const palette = [
  { label: "Client", icon: Users },
  { label: "DNS / CDN", icon: Globe2 },
  { label: "Load balancer", icon: Network },
  { label: "API server", icon: Server },
  { label: "Cache", icon: Cloud },
  { label: "Primary database", icon: Database },
];

const metrics = [
  { label: "Availability", value: "100.00%", tone: "good" },
  { label: "p95 latency", value: "42 ms", tone: "good" },
  { label: "Successful throughput", value: "2.1k/s", tone: "good" },
  { label: "Queue depth", value: "0", tone: "neutral" },
  { label: "Estimated cost", value: "$11.80/h", tone: "neutral" },
] as const satisfies ReadonlyArray<{
  label: string;
  value: string;
  tone: "good" | "neutral";
}>;

export function meta() {
  return [
    { title: "ScaleLab — URL shortener" },
    {
      name: "description",
      content: "Learn system design by building, breaking, and repairing a URL shortener.",
    },
  ];
}

function ArchitectureNode({
  children,
  className = "",
  icon: Icon,
  status = "healthy",
}: {
  children: React.ReactNode;
  className?: string;
  icon: typeof Server;
  status?: "healthy" | "heating";
}) {
  return (
    <div className={`architecture-node ${className}`}>
      <Icon aria-hidden="true" size={17} strokeWidth={1.8} />
      <span>{children}</span>
      <i className={`node-status node-status-${status}`} aria-label={status} />
    </div>
  );
}

export default function Home() {
  return (
    <main className="lab-page">
      <section className="briefing" aria-labelledby="lab-title">
        <div className="briefing-copy">
          <p className="eyebrow">Lab 01 / Build for the spike</p>
          <h1 id="lab-title">Can this short link survive becoming everyone’s link?</h1>
          <p className="briefing-lede">
            You own a URL shortener on the morning it gets shared everywhere. Inspect the starter,
            shape an architecture, then test whether your decisions hold when traffic turns.
          </p>
          <div className="briefing-meta">
            <span>~ 12 min</span>
            <span>URL shortener</span>
            <span>Starter scenario</span>
          </div>
          <p className="scoring-context">
            Your score rewards meeting the reliability, latency, throughput, and cost targets
            together—without buying your way around the problem.
          </p>
        </div>
        <aside className="briefing-note" aria-label="How ScaleLab works">
          <span className="note-mark">↗</span>
          <p>Build it. Break it. Read the evidence. Try again.</p>
          <small>Simulation, not a production forecast.</small>
        </aside>
      </section>

      <section className="objective-strip" aria-label="Challenge objectives">
        {objectives.map(({ label, value, icon: Icon }) => (
          <div className="objective" key={label}>
            <Icon aria-hidden="true" size={16} strokeWidth={1.8} />
            <div>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          </div>
        ))}
      </section>

      <section className="lab-workspace" aria-label="ScaleLab workspace">
        <aside className="workspace-panel component-palette" aria-labelledby="palette-title">
          <div className="panel-heading">
            <p className="eyebrow">Build</p>
            <h2 id="palette-title">Components</h2>
          </div>
          <p className="panel-intro">The pieces available for this URL-shortener system.</p>
          <div className="palette-list">
            {palette.map(({ label, icon: Icon }) => (
              <button className="palette-item" key={label} type="button">
                <Icon aria-hidden="true" size={17} strokeWidth={1.8} />
                {label}
                <span aria-hidden="true">+</span>
              </button>
            ))}
          </div>
          <p className="panel-footnote">Drag and connect components in the next lab step.</p>
        </aside>

        <section className="architecture-canvas" aria-labelledby="architecture-title">
          <div className="canvas-header">
            <div>
              <p className="eyebrow">Starter architecture</p>
              <h2 id="architecture-title">A shortcut with a single point of failure</h2>
            </div>
            <span className="starter-badge">Intentionally underpowered</span>
          </div>
          <div
            className="canvas-stage"
            role="img"
            aria-label="Client flows through a CDN and API server to one primary database"
          >
            <div className="flow-line flow-line-one" aria-hidden="true" />
            <div className="flow-line flow-line-two" aria-hidden="true" />
            <div className="flow-line flow-line-three" aria-hidden="true" />
            <ArchitectureNode className="node-client" icon={Users}>
              Clients
            </ArchitectureNode>
            <ArchitectureNode className="node-cdn" icon={Globe2}>
              DNS / CDN
            </ArchitectureNode>
            <ArchitectureNode className="node-api" icon={Server}>
              API server ×1
            </ArchitectureNode>
            <ArchitectureNode className="node-db" icon={Database} status="heating">
              Primary DB ×1
            </ArchitectureNode>
            <span className="traffic-label traffic-label-one">2.1k req/s</span>
            <span className="traffic-label traffic-label-two">origin reads</span>
            <div className="canvas-warning">
              <ShieldAlert aria-hidden="true" size={16} />
              <span>No cache, replicas, queue, or worker capacity yet.</span>
            </div>
          </div>
          <div className="canvas-footer">
            <span>Starter state / editable in Lab 02</span>
            <button type="button">
              Inspect architecture <ArrowRight aria-hidden="true" size={15} />
            </button>
          </div>
        </section>

        <aside className="workspace-panel inspector" aria-labelledby="inspector-title">
          <div className="panel-heading">
            <p className="eyebrow">Inspect</p>
            <h2 id="inspector-title">Primary database</h2>
          </div>
          <dl className="inspector-values">
            <div>
              <dt>Replicas</dt>
              <dd>1</dd>
            </div>
            <div>
              <dt>Capacity</dt>
              <dd>2,500 req/s</dd>
            </div>
            <div>
              <dt>Connections</dt>
              <dd>80</dd>
            </div>
            <div>
              <dt>Region</dt>
              <dd>us-east</dd>
            </div>
          </dl>
          <div className="inspector-callout">
            <ShieldAlert aria-hidden="true" size={17} />
            <p>
              <strong>Watch this node.</strong> The first spike will exceed its finite capacity.
            </p>
          </div>
        </aside>

        <section className="workspace-panel metrics" aria-labelledby="metrics-title">
          <div className="panel-heading panel-heading-inline">
            <div>
              <p className="eyebrow">Observe</p>
              <h2 id="metrics-title">Live metrics</h2>
            </div>
            <span className="not-running">Not running</span>
          </div>
          <div className="metric-grid">
            {metrics.map(({ label, value, tone }) => (
              <div className="metric" key={label}>
                <span>{label}</span>
                <strong className={tone}>{value}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="workspace-panel timeline" aria-labelledby="timeline-title">
          <div className="panel-heading panel-heading-inline">
            <div>
              <p className="eyebrow">Replay</p>
              <h2 id="timeline-title">Scenario timeline</h2>
            </div>
            <span className="timeline-time">00:00</span>
          </div>
          <ol className="timeline-track">
            <li className="timeline-active">
              <span>00:00</span>
              <strong>Normal traffic</strong>
            </li>
            <li>
              <span>03:00</span>
              <strong>Capacity spike</strong>
            </li>
            <li>
              <span>06:00</span>
              <strong>Viral hot link</strong>
            </li>
            <li>
              <span>09:00</span>
              <strong>Recovery window</strong>
            </li>
          </ol>
        </section>
      </section>

      <p className="simulation-disclaimer">
        ScaleLab uses a simplified, deterministic educational simulation. Results illustrate
        system-design trade-offs; they do not predict production deployments, cloud bills, or
        incident outcomes.
      </p>
    </main>
  );
}
