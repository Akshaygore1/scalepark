# ScaleLab Park

> Learn system design by running the system.

ScaleLab Park is a browser-based system-design game. You build and operate a link shortener as a little technology park: place buildings, route traffic between them, run the park, and watch where it struggles.

The campaign teaches system design one idea at a time, from requirements to a full design on a blank page.

## How a level works

1. **Read the brief.** Mina, the park's systems coach, explains the idea the level teaches.
2. **Predict.** Before the first run, guess which building breaks first.
3. **Run.** Traffic plays out second by second. The starting park is built to fail in a way that shows the lesson.
4. **Diagnose.** The outcome explains what ran out of headroom first and why each target was missed. Run review lets you scrub through every second.
5. **Revise and rerun** until every target passes.

Levels are won on outcomes, never on following steps: availability, p95 latency, a monthly budget, and correctness targets such as stale redirects, lost writes, or double-counted jobs. Budgets are set so that throwing money at the problem fails.

Stars reward lean designs: one for passing, two for staying at or under the par cost, three for also staying at or under the par complexity.

## Curriculum

| Module | Levels |
| --- | --- |
| 1. What is system design? | The Brief (requirements), Everything Is a Trade-off |
| 2. Start with a simple system | First Light (API and data design), The Missing Index |
| 3. Caching | Read Heavy, Stale Links (invalidation), Going Viral (hot keys and stampedes) |
| 4. When one server isn't enough | Bigger Box, The Second Server (stateless servers), A Server Dies (N+1, health checks), Rush Hour (autoscaling) |
| 5. When one database isn't enough | Read Replicas, Just Created, Not Found (replication lag), Primary Down (failover), Oops, Dropped Table (backups, RPO, RTO) |
| 6. Live updates | Live Click Counter (polling versus push), Open Connections (pub/sub fan-out) |
| 7. Background jobs | Analytics Flood (queues and workers), Runs Twice (idempotency, dead letters) |
| 8. Rate limiting | Bot Attack (token buckets), Many Servers (shared counters) |
| 9. Growing big | Cold Links (archiving), Partitioning, The Hard Step (sharding) |
| 10. Putting it together | Blank Page: a full design, scored out of 1,000 |

Module 1 and parts of module 2 are design questions. Every other level is a simulation. The sandbox unlocks every building and setting, with a traffic lab and incident switches.

## Simulation

The simulation is deterministic and runs in the browser in a few milliseconds per run. Each second it moves traffic through the park's request paths: rate limiting, load balancing, API servers, cache, replicas, the primary database or its shards, and the queue and workers. Latency rises sharply as a building nears full capacity, work that waits too long times out, and incidents such as crashed servers, failed primaries, or dropped tables play out on a fixed schedule.

It is an educational model. Its numbers are simplified to make trade-offs visible; they are not capacity estimates or cloud prices.

## Run locally

Install [Bun](https://bun.sh/) (the repository declares Bun 1.3.2), then:

```bash
bun install
bun run dev
```

Open [http://localhost:5173](http://localhost:5173).

```bash
bun run typecheck   # TypeScript check (Vite does not type-check)
bun run build       # production bundle in dist/
bun run preview     # serve the production bundle
```

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Campaign map |
| `/game/<level-id>` | A level, for example `/game/read-heavy` |
| `/game/sandbox` | Free-build sandbox |

Locked or unknown levels redirect to the campaign map.

## Browser storage

Progress lives in `localStorage` under `scalelab:progress`: completed levels, stars, the capstone's best score, and your latest park for each level. Parks can also be exported and imported as JSON from the game screen.

## Project structure

```text
src/
├── components/          Campaign map, game screen, dialogs, park map, inspector
├── lib/
│   ├── curriculum/      Levels, one file per module
│   ├── model.ts         Buildings, settings, capacities, and costs
│   ├── topology.ts      Validation and request-path resolution
│   ├── simulation.ts    The per-second engine
│   ├── evaluate.ts      Targets, stars, and the capstone score
│   └── progress.ts      Saved progress
├── styles/              Park styles
└── routes/              Campaign map and level routes
```
