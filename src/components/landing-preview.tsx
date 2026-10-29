import { ArrowRight } from "lucide-react";
import { useId, useState } from "react";

const stages = [
  { label: "Start small", title: "Your first working system", description: "A visitor asks. The server looks up the link. The database remembers.", detail: "Client → API server → Database" },
  { label: "Grow traffic", title: "Give popular links a shortcut", description: "A cache answers repeated lookups, leaving less work for the database.", detail: "Add a cache for repeated reads" },
  { label: "Stay online", title: "Make room for another server", description: "A load balancer shares requests across servers, so one server is not doing it all.", detail: "Spread traffic across API servers" },
];

type BuildingKind = "client" | "server" | "database" | "cache" | "balancer";

function Building({ x, y, kind, label }: { x: number; y: number; kind: BuildingKind; label: string }) {
  // Match the building colors used by the sandbox in game.css.
  const base = {
    client: "#4caa75",
    server: "var(--park-coral)",
    database: "#518ac8",
    cache: "var(--park-yellow)",
    balancer: "#8068b3",
  }[kind];
  const colors = [
    `color-mix(in srgb, ${base}, white 25%)`,
    base,
    `color-mix(in srgb, ${base}, var(--park-ink) 22%)`,
  ];
  return (
    <g className={`preview-building preview-building-${kind}`} transform={`translate(${x} ${y})`}>
      <ellipse cx="0" cy="16" rx="64" ry="27" fill="var(--park-line)" opacity=".08" />
      <path d="M-54 0 0-29 54 0 0 29Z" fill="var(--park-cream)" stroke="var(--park-line)" strokeWidth="1.3" />
      <path d="M-54 0 0 29 54 0V8L0 37-54 8Z" fill="#e7d7b0" stroke="var(--park-line)" strokeWidth="1.3" />
      {kind === "database" ? (
        <g stroke="var(--park-line)" strokeWidth="1.6">
          <path d="M-32-69V-15C-32 5 32 5 32-15V-69" fill={colors[1]} />
          <path d="M0-69V0C18 0 32-5 32-15V-69" fill={colors[2]} stroke="none" />
          <ellipse cy="-69" rx="32" ry="14" fill={colors[0]} />
          <path d="M-32-49C-32-31 32-31 32-49M-32-29C-32-11 32-11 32-29" fill="none" />
          <path d="M-23-61Q-7-54 13-58" fill="none" stroke="#fff" strokeOpacity=".8" />
        </g>
      ) : kind === "client" ? (
        <g stroke="var(--park-line)" strokeWidth="1.6" strokeLinejoin="round">
          <path d="M-35-68 22-44V-1L-35-25Z" fill={colors[2]} />
          <path d="M-35-68-27-73 30-49 22-44Z" fill={colors[0]} />
          <path d="M22-44 30-49V-6L22-1Z" fill={colors[1]} />
          <path d="M-28-58 14-40V-12L-28-30Z" fill="var(--park-ink)" />
          <path d="m-17-40 6 7-6 2m13 5 10 4" fill="none" stroke="var(--park-yellow)" strokeWidth="2" />
          <path d="M-9-13V-1L-23 5-4 13 13 5 1 0V-9" fill={colors[1]} />
        </g>
      ) : (
        <g stroke="var(--park-line)" strokeWidth="1.6" strokeLinejoin="round">
          <path d="M-28-70 5-88 34-72 1-54Z" fill={colors[0]} />
          <path d="M-28-70 1-54V4L-28-12Z" fill={colors[1]} />
          <path d="M1-54 34-72V-14L1 4Z" fill={colors[2]} />
          {kind === "server" ? [0, 1, 2].map((row) => (
            <g key={row} transform={`translate(0 ${row * 16})`}>
              <path d="M-22-58-5-49V-41L-22-50Z" fill="var(--park-cream)" strokeWidth="1" />
              <circle cx="-18" cy="-51" r="1.5" fill="#32684d" stroke="none" />
              <path d="m8-49 19-10m-19 5 19-10" stroke="var(--park-line)" strokeWidth="1" />
            </g>
          )) : kind === "cache" ? (
            <path d="m-8-57-11 17 10 4-5 16 16-19-11-5 7-12Z" fill="var(--park-cream)" strokeWidth="1" />
          ) : (
            <g fill="none" stroke="var(--park-paper)" strokeWidth="2">
              <path d="m-14-51 0 19m0-9-8-4m8 4 8 4" />
              <circle cx="-14" cy="-53" r="3" /><circle cx="-22" cy="-45" r="3" /><circle cx="-6" cy="-37" r="3" />
            </g>
          )}
        </g>
      )}
      <text className="preview-building-label" y="62" textAnchor="middle">{label}</text>
    </g>
  );
}

export function LandingPreview() {
  const [stage, setStage] = useState(0);
  const id = useId();
  const current = stages[stage]!;
  const paths = stage === 2
    ? ["M115 267 215 213", "M235 213 350 152", "M235 230 350 337", "M390 152 580 213", "M390 337 580 230", "M390 337 505 313", "M390 192 505 300"]
    : ["M130 280 345 178", "M395 178 580 227", ...(stage === 1 ? ["M385 200 495 307"] : [])];
  return (
    <div className="landing-preview">
      <div className="preview-scene-heading"><span className="preview-live-dot" /> A small system, growing with you <span className="preview-scene-index">0{stage + 1} / 03</span></div>
      <svg className="preview-scene" viewBox="0 0 720 495" role="img" aria-labelledby={`${id}-title ${id}-description`}>
        <title id={`${id}-title`}>{current.title}</title>
        <desc id={`${id}-description`}>{current.description}</desc>
        <defs>
          <pattern id={`${id}-grid`} width="44" height="26" patternUnits="userSpaceOnUse" patternTransform="matrix(1 .5 -1 .5 360 0)">
            <path d="M44 0H0V26" fill="none" stroke="#83bf69" strokeWidth=".8" opacity=".35" />
          </pattern>
        </defs>
        <path d="M29 265 362 83 696 265 363 461Z" fill="#80c87a" />
        <path d="M29 253 362 71 696 253 363 449Z" fill="var(--park-lawn)" stroke="var(--park-line)" strokeWidth="1.2" />
        <path d="M29 253 362 71 696 253 363 449Z" fill={`url(#${id}-grid)`} />
        <path d="m29 253 334 183 333-183" fill="none" stroke="rgba(255, 255, 255, .45)" strokeWidth="3" />
        <g className="preview-traffic" key={stage} fill="none" strokeLinecap="round" strokeLinejoin="round">
          {paths.map((path) => <g key={path}><path d={path} stroke="#315a4b" strokeWidth="9" /><path d={path} stroke="#fff3a7" strokeWidth="5" /><path className="preview-packets" d={path} stroke="var(--park-coral)" strokeWidth="4" strokeDasharray="1 28" /></g>)}
        </g>
        <g className="preview-tree" transform="translate(270 345)"><ellipse cy="14" rx="16" ry="8" fill="var(--park-line)" opacity=".2" /><path d="M0 5V-26" stroke="var(--park-line)" strokeWidth="4" /><path d="M0-64-20-24 0-14 20-24Z" fill="#80c87a" stroke="var(--park-line)" /><path d="M0-64V-14L20-24Z" fill="#4caa75" /></g>
        <g className="preview-tree" transform="translate(470 165) scale(.7)"><path d="M0 5V-26" stroke="var(--park-line)" strokeWidth="4" /><path d="M0-64-20-24 0-14 20-24Z" fill="#80c87a" stroke="var(--park-line)" /><path d="M0-64V-14L20-24Z" fill="#4caa75" /></g>
        <Building x={105} y={290} kind="client" label="Visitors" />
        {stage === 2 && <Building x={235} y={220} kind="balancer" label="Load balancer" />}
        <Building x={370} y={175} kind="server" label={stage === 2 ? "API server 1" : "API server"} />
        <Building x={605} y={240} kind="database" label="Database" />
        {stage === 2 && <Building x={370} y={350} kind="server" label="API server 2" />}
        {stage > 0 && <Building x={525} y={320} kind="cache" label="Cache" />}
        <g className="preview-annotation" transform="translate(55 130)"><text>Every click is</text><text y="18">a little journey.</text><path d="M83 25Q115 45 111 88m0 0-6-9m6 9 8-6" fill="none" stroke="var(--park-soft)" strokeWidth="1.5" /></g>
      </svg>
      <div className="preview-controls" role="group" aria-label="Explore how the system grows">
        {stages.map((item, index) => <button key={item.label} type="button" aria-pressed={stage === index} onClick={() => setStage(index)}><span>0{index + 1}</span>{item.label}{stage === index && <ArrowRight size={14} />}</button>)}
      </div>
      <div className="preview-caption" aria-live="polite"><span>{current.detail}</span><p>{current.description}</p></div>
    </div>
  );
}
