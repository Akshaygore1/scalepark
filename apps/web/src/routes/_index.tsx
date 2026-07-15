import { Activity, Boxes, Gauge, ShieldAlert, Timer } from "lucide-react";

import { ArchitectureEditor } from "@/components/architecture-editor";

const objectives = [
  { label: "Traffic", value: "18k req/s peak", icon: Activity },
  { label: "Availability", value: "99.95%", icon: ShieldAlert },
  { label: "p95 latency", value: "< 180 ms", icon: Timer },
  { label: "Success floor", value: "17.1k req/s", icon: Gauge },
  { label: "Cost ceiling", value: "$42 / simulated hour", icon: Boxes },
];

export function meta() {
  return [
    { title: "ScaleLab — URL shortener" },
    {
      name: "description",
      content: "Learn system design by building, breaking, and repairing a URL shortener.",
    },
  ];
}

export default function Home() {
  return (
    <main className="lab-page">
      <section className="briefing" aria-labelledby="lab-title">
        <div className="briefing-copy">
          <p className="eyebrow">Lab 01 / Build for the spike</p>
          <h1 id="lab-title">Can this short link survive becoming everyone’s link?</h1>
          <p className="briefing-lede">
            You own a URL shortener on the morning it gets shared everywhere. Shape an architecture,
            then test whether your decisions hold when traffic turns.
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
      <ArchitectureEditor />
      <p className="simulation-disclaimer">
        ScaleLab uses a simplified, deterministic educational simulation. Results illustrate
        system-design trade-offs; they do not predict production deployments, cloud bills, or
        incident outcomes.
      </p>
    </main>
  );
}
