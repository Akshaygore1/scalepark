# ScaleLab Park

> Learn system design by running the system.

ScaleLab Park is a browser-based, 2D system-design tycoon game. Build request paths, grow infrastructure under load, and learn why architectures fail by watching traffic move through them.

Play through a five-chapter campaign with a persistent park, or use the sandbox to experiment with traffic, failures, and architecture choices without a win condition.

## How it plays

The core loop turns system-design diagrams into systems you can operate:

1. **Build** infrastructure with a limited budget.
2. **Route** traffic between clients, edge services, compute, storage, and asynchronous workers.
3. **Simulate** changing request volume and timed incidents.
4. **Diagnose** bottlenecks through live throughput, latency, availability, utilization, queue, cost, and event data.
5. **Iterate** from a checkpoint until the design meets the chapter's reliability, performance, and cost objectives.

The campaign introduces one major idea at a time while carrying completed infrastructure, upgrades, cash, and unlocked lessons into later chapters.

## Campaign

| Chapter | Mission | System-design focus | Peak traffic |
| ---: | --- | --- | ---: |
| 1 | Opening Day | Capacity and queues | 3,600 req/s |
| 2 | The First Spike | Horizontal scaling and load balancing | 8,000 req/s |
| 3 | The Viral Link | Caching, CDNs, TTLs, and hot keys | 14,000 req/s |
| 4 | Cascading Trouble | Backpressure, queues, workers, and retry control | 16,000 req/s |
| 5 | Global Launch | Regions, DNS, and weighted global routing | 18,000 req/s |

## Features

- **Persistent campaign:** each successful chapter carries the park and its economy into the next mission.
- **Open sandbox:** all component types are unlocked, with selectable traffic levels and incident injection.
- **Infrastructure economics:** balance construction costs, operating costs, revenue, cash, and reputation rather than scaling without limits.
- **Incident simulation:** model hot keys, cache failures, database slowdowns, database failures, and regional latency.
- **Live operational metrics:** inspect request flow, throughput, p95 latency, availability, utilization, queue growth, health, and cost while the simulation runs.
- **Deterministic challenge scoring:** evaluate availability, latency, throughput, recovery, and cost discipline for a score out of 1,000, with penalties for overprovisioning and hints.
- **Failure diagnosis:** see the first bottleneck and the downstream queue and latency effects after a failed run.
- **Checkpoints:** retry the current mission from its starting state and revise the architecture before resuming traffic.
- **System-design journal:** collect concise lessons as concepts are encountered in the campaign.
- **Architecture portability:** export a park as versioned JSON and import a compatible design through the game UI.

## Simulation scale

- 10 component types: Client, DNS, CDN, Load Balancer, API Server, Cache, Primary Database, Read Replica, Queue, and Worker
- 4 deployment regions: `us-east`, `us-west`, `eu-west`, and `ap-south`
- 5 modeled incident types
- Traffic scenarios up to 18,000 requests per second
- A scored final challenge worth up to 1,000 points

## Technology

- React 19 and TypeScript
- Vite 7
- React Router 8
- Bun for package management and scripts
- A Web Worker for the live simulation loop
- Tailwind CSS 4
- shadcn and Base UI primitives

## Run locally

### Prerequisites

Install [Bun](https://bun.sh/). The repository declares Bun 1.3.2 as its package manager.

### Installation

```bash
bun install
```

### Development

```bash
bun run dev
```

Open [http://localhost:5173](http://localhost:5173). Vite prints the active URL if that port is unavailable.

### Build and preview

```bash
bun run build
bun run preview
```

The build command writes the production bundle to `dist/`; preview serves that bundle locally.

### Type-check

```bash
bun run typecheck
```

### Tests

```bash
bun run test
bun run test:e2e
```

`bun run test` runs the Bun unit tests under `src/lib`. `bun run test:e2e` runs the Playwright campaign suite; its configuration starts a production build and preview server as needed.

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Campaign map and saved-progress overview |
| `/game/opening-day` | Chapter 1: Opening Day |
| `/game/first-spike` | Chapter 2: The First Spike |
| `/game/viral-link` | Chapter 3: The Viral Link |
| `/game/cascading-trouble` | Chapter 4: Cascading Trouble |
| `/game/global-launch` | Chapter 5: Global Launch |
| `/game/sandbox` | Free-build sandbox |

Unknown chapter IDs redirect to the campaign map. Other unknown routes render the in-app not-found page.

## Browser storage

ScaleLab Park is fully client-side and does not require an account or backend. It uses browser `localStorage` for:

| Key | Stored data |
| --- | --- |
| `scalelab:tycoon-progress` | Completed chapters, encountered lessons, claimed rewards, and the persistent campaign park |
| `scalelab:attempt-history` | Challenge attempts and the best recorded score |
| `scalelab:architecture` | A legacy saved architecture that can be read when migrating older local progress |

Storage is scoped to the current browser profile and origin. Clearing site data, using another browser, or opening the app on a different origin starts with fresh local progress. Architecture export/import is the explicit way to move an individual design as JSON; it does not transfer the complete campaign or attempt history.

## Project structure

```text
src/
├── components/          Game UI and reusable interface components
├── lib/                 Architecture, campaign, simulation, scoring, and persistence logic
├── routes/              Campaign-map and parameterized game routes
├── workers/             Web Worker entry point for live simulation
├── router.tsx           Browser route configuration
└── main.tsx             React application entry point
tests/                   Playwright campaign suite
public/                  Static assets
```

## Educational simulation

ScaleLab Park is an educational, provider-neutral simulation. Its traffic model, incidents, costs, and scoring are simplified to make system-design trade-offs visible; they are not production capacity estimates, cloud-provider quotes, or a substitute for load testing and reliability analysis of a real system.
