# Tickets: ScaleLab V1

These tickets build the interactive URL-shortener system-design lab described in the [ScaleLab V1 PRD](/Users/akshay/.codex/attachments/f9d4051a-918a-4c9b-bb25-011dd0fe8bdd/pasted-text.txt).

Work the **frontier**: any ticket whose blockers are all done. Tickets are ordered with blockers before the work they unlock.

## T01 — Open the URL-shortener starter lab

**Status:** `ready-for-agent`

**What to build:** Replace the generic authenticated starter experience with a local-first ScaleLab lab. A learner can immediately understand the URL-shortener challenge, its objectives, the production-inspired disclaimer, and the intentionally underpowered starter architecture without creating an account or depending on the backend.

**Blocked by:** None — can start immediately.

- [ ] Opening the app presents the ScaleLab URL-shortener lab rather than the generic starter or login flow.
- [ ] The challenge briefing communicates duration, traffic objective, availability and latency targets, successful-throughput target, cost ceiling, and scoring context.
- [ ] The learner sees an intentionally underpowered starter architecture containing supported URL-shortener components.
- [ ] The experience clearly states that simulation results are educational and do not predict a production deployment.
- [ ] The lab shell establishes visible areas for the component palette, architecture canvas, configuration inspector, metrics, and timeline across supported viewport sizes.

## T02 — Edit and validate an architecture

**Status:** `ready-for-agent`

**What to build:** Let learners freely create a supported URL-shortener topology on a node canvas. They can add, connect, configure, duplicate, move, and remove components while receiving clear validation only when the graph cannot be interpreted.

**Blocked by:** T01 — Open the URL-shortener starter lab.

- [ ] The palette supports client, DNS/CDN, load balancer, API server, cache, primary database, read replica, queue, and worker components.
- [ ] Components can be placed freely, connected in arbitrary topologies, repositioned, duplicated, and removed.
- [ ] Selecting a component opens an inspector with the configuration fields relevant to that component type.
- [ ] Routing weights can be configured where a node distributes traffic across multiple outgoing paths.
- [ ] Risky but interpretable topologies remain runnable and are not rejected merely because they are likely to fail.
- [ ] Structurally uninterpretable graphs cannot run and receive actionable validation errors identifying the problem.
- [ ] The run result distinguishes runnable risky designs from uninterpretable designs through clear, externally observable validation behavior.

## T03 — Save, import, and export architecture designs

**Status:** `ready-for-agent`

**What to build:** Preserve a learner's architecture locally and allow it to be backed up or shared through a versioned JSON contract. Invalid data must be rejected before it can replace the current design.

**Blocked by:** T02 — Edit and validate an architecture.

- [ ] Architecture changes are saved locally and restored after a refresh without requiring an account.
- [ ] A learner can export the current architecture as versioned JSON and import a valid exported design.
- [ ] Export followed by import preserves the complete observable architecture and configuration.
- [ ] Malformed, unsupported-version, or schema-invalid imports are rejected with actionable errors.
- [ ] A failed import leaves the current architecture unchanged.
- [ ] Save/restore and import/export behavior consistently preserves valid designs and rejects invalid input without changing the current design.

## T04 — Run the deterministic starter simulation

**Status:** `ready-for-agent`

**What to build:** Run the current design through a framework-independent simulation hosted outside the UI thread. Given the same versioned architecture, scenario, commands, and seed, the starter design must produce the same timeline and fail reproducibly when its finite capacity is exceeded.

**Blocked by:** T01 — Open the URL-shortener starter lab; T02 — Edit and validate an architecture.

- [ ] The simulation consumes a versioned architecture, scenario definition, command schedule, and seed and returns snapshots, events, validation results, and an outcome.
- [ ] Request flow uses deterministic ticks and aggregated counts rather than one object per production request.
- [ ] Component throughput reflects replica count, capacity, concurrency, and service time, with excess demand becoming queued, in flight, dropped, or timed out.
- [ ] The starter scenario handles normal traffic and then reproducibly fails during its first capacity spike.
- [ ] Live availability, p95 latency, successful throughput, queue depth, and estimated provider-neutral cost are visible during a run.
- [ ] Running the same inputs repeatedly produces the same observable timeline and outcome.
- [ ] Observable request totals reconcile successful, queued, dropped, and in-flight work while respecting finite component capacity.

## T05 — Freeze, explain, and replay a failure

**Status:** `ready-for-agent`

**What to build:** When the architecture breaches an objective, freeze the relevant state and give the learner numerical causal evidence showing how the failure unfolded, while leaving diagnosis and repair decisions to the learner.

**Blocked by:** T04 — Run the deterministic starter simulation.

- [ ] A configured SLO breach freezes the scored run at the relevant failure point.
- [ ] The first saturated component is distinguished from downstream symptoms and highlighted on the architecture.
- [ ] The report quantifies queue growth, propagated latency, successful traffic, drops, and timeouts.
- [ ] Dropped and timed-out work is attributed to an observable cause where the engine has evidence.
- [ ] Traffic changes, incidents, saturation, recovery, and SLO breaches appear on a shared replayable timeline.
- [ ] Replaying a failure reproduces the recorded semantic health states and metrics.
- [ ] The initial report presents evidence and symptoms without immediately prescribing an intended architecture or fix.

## T06 — Repair capacity and cache bottlenecks

**Status:** `ready-for-agent`

**What to build:** Make application capacity and caching meaningful architectural levers. Learners can repair the starter bottleneck, but must also contend with cache eviction, viral hot-key pressure, cache failure, and stampede behavior.

**Blocked by:** T04 — Run the deterministic starter simulation.

- [ ] Replica count, component capacity, concurrency, and service time alter throughput, queueing, latency, and cost in explainable ways.
- [ ] Cache size and TTL produce deterministic hits, misses, eviction, and origin load effects.
- [ ] A viral hot URL creates uneven key pressure that is visible in component health and causal metrics.
- [ ] Cache failure or expiry can produce a deterministic stampede and increased downstream pressure.
- [ ] At least one thoughtful repaired architecture survives the baseline challenge without requiring unlimited capacity.
- [ ] The repaired architecture and the hot-key, cache-stampede, and cache-failure scenarios produce the intended deterministic outcomes.

## T07 — Model backpressure, retries, and database failure

**Status:** `ready-for-agent`

**What to build:** Let learners configure resilience controls and experience their trade-offs. Timeouts, retries, database connection limits, queues, and workers must affect failures and recovery rather than acting as decorative settings.

**Blocked by:** T04 — Run the deterministic starter simulation.

- [ ] Timeout and retry settings alter success, latency, dropped work, and amplified downstream traffic deterministically.
- [ ] Database connection limits create visible saturation and queueing when demand exceeds available connections.
- [ ] Queue capacity and worker throughput create measurable backlog, delayed work, and dropped messages.
- [ ] Database slowdown and database failure incidents propagate observable consequences through the request path.
- [ ] Nodes visibly transition through healthy, heating, saturated, queued, failed, and recovered semantic states as applicable.
- [ ] Retry amplification, database slowdown or failure, and queue overflow produce visible, deterministic consequences.

## T08 — Make placement and routing matter

**Status:** `ready-for-agent`

**What to build:** Make regional placement and traffic distribution observable design choices. Learners can assign components to regions and route traffic by weight, then see network and regional incidents alter latency and availability.

**Blocked by:** T04 — Run the deterministic starter simulation.

- [ ] Supported components can be assigned to a region and relevant outgoing routes accept configurable weights.
- [ ] Request latency includes deterministic network cost between regions along the selected path.
- [ ] DNS/CDN and load-balancer routing distribute aggregate traffic according to the configured topology and weights.
- [ ] A regional-latency incident visibly changes affected paths, p95 latency, SLO status, and recovery evidence.
- [ ] Region and active routing choices contribute transparently to the educational cost estimate.
- [ ] Weighted routing and regional latency produce visible, deterministic outcomes for a fixed scenario and seed.

## T09 — Model autoscaling and deployment delay

**Status:** `ready-for-agent`

**What to build:** Make scaling policies and runtime edits take simulated time. Learners can compare manual provisioning with autoscaling that may react late, overshoot, or oscillate, and can observe the consequences of removing active capacity.

**Blocked by:** T04 — Run the deterministic starter simulation.

- [ ] Autoscaling supports utilization threshold, minimum and maximum replicas, startup delay, and cooldown.
- [ ] Scale-out capacity becomes active only after its startup delay and visibly affects metrics when it arrives.
- [ ] Poor threshold and cooldown choices can deterministically react too late or oscillate.
- [ ] Runtime additions and configuration changes become effective only after their modeled deployment delay.
- [ ] Removing active capacity can affect in-flight work and attributes resulting failures to that change.
- [ ] Delayed scale-out, autoscaling oscillation, and removal of active capacity produce visible, deterministic outcomes.

## T10 — Experiment in pausable learning mode

**Status:** `ready-for-agent`

**What to build:** Provide a low-pressure mode where learners can pause the deterministic simulation, inspect the system, change traffic and architecture settings, and inject incidents manually to isolate individual behaviors.

**Blocked by:** T05 — Freeze, explain, and replay a failure; T06 — Repair capacity and cache bottlenecks; T07 — Model backpressure, retries, and database failure; T08 — Make placement and routing matter; T09 — Model autoscaling and deployment delay.

- [ ] Learning mode can be started, paused, resumed, reset, and stepped or inspected while paused.
- [ ] Learners can adjust traffic and observe the system cross capacity boundaries.
- [ ] Cache, database, and regional incidents can be injected independently and produce the same modeled semantics as scripted incidents.
- [ ] Architecture and configuration changes made during a run respect deployment and startup delays.
- [ ] Pausing preserves the current architecture, metrics, component health, queues, and timeline position.
- [ ] The visible learning journey supports opening the starter lab, editing a component, running, pausing, injecting an incident, and resuming.

## T11 — Survive the unpausable scored challenge

**Status:** `ready-for-agent`

**What to build:** Turn the simulation into a reproducible game. A fixed-seed, unpausable challenge escalates through the complete incident schedule and produces a transparent score that rewards balanced reliability, performance, recovery, and cost decisions.

**Blocked by:** T05 — Freeze, explain, and replay a failure; T06 — Repair capacity and cache bottlenecks; T07 — Model backpressure, retries, and database failure; T08 — Make placement and routing matter; T09 — Model autoscaling and deployment delay.

- [ ] Scored mode cannot be paused or manually alter traffic and incidents after the attempt starts.
- [ ] The data-driven schedule includes normal load, a traffic spike, viral hot URL, cache failure or stampede, database slowdown or failure, and regional latency.
- [ ] The same architecture, scenario version, commands, and seed always produce the same outcome and score.
- [ ] The score remains between 0 and 1,000 and visibly itemizes availability, p95 latency, successful throughput, recovery, cost, and applicable penalties.
- [ ] Educational cost derives from active component type, capacity, replicas, region, and simulated runtime and is not presented as a current provider quote.
- [ ] Unnecessary overprovisioning is penalized so unlimited capacity is not a winning strategy.
- [ ] The displayed score independently reflects every factor and applies the overprovisioning penalty.

## T12 — Request hints and retain attempt history

**Status:** `ready-for-agent`

**What to build:** Help stuck learners progress without erasing the value of independent diagnosis. Progressive hints carry transparent score penalties, and completed attempts, best score, replay data, and the failed architecture remain available locally.

**Blocked by:** T03 — Save, import, and export architecture designs; T11 — Survive the unpausable scored challenge.

- [ ] A learner can request deterministic symptom, implicated-subsystem, and possible-strategy hints one level at a time.
- [ ] Each hint displays and applies its published score penalty exactly once.
- [ ] Attempt history records the architecture version, scenario version, seed, outcome, score breakdown, requested hints, and replay data locally.
- [ ] The best score is retained and restored after refresh without an account.
- [ ] A learner can retry directly from the architecture that failed rather than rebuilding it.
- [ ] Restored attempts retain their score details, and each hint penalty is displayed and applied exactly once.

## T13 — Calibrate and harden the hackathon journey

**Status:** `ready-for-agent`

**What to build:** Turn the complete feature set into a polished, credible hackathon demonstration of design, break, inspect, repair, and survive. Calibrate the challenge so the starter fails clearly and multiple balanced repairs can win within the cost ceiling.

**Blocked by:** T10 — Experiment in pausable learning mode; T11 — Survive the unpausable scored challenge; T12 — Request hints and retain attempt history.

- [ ] Challenge objectives, component defaults, and incident timings are calibrated so the starter fails dramatically and multiple non-canonical repaired designs can succeed.
- [ ] The complete experience visibly covers the starter failure, successful repairs, overprovisioning, cache stampede, hot-key pressure, database failure, regional latency, retry amplification, autoscaling delay, and autoscaling oscillation.
- [ ] Every complete scenario preserves request conservation, capacity bounds, score bounds, and identical-input determinism.
- [ ] The visible journeys support editing, learning mode, a scored attempt, failure inspection, replay, hints, retry, and local restoration.
- [ ] Controls, node health, validation errors, metrics, and reports expose accessible names and semantic states without relying on color alone.
- [ ] The primary desktop demo path is visually polished and remains usable at the supported smaller viewport.
- [ ] The final experience consistently demonstrates failure diagnosis and repair without claiming production forecasting accuracy.
