import type { NodeType } from "@/lib/model";

/** Decorative artwork only. The map owns dragging, selection, and connections. */
export function BuildingArt({ type }: { type: NodeType }) {
  return (
    <svg className="building-art" viewBox="0 0 120 118" aria-hidden="true" focusable="false">
      <ellipse className="sprite-shadow" cx="60" cy="91" rx="49" ry="18" />
      <path className="building-selection-ring" d="M3 77 60 44 117 77 60 116Z" />
      <g className="sprite-lines">
        <path className="sprite-foundation-edge" d="M9 76 60 48 111 76V83L60 111 9 83Z" />
        <path className="sprite-foundation" d="M9 76 60 48 111 76 60 104Z" />
        <path className="sprite-foundation-detail" d="M17 77 60 100 103 77" />
        <Artwork type={type} />
      </g>
    </svg>
  );
}

function StorageDrum({ x, y, small = false }: { x: number; y: number; small?: boolean }) {
  return (
    <g transform={`translate(${x} ${y})${small ? " scale(.7)" : ""}`}>
      <path className="sprite-accent" d="M-25 0V47C-25 64 25 64 25 47V0Z" />
      <path className="sprite-shade" d="M5 10V59C17 58 25 54 25 47V0Z" stroke="none" />
      <ellipse className="sprite-light" rx="25" ry="12" />
      <path className="sprite-seam" d="M-25 16C-25 32 25 32 25 16M-25 32C-25 48 25 48 25 32" />
      <path className="sprite-highlight" d="M-17-2Q-6-9 11-3" />
      <circle className="building-led" cx="-13" cy="40" r="2.5" strokeWidth="1.2" />
    </g>
  );
}

function Crate({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path className="sprite-light" d="M0 0 10-6 21 0 11 6Z" />
      <path className="sprite-accent" d="M0 0 11 6V18L0 12Z" />
      <path className="sprite-shade" d="M11 6 21 0V12L11 18Z" />
      <path className="sprite-seam" d="m5-3 11 6v6" />
    </g>
  );
}

function ModuleBlock({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path className="sprite-light" d="M0 0 20-11 40 0 20 11Z" />
      <path className="sprite-accent" d="M0 0 20 11V36L0 25Z" />
      <path className="sprite-shade" d="M20 11 40 0V25L20 36Z" />
      <path className="sprite-window" d="M6 10 14 14V22L6 18Z" />
      <path className="sprite-seam" d="m26 16 8-4m-8 9 8-4" />
      <circle className="building-led" cx="10" cy="7" r="2" strokeWidth="1" />
    </g>
  );
}

function Artwork({ type }: { type: NodeType }) {
  switch (type) {
    case "client":
      return (
        <g>
          <path className="sprite-accent" d="M25 23 77 43V79L25 59Z" />
          <path className="sprite-light" d="M25 23 34 18 86 38 77 43Z" />
          <path className="sprite-shade" d="M77 43 86 38V74L77 79Z" />
          <path className="sprite-screen" d="M32 34 70 49V67L32 52Z" />
          <path className="sprite-terminal" d="m40 42 6 6-6 2m12 4 9 3" />
          <path className="sprite-wall" d="M48 68V80L35 85 54 93 73 85 60 80V73Z" />
          <path className="sprite-light" d="M82 72 96 79V94L82 87Z" />
          <path className="sprite-window" d="m86 79 6 3v5l-6-3Z" />
          <circle className="building-led" cx="66" cy="72" r="2" />
        </g>
      );
    case "api":
      return (
        <g>
          <path className="sprite-wall" d="M24 40 61 60V94L24 74Z" />
          <path className="sprite-shade" d="M61 60 98 40V74L61 94Z" />
          <path className="sprite-accent" d="M20 37 61 14 102 37 61 60Z" />
          <path className="sprite-light" d="M20 37V44L61 67V60Z" />
          <path className="sprite-shade" d="M61 60 102 37V44L61 67Z" />
          <path className="sprite-wall" d="M48 25 62 17 78 26 64 34Z" />
          <path className="sprite-seam" d="m55 25 9 5m-3-9 10 5" />
          {[0, 1, 2].map((row) => (
            <g key={row} transform={`translate(0 ${row * 8})`}>
              <path className="sprite-screen" d="M31 51 52 62V68L31 57Z" />
              <circle className="building-led" cx="36" cy="56" r="1.8" strokeWidth=".8" />
              <path className="sprite-rack-slot" d="m42 58 6 3" />
            </g>
          ))}
          <path className="sprite-seam" d="m70 72 19-10m-19 17 19-10m-19 17 19-10" />
        </g>
      );
    case "database":
      return <StorageDrum x={60} y={26} />;
    case "replica":
      return (
        <g>
          <StorageDrum x={78} y={29} small />
          <StorageDrum x={43} y={48} small />
          <path className="sprite-replication" d="M43 27Q53 12 67 18m-7-3 7 3-3 7M79 79Q66 93 54 86m7 1-7-1 2-7" />
        </g>
      );
    case "cache":
      return (
        <g>
          <path className="sprite-wall" d="M23 51 61 72V94L23 73Z" />
          <path className="sprite-shade" d="M61 72 99 51V73L61 94Z" />
          <path className="sprite-accent" d="M19 47 61 24 103 47 61 70Z" />
          <path className="sprite-light" d="M19 47V53L61 76V70Z" />
          <path className="sprite-shade" d="M61 70 103 47V53L61 76Z" />
          <path className="sprite-light" d="m64 7-19 28 14 6-7 20 25-28-15-6 10-17Z" />
          {[0, 1, 2].map((slot) => <path key={slot} className="sprite-screen" d={`M${30 + slot * 9} ${61 + slot * 5}v10l5 3V${64 + slot * 5}Z`} />)}
          <circle className="building-led" cx="85" cy="70" r="3" />
        </g>
      );
    case "load-balancer":
      return (
        <g>
          <path className="sprite-wall" d="M23 48 61 69V92L23 71Z" />
          <path className="sprite-shade" d="M61 69 99 48V71L61 92Z" />
          <path className="sprite-accent" d="M17 43 61 18 105 43 61 68Z" />
          <path className="sprite-light" d="M17 43V49L61 74V68Z" />
          <path className="sprite-shade" d="M61 68 105 43V49L61 74Z" />
          <path className="sprite-network" d="m43 47 17-10m0 0 18 10M60 37V28" />
          <g className="sprite-port"><ellipse cx="43" cy="47" rx="5" ry="3" /><ellipse cx="78" cy="47" rx="5" ry="3" /><ellipse cx="60" cy="28" rx="5" ry="3" /></g>
          <path className="sprite-screen" d="m31 61 18 10v9L31 70Z" />
          <path className="sprite-network" d="m35 67 9 5" />
          <circle className="building-led" cx="80" cy="70" r="3" />
        </g>
      );
    case "queue":
      return (
        <g>
          <path className="sprite-wall" d="M24 44 59 63V93L24 74Z" />
          <path className="sprite-shade" d="M59 63 98 42V72L59 93Z" />
          <path className="sprite-accent" d="M19 42 37 17 74 37 59 64Z" />
          <path className="sprite-light" d="M37 17 76 7 104 39 74 37Z" />
          <path className="sprite-shade" d="M59 64 74 37 104 39 98 45Z" />
          <path className="sprite-screen" d="m66 66 23-12v24L66 90Z" />
          <path className="sprite-door-slats" d="m69 69 16-9m-16 15 16-9m-16 15 16-9" />
          <path className="sprite-wall" d="m12 75 31-17 16 9-31 18Z" />
          <path className="sprite-shade" d="M12 75V81L28 90 59 73V67L28 84Z" />
          <Crate x={18} y={62} />
          <Crate x={36} y={52} />
          <circle className="building-led" cx="36" cy="48" r="2.5" />
        </g>
      );
    case "worker":
      return (
        <g>
          <path className="sprite-shade" d="M74 18 85 12V51L74 57Z" />
          <path className="sprite-wall" d="M65 13 74 18V57L65 52Z" />
          <path className="sprite-light" d="M65 13 76 7 85 12 74 18Z" />
          <path className="sprite-wall" d="M23 49 60 69V94L23 74Z" />
          <path className="sprite-shade" d="M60 69 99 48V73L60 94Z" />
          <path className="sprite-accent" d="M20 47 33 25 46 40 58 18 73 33 83 23 103 47 60 71Z" />
          <path className="sprite-seam" d="m33 25 15 17m10-24 17 18" />
          <circle className="sprite-screen" cx="42" cy="65" r="10" />
          <g className="sprite-gear">
            <circle cx="42" cy="65" r="5" />
            <path d="M42 57V54m0 19v3M34 65H31m19 0h3M36 59l-2-2m14 14 2 2M36 71l-2 2m14-14 2-2" />
          </g>
          <path className="sprite-window" d="m69 68 8-4v10l-8 4Zm14-7 8-4v10l-8 4Z" />
          <circle className="building-led" cx="54" cy="80" r="2.5" />
        </g>
      );
    case "pubsub":
      return (
        <g>
          <path className="sprite-wall" d="M35 68 59 81V96L35 83Z" />
          <path className="sprite-shade" d="M59 81 85 67V82L59 96Z" />
          <path className="sprite-accent" d="M31 65 58 50 89 66 59 83Z" />
          <path className="sprite-tower" d="M40 67 60 19 80 67M47 50H73L52 37H68M40 67 73 50M80 67 47 50M60 19V70" />
          <circle className="sprite-accent" cx="60" cy="17" r="5" />
          <path className="sprite-signal" d="M46 9Q35 20 46 31M74 9Q85 20 74 31M36 3Q19 20 36 38M84 3Q101 20 84 38" />
          <path className="sprite-window" d="m41 77 10 5v6l-10-5Z" />
          <circle className="building-led" cx="74" cy="80" r="2.5" />
        </g>
      );
    case "archive":
      return (
        <g>
          <path className="sprite-wall" d="M25 43 60 62V94L25 75Z" />
          <path className="sprite-shade" d="M60 62 97 42V74L60 94Z" />
          <path className="sprite-accent" d="M20 38 59 16 102 39 61 62Z" />
          <path className="sprite-light" d="M20 38V47L61 70V62Z" />
          <path className="sprite-shade" d="M61 62 102 39V47L61 70Z" />
          <path className="sprite-light" d="m43 33 15-8 19 10-16 9Z" />
          <path className="sprite-seam" d="m51 33 11 6m-6-9 11 6" />
          <path className="sprite-screen" d="m32 56 20 11v21L32 77Z" />
          <path className="sprite-door-slats" d="m35 62 14 7m-14-1 14 7m-14-1 14 7" />
          <path className="sprite-window" d="m70 71 17-9v12l-17 9Z" />
          <path className="sprite-seam" d="m74 72 9-5" />
          <circle className="building-led" cx="88" cy="78" r="2" />
        </g>
      );
    case "service":
      return (
        <g>
          <ModuleBlock x={57} y={24} />
          <ModuleBlock x={23} y={45} />
          <ModuleBlock x={57} y={65} />
          <path className="sprite-network" d="m54 74 6 3m-3-18 7-4" />
        </g>
      );
  }
}
