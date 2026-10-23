import { standardPark } from "./parks";
import type { CurriculumModule } from "./types";

export const liveUpdates: CurriculumModule = {
  number: 6,
  title: "Live updates",
  summary: "Choose between frequent polling and open connections, and make it work across many servers.",
  levels: [
    {
      kind: "sim",
      id: "live-counter",
      module: 6,
      code: "6.1",
      title: "Live Click Counter",
      strapline: "Customers want to watch their click counts tick up in real time.",
      concept: "Polling versus push",
      brief: "Thousands of people watch live counters. Keep each counter within 2 seconds of the truth on a modest budget.",
      refresher: [
        {
          title: "Polling asks again and again",
          body: "With polling, every open dashboard asks the server for the latest count on a timer. Asking every second keeps numbers fresh, but 4,000 viewers asking every second is 4,000 requests per second, mostly answered with no change.",
          note: "Polling is simple and works everywhere. Its cost grows with viewers divided by the poll interval.",
        },
        {
          title: "Push keeps a connection open",
          body: "With WebSockets or server-sent events, each viewer holds one open connection and the server pushes an update only when a count changes.",
          note: "Open connections use memory on the server, so each server can hold a limited number of them.",
        },
      ],
      journal: {
        title: "Poll when it is cheap, push when it is not",
        body: "Polling cost grows with viewers and freshness. Push sends only real changes but keeps a connection per viewer open on a server.",
        note: "Long polling sits in between: the server holds the request until something changes.",
      },
      unlocks: { nodes: ["api", "database", "cache"], features: ["size", "live-mode", "ttl"] },
      start: () =>
        standardPark({
          api: { size: "M", live: { mode: "poll", pollSeconds: 5 } },
          database: { size: "M" },
          cache: { ttlSeconds: 120 },
        }),
      scenario: {
        durationSeconds: 40,
        traffic: { redirects: [[0, 450]], creates: [[0, 10]], viewers: [[0, 1_500], [15, 4_000]] },
        data: { linkRows: 5_000_000 },
      },
      targets: [
        { kind: "availability", min: 0.995 },
        { kind: "p95", maxMs: 80 },
        { kind: "freshness", maxSeconds: 2 },
        { kind: "viewers-connected", min: 0.99 },
        { kind: "budget", maxMonthly: 350 },
      ],
      par: { monthly: 310, complexity: 3 },
      finalHint: [
        "On the API, set Live updates to Push (open connection).",
        "Keep the single M API server, M database, S cache, Time to live 120 s, and existing routes.",
      ],
      hints: [
        "Counters are several seconds behind.",
        "The poll interval sets how stale a counter can be; polling faster multiplies the load.",
        "Switch live updates to push. One server can hold thousands of open connections.",
      ],
    },
    {
      kind: "sim",
      id: "open-connections",
      module: 6,
      code: "6.2",
      title: "Open Connections",
      strapline: "A celebrity is watching their link's counter. So are their fans.",
      concept: "Fan-out across servers",
      brief: "Far more viewers than one server can hold. Connect all of them, and make sure every viewer sees every update.",
      refresher: [
        {
          title: "Connections pin viewers to servers",
          body: "Each open connection lives on one particular server. With several servers, a click handled by server A must still reach viewers connected to servers B and C.",
          note: "Without help, a server can only notify the viewers connected to itself.",
        },
        {
          title: "Pub/sub fans updates out",
          body: "A publish/subscribe broker lets every server publish updates and receive everyone else's. Each server then pushes to its own viewers.",
          note: "The broker is one more component to run, but it turns many isolated servers into one live system.",
        },
      ],
      journal: {
        title: "Fan-out with pub/sub",
        body: "When connections are spread over many servers, updates must be broadcast between servers. A pub/sub broker delivers each update to every server.",
        note: "Load balancers must support long-lived connections, and reconnecting clients should resume where they left off.",
      },
      unlocks: {
        nodes: ["api", "database", "cache", "load-balancer", "pubsub"],
        features: ["size", "instances", "live-mode", "health-checks", "sessions", "ttl"],
      },
      start: () =>
        standardPark({
          "load-balancer": { healthChecks: true },
          api: { size: "L", instances: 1, sessions: "shared", live: { mode: "push", pollSeconds: 5 } },
          database: { size: "M" },
          cache: { ttlSeconds: 120 },
        }),
      scenario: {
        durationSeconds: 40,
        traffic: { redirects: [[0, 1_200]], creates: [[0, 10]], viewers: [[0, 8_000], [12, 48_000]] },
        data: { linkRows: 5_000_000 },
      },
      targets: [
        { kind: "availability", min: 0.995 },
        { kind: "viewers-connected", min: 0.99 },
        { kind: "missed-updates", max: 0.01 },
        { kind: "budget", maxMonthly: 900 },
      ],
      par: { monthly: 840, complexity: 6 },
      finalHint: [
        "On the API, keep Server size L and raise Servers to 3. Keep Live updates at Push (open connection) and Login sessions at Shared cache.",
        "Build a pub/sub broker and connect API server → Pub/sub broker.",
        "Keep the load balancer with Health checks on, M database, S cache, and existing routes.",
      ],
      hints: [
        "One server runs out of room for connections; with more servers, most viewers stop seeing updates.",
        "Each server only knows about clicks it handled itself.",
        "Run enough API servers for every connection, and connect them to a pub/sub broker.",
      ],
    },
  ],
};
