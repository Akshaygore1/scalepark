# Plan 001: Teach system design by growing one link shortener

## Status and intent

- Status: DRAFT FOR DISCUSSION
- Category: direction
- Priority: P1
- Effort: L for the eventual curriculum revision
- Risk: MED because order controls unlocking, prerequisites, and saved progress
- Depends on: none
- Planned at: commit `229e2c8`, 2026-10-30

The user wants a beginner to learn system design topic by topic while building the product. They explicitly chose to remove the recurring "What breaks first?" question and start valid runs directly. This is a curriculum and experience proposal, not authorization to implement every proposed level or change the simulation engine.

## Current state and evidence

- `src/lib/curriculum/index.ts` assembles 32 levels in 12 modules. It also defines the sandbox, which should remain free of mandatory introductions.
- `src/lib/curriculum/types.ts` defines `LevelBase` with `concept`, `strapline`, `refresher`, and `journal`. Simulations separately have `brief`, `start`, `unlocks`, `scenario`, and outcome `targets`.
- `src/components/game/dialogs.tsx` renders opening lessons using `RefresherDialog`. It receives a lesson and step count, but no level topic or mission. Its final action says "Start planning" even when a before-quiz is still queued.
- `src/components/game/game-state.ts` initializes the opening lesson queue and an optional before-quiz. It records a building prediction and opens generic bottleneck-focused run notices.
- `src/components/game/game-screen.tsx` opens `PredictionDialog` on the first valid play in each mounted campaign simulation. Saved progress does not retain that prediction. The outcome compares it with first saturation.
- `src/components/game/panels.tsx` shows module title, level title, brief, and targets in `MissionRail`, but does not explicitly display `level.concept`.
- `src/lib/curriculum/m01-foundations.ts` starts with requirements classification questions, then a trade-off table using p95 before a dedicated explanation of how to read that metric. The table also includes a cache before the learner has built a system.
- `src/lib/curriculum/m02-simple-system.ts` puts request flow, API methods, redirect status codes, data shape, and building into `first-light`. `missing-index` has the broad concept label "Data access" despite teaching indexing.
- `m03-caching.ts`, `m04-scaling-servers.ts`, `m07-background-jobs.ts`, and `m12-distributed-problems.ts` contain levels that require several new fixes together.
- `m06-live-updates.ts` introduces live click counts before `m07-background-jobs.ts` introduces the cost of recording click analytics.
- `src/lib/curriculum/parks.ts` and each level's `start()` create prepared snapshots. Saved player parks are per level. The current application does not carry the player's architecture between levels.
- `src/lib/progress.ts` implements a linear previous-level completion gate in `isUnlocked`. Optional advanced branches require an explicit unlocking design.

Two excerpts to confirm before implementation:

```ts
// game-screen.tsx, play()
if (!isSandbox && state.attempts === 0 && state.prediction === null && predictionOptions.length > 0) {
  return dispatch({ type: "open", dialog: { kind: "prediction" } });
}
startRun();
```

```ts
// curriculum/types.ts
export type Lesson = { title: string; body: string; note: string };
// LevelBase currently contains:
concept: string;
refresher: Lesson[];
journal: Lesson;
```

## Learning principles

1. Get the learner to a small working product early. Start with a short product brief, then build client -> API -> database. Move detailed requirements classification and architecture comparisons after that concrete experience.
2. Teach one primary learning objective per level. Reuse learned concepts freely, but do not make an unexplained secondary fix necessary to pass.
3. Before each task, explain what already works, what changed, why that causes a problem, and which concept addresses it. The first building lesson is about creating a working system, not diagnosing a failure.
4. Introduce a plain-language meaning before its term: "how long a request takes" before "latency", and a concrete read example before "cache-aside".
5. Every new component must have a purpose in the scenario. Do not imply that every real system must eventually use every component.
6. Explain trade-offs as the learner observes them. Do not frame caching, replication, microservices, or more hardware as universally correct next steps.
7. Completing a level should mean demonstrating an outcome. Keep exact wiring and winning values in progressive hints.
8. Preserve useful technical depth in optional details and later practice. A concise introduction replaces the existing mandatory card sequence; it is not an extra popup before it.

## Proposed core sequence

These are learning stages, not final module numbers. A stage can contain several short levels.

| Order | What changes in the product | Topics in teaching order | Existing material |
| --- | --- | --- | --- |
| 1 | A customer needs a short link that opens the original page | Client, request and response, API, persistent database; build and run a minimal path | Shorten `the-brief`; introduce the building part of `first-light` early |
| 2 | The customer asks how fast, reliable, and expensive the service is | Requests per second, latency, success rate, budget; explain p95 with a set of 100 requests; then requirements and trade-offs | Revise `the-brief` and `everything-is-a-tradeoff`; add a guided measurement exercise |
| 3 | The system must find a destination as the links table grows | Short-code-to-URL data model, read/write paths, index | Separate essential API/data context from advanced HTTP choices in `first-light`; retain `missing-index` |
| 4 | The same popular links are opened repeatedly; later owners edit them | Cache lookup and miss, TTL and hit rate, then invalidation | `read-heavy`, `stale-links` |
| 5 | The API reaches its capacity; one bigger server is no longer enough | Vertical scaling, load balancing and horizontal scaling, then shared sessions/statelessness | `bigger-box`; split the new learning objectives in `second-server` |
| 6 | One server crashes while traffic continues | Health checks, then spare capacity | Split the new learning objectives in `server-dies` |
| 7 | More database reads arrive; copies lag; machines fail or data is deleted | Read replicas, read-your-writes, failover and durability, backups and recovery as distinct lessons | `read-replicas`, `just-created`, `primary-down`, `dropped-table` |
| 8 | Redirects now record clicks and visitors wait for analytics | Synchronous versus asynchronous work, queue and workers, backlog and processing capacity, duplicate-safe jobs, then failed-job handling | `analytics-flood`; split idempotency and dead letters in `runs-twice` |
| 9 | Customers want to watch the counts update | Polling versus push, connection limits, then pub/sub across servers | Move `live-counter` and `open-connections` after the analytics stage; separate scaling connections from fan-out if both are new |
| 10 | Bots consume capacity intended for visitors | Per-client rate limits and allowed bursts, then shared counters | `bot-attack`, `many-servers` |
| 11 | The learner can now design a complete small production-style service | Rebuild the core design from requirements and explain its trade-offs | Adapt `blank-page`; require only material already taught |

The learner still sees individual topics, not a long combined checklist for each stage.

## Advanced continuation

Place these after the core foundations and capstone, with prerequisites shown. Do not silently delete existing content.

| Track | Topics and existing levels | Prerequisites |
| --- | --- | --- |
| Handling variable demand | Autoscaling (`rush-hour`) | Capacity, horizontal scaling, spare capacity |
| Protecting a cache under spikes | Hot keys, request coalescing, TTL jitter (`going-viral`), split when both protections are new | Cache misses, TTL, database capacity |
| Growing data | Archiving (`cold-links`), partitioning (`partitioning`), sharding and shard keys (`the-hard-step`) | Indexes, read/write workload, primary and replicas; analytics before clicks partitioning |
| Services | Monolith and service boundary bridge; failure isolation (`bad-deploy`), boundaries (`chatty-services`), tracing (`reading-a-trace`) | A complete working service, queues, synchronous and asynchronous calls |
| Distributed failures | Timeouts, then fallbacks (`no-timeout`); retries and backoff, then circuit breakers (`retry-storm`) | Service calls, waiting versus computation, duplicate-safe operations |
| Concurrent updates | Contention and sharded counters (`hot-counter`); leases, then fencing (`expired-lock`) | Writes, concurrency explained locally, service failures |

Optional branches are a proposed product change. Before implementation, choose either explicit prerequisite-based unlocking or a clearly labeled linear advanced continuation. Existing `isUnlocked` cannot express branches.

## Per-level learning contract

For every existing, split, or new level, write an editorial record containing:

- Topic and one sentence stating what the learner can do afterward.
- Concepts the learner must already know.
- Prepared architecture and which known pieces it contains.
- What changed since the last relevant lesson and why the current design struggles.
- The new idea, in everyday language, followed by its technical name.
- The observable result the learner should watch in the simulation.
- The cost or limitation of that idea.
- Which controls are newly introduced, and which known controls are available.
- Opening text, progressive hints, success takeaway, and likely failure explanation.

Review existing scenario mechanics before writing any exact traffic, capacity, freshness, or recovery claims. Do not invent live observations: the introduction describes a scenario, while the result describes the actual run.

## Example: cache introduction

**Topic: Caching repeated link lookups**

Your link shortener now receives thousands of clicks each second. Many visitors open the same popular links. Each click still asks the database for the destination, and those repeated lookups are overwhelming it.

A cache keeps a temporary copy of a short code and its destination in fast memory. The API checks that copy first. If it is missing, the API reads the database and saves the answer for later.

Your mission: keep redirects fast and reliable within the budget. Watch how much read traffic still reaches the database.

Optional detail explains cache-aside, hit rate, and TTL. The next level starts: "Your cache reduced repeated lookups. Now link owners can edit destinations, but visitors sometimes receive the old cached address." That motivates invalidation.

## Learner experience

- Show topic, situation, explanation, and mission together in one short opening with a clear action appropriate to the next stage.
- Keep the topic visible in the mission panel and make the introduction reopenable.
- Offer optional deeper explanations instead of forcing several cards at every entry.
- Pressing Play starts a valid run without a prediction question. Remove prediction state, actions, comparison copy, obsolete styles, and README claims when implementing that change. Retain useful saturation diagnostics in run review.
- After a run, connect the primary objective to measured outcomes. Never claim the learner used a particular technique unless their actual architecture and run support it.
- Show prepared snapshots as such: "For this lesson, we start with..." Explain relevant changes. Do not claim a prepared park is the learner's previous saved design.
- Keep actual architecture carryover as a separate design decision. A coherent product story does not require introducing unpredictable starting states or carrying a learner's earlier mistakes into every later level.
- Use checkpoints that exercise design choices within the task. Remove repetitive terminology classification from the opening path; retain useful questions where their prerequisites have been taught.

## Implementation work to specify after curriculum agreement

1. Finalize the lesson matrix, prerequisite order, and core/advanced boundary. Map every current level id to retained, revised, moved, or split content. Fix misleading absolutes such as "personal dashboards cannot be cached" by explaining the scenario's freshness and reuse assumptions.
2. Draft the first working-system lesson, metric-reading lesson, and complete caching sequence as the reference writing style. Review these before expanding all 32 current levels.
3. Specify a shared introduction content shape in `curriculum/types.ts` and render it in both `GameScreen` and `QuizScreen`. Do not add a second parallel set of mandatory refreshers.
4. Implement direct run start and remove obsolete prediction UI/state. Update mission visibility, reopening, accessible controls, and narrow-screen layout using the existing CSS tokens and coach components.
5. Reorder and split levels only after checking scenario isolation. When one level currently contains two incidents, construct separate scenarios so each new concept is independently necessary. Write measured outcome explanations and hints together with the level text.
6. Define saved-progress compatibility before changing ids or unlocking. Retain stable ids for unchanged lessons; do not blindly award newly split learning objectives for an old completion. If persisted shapes change, update runtime validators and version handling in `progress.ts` and `park-file.ts` as applicable.
7. Update the campaign map, progress counts, README, and capstone requirements to reflect the final sequence. Newly moved advanced concepts must not remain unexplained capstone requirements.

Likely source scope for subsequent implementation: `src/lib/curriculum/`, `src/components/game/{dialogs,game-state,game-screen,panels}.tsx` with the actual `.ts` extension for `game-state`, `src/components/quiz-screen.tsx`, `src/components/campaign-map.tsx`, relevant `src/styles/` files, `src/lib/progress.ts`, and `README.md`. Include `evaluate.ts` only for actual measured feedback changes. Engine changes require a separate concrete specification rather than being inferred from this proposal.

## Verification and boundaries

This planning pass only reads source and writes under `plans/`. It does not run application checks or add tests.

Future implementation must follow `AGENTS.md`: Bun 1.3.2, React and plain CSS, `@/` imports, deterministic simulations, outcome-based win conditions, and no added tests. Run `bun run typecheck` and `bun run build` when validating the implementation. If scenarios, engine behavior, or level numbers change, use the required throwaway Bun balancing script outside the repository to check starting parks, intended fixes, and brute-force alternatives for every level. Do not weaken budgets to disguise a lesson with no clear causal fix.

Before implementation, compare `git diff --stat 229e2c8..HEAD -- src/lib/curriculum src/components/game src/components/quiz-screen.tsx src/components/campaign-map.tsx src/lib/progress.ts README.md` and recheck the excerpts above if they drifted. Stop for a curriculum decision if a proposed lesson requires a mechanic the engine cannot represent, unlocking branches have no chosen policy, or old progress cannot be preserved fairly.

The editorial review is complete when every lesson has its learning contract, its prerequisites occur earlier or are taught within the introduction, its new controls correspond to its stated objective, and its starting failure and intended fix demonstrate that objective. This is a human content review; a successful build alone cannot establish it.

## Open design choices, not blockers to discussion

- Exact count of levels after splitting combined concepts.
- Linear advanced continuation versus prerequisite-based optional tracks.
- The depth of HTTP and API design practice beyond the essential request path.

Keep DNS, TLS, CDN, consensus, and other possible expansions outside this revision unless a later product decision creates an honest task for them. They are not currently simulated learning objectives, and adding names alone would not teach them through building.
