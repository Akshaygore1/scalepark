import { servicePark } from "./parks";
import type { CurriculumModule } from "./types";

const callFeatures = ["capabilities", "size", "instances", "async", "timeouts"] as const;

export const distributedProblems: CurriculumModule = {
  number: 12,
  title: "Problems in distributed systems",
  summary: "Calls hang, retries pile up, hot rows lock, and locks expire. Basic defenses for each.",
  levels: [
    {
      kind: "sim",
      id: "no-timeout",
      module: 12,
      code: "12.1",
      title: "No Timeout",
      strapline: "Billing stopped answering. Redirects, which never touch billing, went down too.",
      concept: "Timeouts and fallbacks",
      brief: "Billing will hang for 20 seconds. Keep redirects up, and keep dashboards loading even while billing is gone.",
      refresher: [
        {
          title: "A hung call is worse than a failed one",
          body: "A call that fails returns at once. A call that hangs holds a thread, a connection, and memory while it waits. Each service can only hold so many requests at once.",
          note: "Requests in flight = arrival rate × time each one waits. Waiting forever means running out.",
        },
        {
          title: "Give up on purpose",
          body: "A timeout bounds how long any call can hold resources. When it fires, the caller can fail that one request, or fall back to a sensible default, like treating the account as being on the free plan.",
          note: "Set timeouts a little above the slowest normal answer, not at the default of forever.",
        },
      ],
      journal: {
        title: "Timeouts bound the damage, fallbacks hide it",
        body: "Without a timeout, one hung dependency fills the caller's threads and every request fails, even ones that never needed it. A timeout limits the cost to the requests that use the dependency; a fallback keeps even those working, degraded.",
        note: "Every remote call needs a timeout. Decide up front what the caller does when it fires.",
      },
      unlocks: { nodes: ["service"], features: [...callFeatures, "fallback"] },
      start: () =>
        servicePark(
          { capabilities: ["links", "accounts"], size: "L", instances: 2 },
          { capabilities: ["billing"], size: "M", instances: 1 },
        ),
      scenario: {
        kind: "services",
        durationSeconds: 60,
        operations: [
          { id: "redirect", label: "Redirects", rate: [[0, 2_000]], steps: ["links"] },
          { id: "dashboard", label: "Dashboards", rate: [[0, 200]], steps: ["accounts", "billing"] },
        ],
        incidents: [{ at: 20, type: "hang", capability: "billing", duration: 20 }],
      },
      targets: [
        { kind: "operation-availability", operation: "redirect", label: "Redirects", min: 0.999 },
        { kind: "operation-availability", operation: "dashboard", label: "Dashboards", min: 0.99 },
        { kind: "budget", maxMonthly: 600 },
      ],
      par: { monthly: 490, complexity: 2 },
      finalHint: [
        "Select the service that runs Links and Accounts and open its Routes out section.",
        "On the route to Billing, keep Call at Wait for the answer, set Timeout to 500 ms, and turn on Fallback on failure.",
        "Keep the entry service at L with 2 instances, Billing at M with 1 instance, and all existing routes.",
      ],
      hints: [
        "When billing hangs, the app runs out of threads, so redirects are turned away too.",
        "Dashboard requests wait on billing forever, and each one holds an app thread while it waits.",
        "Set a timeout on the route to billing, around 500 ms, and turn on its fallback so dashboards assume the free plan.",
      ],
    },
    {
      kind: "sim",
      id: "retry-storm",
      module: 12,
      code: "12.2",
      title: "Retry Storm",
      strapline: "Links blipped for three seconds. Then it stayed down for a minute.",
      concept: "Retries, backoff, circuit breakers",
      brief: "Links fails 3% of calls at random, and will crash for 3 seconds. Retry the random failures without burying links when it comes back.",
      refresher: [
        {
          title: "Retries fix blips",
          body: "Some failures are momentary: a dropped packet, a server restarting. Trying again a moment later usually works, so a retry turns a small failure rate into almost none.",
          note: "Only retry calls that are safe to repeat, like reads or idempotent writes.",
        },
        {
          title: "Retries multiply load",
          body: "When a service is down, every call fails, and every failure is retried. Three immediate retries send four times the traffic to a service that is just coming back. It falls over again, and the retries keep it there.",
          note: "Back off: wait longer after each failure, add jitter so callers do not retry together, and cap retries at a small share of traffic.",
        },
      ],
      journal: {
        title: "Retry with backoff, and know when to stop",
        body: "Retries hide transient errors but amplify outages. Exponential backoff with jitter spreads retries out, a retry budget caps the extra load, and a circuit breaker stops calling a service that keeps failing so it can recover.",
        note: "A system that stays down after the cause is gone is in a retry storm. Look at the retry rate, not just the error rate.",
      },
      unlocks: { nodes: ["service"], features: [...callFeatures, "retries", "circuit-breaker"] },
      start: () =>
        servicePark(
          { capabilities: ["accounts"], size: "L", instances: 2 },
          { capabilities: ["links"], size: "M", instances: 3, call: { timeoutMs: 300, retries: 3 } },
        ),
      scenario: {
        kind: "services",
        durationSeconds: 90,
        operations: [
          { id: "redirect", label: "Redirects", rate: [[0, 1_800]], steps: ["links"] },
          { id: "create", label: "New links", rate: [[0, 40]], steps: ["accounts", "links"] },
        ],
        params: { transientErrors: { links: 0.03 } },
        incidents: [{ at: 20, type: "crash", capability: "links", duration: 3 }],
      },
      targets: [
        { kind: "availability", min: 0.95 },
        { kind: "p95", maxMs: 100 },
        { kind: "budget", maxMonthly: 900 },
      ],
      par: { monthly: 800, complexity: 2 },
      finalHint: [
        "Select the Accounts service and open its Routes out section.",
        "On the route to Links, keep Timeout at 300 ms and Retries at 3. Turn on Backoff with jitter and Circuit breaker.",
        "Keep Accounts at L with 2 instances, Links at M with 3 instances, and all existing routes.",
      ],
      hints: [
        "Links comes back after 3 seconds, but stays overloaded until the end of the run.",
        "Every failed call is retried three times at once, so links gets four times its normal traffic the moment it returns.",
        "Keep retries for the random errors, but turn on backoff with jitter. A circuit breaker also helps links recover.",
      ],
    },
    {
      kind: "sim",
      id: "hot-counter",
      module: 12,
      code: "12.3",
      title: "Hot Counter",
      strapline: "A link went viral. Its click count fell further and further behind.",
      concept: "Contention and sharded counters",
      brief: "Clicks will triple during a viral spike. Count every click within 10 seconds, and catch up by the end.",
      refresher: [
        {
          title: "One row, one line",
          body: "Every click adds one to the total. Two writers cannot change the same row at the same moment, so they take turns on the row's lock. A single row only takes so many writes per second, however big the server.",
          note: "Bigger or more servers do not help when everyone waits for the same row.",
        },
        {
          title: "Split the counter",
          body: "Keep the total as several rows and add each click to one of them. Writers spread across rows, so they rarely wait for each other. Reading the total means adding the rows up.",
          note: "Sharded counters trade a slightly more expensive read for many more writes.",
        },
      ],
      journal: {
        title: "Spread contended writes",
        body: "Contention on one record caps throughput regardless of hardware. Split hot counters into shards, write to one shard at a time, and sum on read.",
        note: "The same idea applies to hot locks, hot queues, and hot partitions: find the single thing everyone waits for.",
      },
      unlocks: { nodes: ["service"], features: ["capabilities", "size", "instances", "async", "counter-shards"] },
      start: () =>
        servicePark(
          { capabilities: ["links"], size: "L", instances: 3 },
          { capabilities: ["analytics"], size: "M", instances: 3, call: { mode: "async" } },
        ),
      scenario: {
        kind: "services",
        durationSeconds: 60,
        operations: [
          { id: "redirect", label: "Redirects", rate: [[0, 900]], steps: ["links", "analytics"] },
          {
            id: "viral",
            label: "Viral link",
            rate: [[0, 0], [12, 0], [15, 2_400], [35, 2_400], [38, 0]],
            steps: ["links", "analytics"],
            hot: true,
          },
        ],
      },
      targets: [
        { kind: "availability", min: 0.995 },
        { kind: "analytics-delay", maxSeconds: 10 },
        { kind: "backlog-drained" },
        { kind: "budget", maxMonthly: 900 },
      ],
      par: { monthly: 870, complexity: 3 },
      finalHint: [
        "Select the Analytics service and set Counter rows to 4.",
        "Keep Links at L with 3 instances and Analytics at M with 3 instances.",
        "Keep Clients → Links service → Analytics service connected, with the Analytics route set to Send a message (queued).",
      ],
      hints: [
        "Analytics has spare servers, yet clicks wait longer and longer during the spike.",
        "Every click updates the same counter row, which takes about 1,000 writes per second.",
        "Spread the counter across more rows in the analytics service's settings.",
      ],
    },
    {
      kind: "sim",
      id: "expired-lock",
      module: 12,
      code: "12.4",
      title: "Expired Lock",
      strapline: "Two customers paid for the same custom alias.",
      concept: "Leases and fencing tokens",
      brief: "A server will pause while holding alias locks, and another will crash while holding them. Never give one alias to two people, and keep claims flowing.",
      refresher: [
        {
          title: "Locks need leases",
          body: "A server that takes a lock and then crashes never releases it. So distributed locks are leases: they expire after a few seconds unless renewed.",
          note: "Short leases free crashed holders' locks quickly. Long leases keep those aliases stuck.",
        },
        {
          title: "The holder cannot tell it stopped",
          body: "A garbage-collection pause or a slow clock can freeze a server longer than its lease. Its lock expires, someone else takes it, and then the paused server wakes up and writes as if it still held it.",
          note: "A fencing token is a number that grows with every lease. Storage rejects a write carrying an older token than one it has already seen.",
        },
      ],
      journal: {
        title: "Leases plus fencing",
        body: "Leases keep crashed holders from blocking forever, but no lease is long enough to rule out a pause. Fencing tokens let the storage, not the lock holder, decide whether a write is still valid.",
        note: "Never trust a lock holder's sense of time. Make the resource check the token.",
      },
      unlocks: { nodes: ["service"], features: ["capabilities", "size", "instances", "timeouts", "locks"] },
      start: () =>
        servicePark(
          { capabilities: ["links"], size: "L", instances: 2 },
          { capabilities: ["locks"], size: "S", instances: 1, leaseSeconds: 10, call: { timeoutMs: 200 } },
        ),
      scenario: {
        kind: "services",
        durationSeconds: 60,
        operations: [
          { id: "redirect", label: "Redirects", rate: [[0, 1_500]], steps: ["links"] },
          { id: "claim", label: "Alias claims", rate: [[0, 100]], steps: ["locks", "links"] },
        ],
        params: { contestedShare: 0.3 },
        incidents: [
          { at: 18, type: "pause", duration: 6 },
          { at: 40, type: "holder-crash" },
        ],
      },
      targets: [
        { kind: "double-claims", max: 0 },
        { kind: "operation-availability", operation: "claim", label: "Alias claims", min: 0.98 },
        { kind: "availability", min: 0.995 },
      ],
      par: { monthly: 440, complexity: 2 },
      finalHint: [
        "On the Alias locks service, set Lock lease to 2 s.",
        "On the Links service, turn on Check fencing tokens.",
        "Keep Links at L with 2 instances and Alias locks at S with 1 instance. Keep the existing route to Alias locks with Timeout 200 ms.",
      ],
      hints: [
        "After the crash, popular aliases stay locked for a long time, and claims for them fail.",
        "The lease is long enough to outlast the pause, so it also outlasts a crashed holder. A shorter lease lets the paused server's lock expire.",
        "Use a short lease, about 2 seconds, and turn on fencing token checks where links are written.",
      ],
    },
  ],
};
