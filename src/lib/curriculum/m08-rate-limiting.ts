import { standardPark } from "./parks";
import type { CurriculumModule } from "./types";

export const rateLimiting: CurriculumModule = {
  number: 8,
  title: "Rate limiting",
  summary: "Decide how often each client may call you, and enforce it across many servers.",
  levels: [
    {
      kind: "sim",
      id: "bot-attack",
      module: 8,
      code: "8.1",
      title: "Bot Attack",
      strapline: "A scraper is guessing short codes as fast as it can.",
      concept: "Rate-limiting algorithms",
      brief: "Bots hammer random codes that always miss the cache. Stop them without blocking real visitors, who sometimes click quickly.",
      refresher: [
        {
          title: "Limit each client, not the whole system",
          body: "A rate limiter counts requests per client and rejects the ones over the limit, before they cost any real work. Set the limit too low and real people get blocked; too high and bots get through.",
          note: "Real visitors are bursty: a few quick clicks, then nothing. Bots are steady and relentless.",
        },
        {
          title: "Fixed windows versus token buckets",
          body: "A fixed window counts requests per calendar second, so a client can send a full window's worth at the end of one second and again at the start of the next. A token bucket refills at a steady rate and allows a burst up to its size.",
          note: "A token bucket can allow short human bursts while holding bots to a low steady rate. A fixed window cannot do both.",
        },
      ],
      journal: {
        title: "Token buckets allow bursts, not floods",
        body: "Rate limits protect the system from any single client. A token bucket separates the burst size from the sustained rate, which fits real users and stops bots.",
        note: "Return 429 Too Many Requests with a Retry-After header, so well-behaved clients back off.",
      },
      unlocks: { nodes: ["api", "database", "cache"], features: ["size", "rate-limit", "ttl"] },
      start: () => standardPark({ api: { size: "L" }, database: { size: "M" }, cache: { ttlSeconds: 120 } }),
      scenario: {
        durationSeconds: 40,
        traffic: { redirects: [[0, 1_350]], creates: [[0, 15]], bots: [[0, 0], [8, 30]] },
        data: { linkRows: 5_000_000 },
      },
      targets: [
        { kind: "availability", min: 0.995 },
        { kind: "p95", maxMs: 80 },
        { kind: "bots-passed", maxRps: 200 },
        { kind: "budget", maxMonthly: 400 },
      ],
      par: { monthly: 380, complexity: 3 },
      finalHint: [
        "On the API, turn on Rate limit each client and set Algorithm to Token bucket.",
        "Set Refill per second to 3, Bucket size to 10, and Counters to Each server.",
        "Keep the single L API server, M database, S cache, Time to live 120 s, and existing routes.",
      ],
      hints: [
        "Bot requests eat the API server and the database, and real visitors time out.",
        "The limit must catch steady bots but let a real visitor's 8 quick clicks through.",
        "Use a token bucket: a low steady rate, like 3 per second, with a burst of about 10.",
      ],
    },
    {
      kind: "sim",
      id: "many-servers",
      module: 8,
      code: "8.2",
      title: "Many Servers",
      strapline: "The limit worked on one server. Now there are four.",
      concept: "Distributed rate limiting",
      brief: "Each server counts requests on its own, and bots spread their requests across every server. Enforce one limit for the whole fleet.",
      refresher: [
        {
          title: "Local counters multiply the limit",
          body: "If each of four servers allows 3 requests per second, a bot that rotates connections gets 12. A real visitor's burst, though, usually rides one connection to one server.",
          note: "Dividing the limit by the number of servers stops bots but blocks real bursts, and breaks again whenever the fleet resizes.",
        },
        {
          title: "Shared counters",
          body: "Keep the counters in a shared store, such as the cache, so every server sees the same count for a client. Each request pays for one extra quick lookup.",
          note: "At very large scale, teams approximate with local counters synced every few seconds, trading precision for speed.",
        },
      ],
      journal: {
        title: "Limits need shared state",
        body: "A rate limit enforced by many servers needs one shared count per client. A fast shared store makes the limit exact for a small cost on every request.",
        note: "Decide what happens if the counter store is down: fail open and risk abuse, or fail closed and risk an outage.",
      },
      unlocks: {
        nodes: ["api", "database", "cache", "load-balancer"],
        features: ["size", "instances", "rate-limit", "health-checks", "sessions", "ttl"],
      },
      start: () =>
        standardPark({
          "load-balancer": { healthChecks: true },
          api: {
            size: "M",
            instances: 4,
            sessions: "shared",
            rateLimit: { enabled: true, algorithm: "token-bucket", rate: 3, burst: 10, counters: "local" },
          },
          database: { size: "M" },
          cache: { ttlSeconds: 120 },
        }),
      scenario: {
        durationSeconds: 40,
        traffic: { redirects: [[0, 2_400]], creates: [[0, 20]], bots: [[0, 10], [10, 60]] },
        data: { linkRows: 5_000_000 },
      },
      targets: [
        { kind: "availability", min: 0.995 },
        { kind: "p95", maxMs: 80 },
        { kind: "bots-passed", maxRps: 200 },
        { kind: "budget", maxMonthly: 650 },
      ],
      par: { monthly: 620, complexity: 4 },
      finalHint: [
        "On the API's rate limiter, set Counters to Shared cache.",
        "Keep Rate limit each client on, Algorithm Token bucket, Refill per second 3, and Bucket size 10.",
        "Keep four M API servers, the M database, S cache, and all existing routes, including API server → Cache.",
      ],
      hints: [
        "The same limit lets four times as many bot requests through.",
        "Each server keeps its own count, and bots spread out across all of them.",
        "Switch the rate limiter's counters to shared, so the cache holds one count per client.",
      ],
    },
  ],
};
