import { features, nodeTypes } from "../model";
import { clientsOnly } from "./parks";
import type { CurriculumModule } from "./types";

export const capstone: CurriculumModule = {
  number: 10,
  title: "Putting it together",
  summary: "Design a whole system from a blank page and explain your choices.",
  levels: [
    {
      kind: "sim",
      id: "blank-page",
      module: 10,
      code: "10",
      title: "Blank Page",
      strapline: "Launch day for the whole product. Only the clients are here.",
      concept: "End-to-end design",
      capstone: true,
      brief: "Design the full link shortener: fast redirects, live counters, click analytics, and protection from bots, through a viral spike and a crashed server.",
      refresher: [
        {
          title: "Work from the requirements",
          body: "Read the targets as requirements. Estimate the load each one implies, start with the simplest design, run it, and let the first bottleneck tell you what to add next.",
          note: "You have every building and every setting. That does not mean you need them all: complexity counts against your stars.",
        },
      ],
      journal: {
        title: "Design is iteration",
        body: "Start simple, measure, fix the first bottleneck, and repeat. State each trade-off as you make it.",
        note: "You now know the core of Part 1: requirements, caching, scaling servers and databases, live updates, background jobs, rate limiting, and growth.",
      },
      unlocks: { nodes: nodeTypes.filter((type) => type !== "client" && type !== "service"), features: [...features] },
      start: clientsOnly,
      scenario: {
        durationSeconds: 60,
        traffic: {
          redirects: [[0, 2_200], [15, 2_400], [22, 5_200], [40, 5_400], [50, 3_000], [60, 2_800]],
          hotKey: [[0, 0], [20, 0], [22, 4_000], [42, 4_000], [48, 0]],
          creates: [[0, 60]],
          edits: [[0, 15]],
          dashboard: [[0, 300]],
          viewers: [[0, 4_000], [22, 14_000], [45, 8_000]],
          bots: [[0, 0], [30, 20], [40, 20], [44, 0]],
        },
        clicks: true,
        data: { linkRows: 20_000_000 },
        params: { poisonPerSecond: 1, hotEditEvery: 9 },
        incidents: [
          { at: 28, type: "api-crash" },
          { at: 46, type: "worker-crash" },
        ],
      },
      targets: [
        { kind: "availability", min: 0.99 },
        { kind: "p95", maxMs: 100 },
        { kind: "stale-reads", max: 200 },
        { kind: "not-found", max: 50 },
        { kind: "logged-out", max: 0 },
        { kind: "duplicates", max: 0 },
        { kind: "bots-passed", maxRps: 200 },
        { kind: "viewers-connected", min: 0.99 },
        { kind: "missed-updates", max: 0.01 },
        { kind: "freshness", maxSeconds: 2 },
        { kind: "analytics-delay", maxSeconds: 15 },
        { kind: "backlog-drained" },
        { kind: "budget", maxMonthly: 1_800 },
      ],
      par: { monthly: 1_700, complexity: 9 },
      hints: [
        "Run the simplest design first and read which target fails.",
        "Each target maps to a module: latency to caching and scaling, live counters to push and pub/sub, clicks to queues, bots to rate limits.",
        "Balancer with health checks and N+1 servers, cache with invalidation, coalescing, and jitter, push with pub/sub, queue with idempotent workers and a dead-letter queue, and a shared token bucket.",
      ],
      after: [
        {
          prompt: "Why do clicks go through a queue instead of being written during the redirect?",
          options: [
            {
              label: "Visitors only need the redirect; counting can happen moments later, in batches",
              correct: true,
              explanation: "Right. The queue takes slow work out of the request path, at the cost of counts arriving slightly later.",
            },
            {
              label: "Queues make the database faster",
              correct: false,
              explanation: "The database does the same kind of work. The queue changes when it happens and lets workers batch it.",
            },
          ],
        },
        {
          prompt: "Why run one more API server than peak traffic needs?",
          options: [
            {
              label: "So losing a server does not overload the rest",
              correct: true,
              explanation: "Right. N+1 keeps the fleet within capacity while a crashed server is out.",
            },
            {
              label: "So autoscaling has something to remove",
              correct: false,
              explanation: "Spare capacity is for failures, not for the autoscaler.",
            },
          ],
        },
        {
          prompt: "Why does the viral link need request coalescing?",
          options: [
            {
              label: "When its cache entry refreshes, only one request should go to the database",
              correct: true,
              explanation: "Right. Without coalescing, every request for the hot key stampedes the database during a refresh.",
            },
            {
              label: "Coalescing raises the cache hit rate for every link",
              correct: false,
              explanation: "It protects hot keys during refreshes. The overall hit rate comes from the TTL.",
            },
          ],
        },
        {
          prompt: "Why do the rate limiter's counters live in the cache?",
          options: [
            {
              label: "So every server enforces one shared limit per client",
              correct: true,
              explanation: "Right. Per-server counters let bots multiply their allowance by the number of servers.",
            },
            {
              label: "Because the cache is the only fast storage available",
              correct: false,
              explanation: "Speed matters, but the point is sharing: one count per client across the whole fleet.",
            },
          ],
        },
        {
          prompt: "Why use push with pub/sub for live counters instead of polling every second?",
          options: [
            {
              label: "Polling every second multiplies load by the number of viewers; push sends only real changes",
              correct: true,
              explanation: "Right, and pub/sub makes sure every server hears every update.",
            },
            {
              label: "Polling cannot work through a load balancer",
              correct: false,
              explanation: "Polling works fine through a balancer. It is the cost at high freshness that rules it out.",
            },
          ],
        },
      ],
    },
  ],
};
