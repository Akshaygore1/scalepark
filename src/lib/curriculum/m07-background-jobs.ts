import { standardPark, type ParkSpec } from "./parks";
import type { CurriculumModule } from "./types";

const fleet: ParkSpec = {
  "load-balancer": { healthChecks: true },
  api: { size: "L", instances: 2, sessions: "shared" },
  database: { size: "M" },
  cache: { ttlSeconds: 120, invalidateOnWrite: true },
};

const clickTraffic = {
  redirects: [[0, 2_200], [10, 2_200], [14, 3_400], [30, 3_400], [34, 1_800], [50, 1_800]],
  creates: [[0, 20]],
} as const;

export const backgroundJobs: CurriculumModule = {
  number: 7,
  title: "Background jobs",
  summary: "Move slow work to queues and workers, and make jobs safe when they run twice.",
  levels: [
    {
      kind: "sim",
      id: "analytics-flood",
      module: 7,
      code: "7.1",
      title: "Analytics Flood",
      strapline: "Every redirect now records a click. Redirects got slow.",
      concept: "Queues and workers",
      brief: "Each redirect writes a click row before answering. Keep redirects fast and get every click counted within 10 seconds.",
      refresher: [
        {
          title: "Not everything belongs in the request",
          body: "The visitor only needs to be redirected. Recording the click can happen a moment later, without making them wait for a database write.",
          note: "Put the job on a queue, answer the visitor, and let a worker do the work in the background.",
        },
        {
          title: "Workers set the drain rate",
          body: "Workers pull jobs off the queue as fast as they can process them. Background workers can also batch: write a hundred clicks in one statement instead of a hundred statements.",
          note: "If jobs arrive faster than workers finish them, the backlog grows. Watch the delay between a click and when it is counted.",
        },
      ],
      journal: {
        title: "Queues decouple accepting work from doing it",
        body: "A queue lets the request finish quickly while workers process jobs in the background, often in efficient batches. The cost is eventual consistency: results appear a little later.",
        note: "Size workers for the peak arrival rate, or accept a backlog that drains after the peak.",
      },
      unlocks: {
        nodes: ["api", "database", "cache", "load-balancer", "queue", "worker"],
        features: ["size", "instances", "health-checks", "sessions", "ttl", "invalidate"],
      },
      start: () => standardPark(fleet),
      scenario: {
        durationSeconds: 50,
        traffic: clickTraffic,
        clicks: true,
        data: { linkRows: 5_000_000 },
      },
      targets: [
        { kind: "availability", min: 0.995 },
        { kind: "p95", maxMs: 80 },
        { kind: "analytics-delay", maxSeconds: 10 },
        { kind: "backlog-drained" },
        { kind: "budget", maxMonthly: 900 },
      ],
      par: { monthly: 875, complexity: 6 },
      finalHint: [
        "Build a message queue and a worker building. Set Workers to 5.",
        "Connect API server → Message queue → Workers → Database.",
        "Keep the direct API server → Database route as well as the cache and load balancer routes.",
        "Keep two L API servers, the M database, and S cache with Time to live 120 s and Invalidate on write on.",
      ],
      hints: [
        "Redirects are slow because each one waits for a database write.",
        "Click recording does not need to happen before the visitor is redirected.",
        "Route the API to a queue, the queue to workers, and the workers to the database. Run enough workers for the peak.",
      ],
    },
    {
      kind: "sim",
      id: "runs-twice",
      module: 7,
      code: "7.2",
      title: "Runs Twice",
      strapline: "A worker crashed. Some clicks were counted twice. One job never finishes.",
      concept: "Idempotency",
      brief: "Workers will crash and bad jobs will arrive. Count every click exactly once and keep the queue moving.",
      refresher: [
        {
          title: "At-least-once delivery",
          body: "If a worker crashes after doing a job but before confirming it, the queue hands the job to another worker. Delivery is at least once, so a job can run twice.",
          note: "An idempotent job has the same effect whether it runs once or five times. Give each click an ID and skip IDs you have already recorded.",
        },
        {
          title: "Poison messages",
          body: "A malformed job fails every time. If it is retried forever, it keeps coming back and eats worker time that real jobs need.",
          note: "A dead-letter queue takes a job out of rotation after a few failed attempts, so a person can inspect it later.",
        },
      ],
      journal: {
        title: "Idempotent jobs and dead letters",
        body: "Assume every job may run more than once, and make running it twice harmless. Cap retries and move repeat failures to a dead-letter queue.",
        note: "Idempotency costs a lookup per job. It is much cheaper than explaining double billing.",
      },
      unlocks: {
        nodes: ["api", "database", "cache", "load-balancer", "queue", "worker"],
        features: ["size", "instances", "health-checks", "sessions", "ttl", "invalidate", "idempotent", "dead-letter"],
      },
      start: () => standardPark({ ...fleet, queue: {}, worker: { instances: 5 } }),
      scenario: {
        durationSeconds: 50,
        traffic: clickTraffic,
        clicks: true,
        data: { linkRows: 5_000_000 },
        params: { poisonPerSecond: 2 },
        incidents: [{ at: 22, type: "worker-crash" }],
      },
      targets: [
        { kind: "availability", min: 0.995 },
        { kind: "p95", maxMs: 80 },
        { kind: "duplicates", max: 0 },
        { kind: "analytics-delay", maxSeconds: 10 },
        { kind: "backlog-drained" },
        { kind: "budget", maxMonthly: 900 },
      ],
      par: { monthly: 875, complexity: 6 },
      finalHint: [
        "On the message queue, turn on Dead-letter queue.",
        "On the workers, turn on Idempotent jobs and keep Workers at 5.",
        "Keep two L API servers, the M database, S cache, and all existing routes, including API server → Message queue → Workers → Database.",
      ],
      hints: [
        "Click counts come out too high after the crash, and the queue slowly stops draining.",
        "Redelivered jobs are processed again, and a few broken jobs are retried forever.",
        "Make workers idempotent and turn on the dead-letter queue.",
      ],
    },
  ],
};
