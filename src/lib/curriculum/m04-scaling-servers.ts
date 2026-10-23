import { standardPark } from "./parks";
import type { CurriculumModule } from "./types";

export const scalingServers: CurriculumModule = {
  number: 4,
  title: "When one server isn't enough",
  summary: "Scale up, then scale out, and fix what breaks when there is a second server.",
  levels: [
    {
      kind: "sim",
      id: "bigger-box",
      module: 4,
      code: "4.1",
      title: "Bigger Box",
      strapline: "The launch went well. Too well for one small server.",
      concept: "Vertical scaling",
      brief: "Traffic is climbing past what your API server can handle. Pick the right size of server.",
      refresher: [
        {
          title: "Capacity is work per second",
          body: "A server can finish a fixed amount of work each second. As it gets close to that limit, requests start waiting behind each other, and latency climbs steeply long before the server is technically full.",
          note: "Rule of thumb: plan to run at 60 to 70% of capacity at peak. The last 30% is where waiting explodes.",
        },
        {
          title: "Scaling up is the simplest fix",
          body: "Vertical scaling means moving to a bigger machine. Nothing else in the design changes, which makes it the easiest first step.",
          note: "Bigger machines cost disproportionately more, and there is always a biggest machine. Both limits will matter soon.",
        },
      ],
      journal: {
        title: "Scale up first, and watch the price curve",
        body: "A bigger server is the simplest way to add capacity. Pick the smallest size that keeps peak utilization comfortably below 100%.",
        note: "Doubling capacity usually more than doubles the price, and the largest size is a hard ceiling.",
      },
      unlocks: { nodes: ["api", "database", "cache"], features: ["size", "ttl"] },
      start: () => standardPark({ api: { size: "S" }, database: { size: "M" }, cache: { ttlSeconds: 120 } }),
      scenario: {
        durationSeconds: 40,
        traffic: { redirects: [[0, 300], [25, 1_300], [40, 1_400]], creates: [[0, 15]] },
        data: { linkRows: 5_000_000 },
      },
      targets: [
        { kind: "availability", min: 0.995 },
        { kind: "p95", maxMs: 60 },
        { kind: "budget", maxMonthly: 400 },
      ],
      par: { monthly: 380, complexity: 3 },
      finalHint: [
        "Select the API server and set Server size to L.",
        "Keep the M database and S cache, with Time to live at 120 s and all existing routes.",
      ],
      hints: [
        "Latency climbs with traffic, and the API server is the busy one.",
        "One small API server cannot finish that much work per second.",
        "Raise the API server's size. Choose the smallest size that keeps it well below full.",
      ],
    },
    {
      kind: "sim",
      id: "second-server",
      module: 4,
      code: "4.2",
      title: "The Second Server",
      strapline: "Even the biggest server is not big enough anymore.",
      concept: "Horizontal scaling",
      brief: "Traffic has outgrown the largest server. Run several servers, and keep logged-in users logged in.",
      refresher: [
        {
          title: "Scale out instead of up",
          body: "Horizontal scaling adds more servers instead of a bigger one. A load balancer gives clients one stable address and spreads requests across all of them.",
          note: "Several mid-sized servers are often cheaper than one huge one, and losing one of them is not an outage.",
        },
        {
          title: "Servers must not remember things",
          body: "Once a load balancer spreads requests, a user's next request may land on a different server. Anything a server kept in its own memory, such as a login session, is missing on the others.",
          note: "Keep servers stateless: move sessions into a shared store, such as the cache, that every server can read.",
        },
      ],
      journal: {
        title: "Stateless servers scale out",
        body: "A load balancer spreads traffic across many servers, but only works when any server can handle any request. Shared state, like sessions, belongs in a shared store.",
        note: "Sticky sessions are a workaround, not a fix: they unbalance load and still lose users when a server dies.",
      },
      unlocks: {
        nodes: ["api", "database", "cache", "load-balancer"],
        features: ["size", "instances", "sessions", "ttl"],
      },
      start: () => standardPark({ api: { size: "XL" }, database: { size: "M" }, cache: { ttlSeconds: 120 } }),
      scenario: {
        durationSeconds: 40,
        traffic: {
          redirects: [[0, 2_500], [15, 4_600], [40, 4_800]],
          creates: [[0, 30]],
          dashboard: [[0, 150], [15, 250]],
        },
        data: { linkRows: 5_000_000 },
      },
      targets: [
        { kind: "availability", min: 0.995 },
        { kind: "p95", maxMs: 60 },
        { kind: "logged-out", max: 0 },
        { kind: "budget", maxMonthly: 850 },
      ],
      par: { monthly: 800, complexity: 4 },
      finalHint: [
        "On the existing API building, set Server size to L, Servers to 3, and Login sessions to Shared cache. The Servers setting represents the whole pool.",
        "Build a load balancer. Connect Clients → Load balancer → API server. Remove the direct Clients → API server route.",
        "Keep API server → Database and API server → Cache connected.",
        "Keep database size M, cache size S, and Time to live at 120 s.",
      ],
      hints: [
        "The API server is at its largest size and still saturated.",
        "You need more than one server, and something to spread traffic between them.",
        "Add a load balancer in front of several API servers, and store sessions in the shared cache.",
      ],
    },
    {
      kind: "sim",
      id: "server-dies",
      module: 4,
      code: "4.3",
      title: "A Server Dies",
      strapline: "Servers fail. The question is whether anyone notices.",
      concept: "Redundancy",
      brief: "One API server will crash during the run. Keep the park available anyway.",
      refresher: [
        {
          title: "Plan for one missing server",
          body: "If you run exactly enough servers for peak traffic, losing one turns into an overload for all the others. Redundancy means keeping at least one server's worth of spare capacity: N+1.",
          note: "Spare capacity costs money every hour to protect you for the few minutes something breaks. That is the price of availability.",
        },
        {
          title: "Health checks",
          body: "A load balancer that does not check its servers keeps sending a share of requests to a dead one. With health checks, it notices within seconds and stops routing there.",
          note: "Health checks only help if the remaining servers can carry the load.",
        },
      ],
      journal: {
        title: "N+1 and health checks",
        body: "Run one more server than peak traffic needs, and let the load balancer health-check its servers so a dead one stops receiving traffic.",
        note: "Redundancy that has never been tested is a guess. Real teams kill servers on purpose to prove it works.",
      },
      unlocks: {
        nodes: ["api", "database", "cache", "load-balancer"],
        features: ["size", "instances", "health-checks", "sessions", "ttl"],
      },
      start: () =>
        standardPark({
          "load-balancer": {},
          api: { size: "L", instances: 3, sessions: "shared" },
          database: { size: "M" },
          cache: { ttlSeconds: 120 },
        }),
      scenario: {
        durationSeconds: 45,
        traffic: { redirects: [[0, 3_800], [10, 4_600]], creates: [[0, 30]] },
        data: { linkRows: 5_000_000 },
        incidents: [{ at: 18, type: "api-crash" }],
      },
      targets: [
        { kind: "availability", min: 0.985 },
        { kind: "p95", maxMs: 80 },
        { kind: "budget", maxMonthly: 1_000 },
      ],
      par: { monthly: 1_000, complexity: 4 },
      finalHint: [
        "Select the load balancer and turn on Health checks.",
        "On the API, keep Server size L and Login sessions Shared cache, and raise Servers to 4.",
        "Keep the M database, S cache, Time to live 120 s, and existing routes through the load balancer.",
      ],
      hints: [
        "Everything is fine until a server crashes, then errors pour in.",
        "The load balancer keeps sending traffic to the dead server, and the others are already full.",
        "Turn on health checks and run one more API server than peak traffic needs.",
      ],
    },
    {
      kind: "sim",
      id: "rush-hour",
      module: 4,
      code: "4.4",
      title: "Rush Hour",
      strapline: "Busy at lunch, quiet at night. Why pay for lunch all day?",
      concept: "Autoscaling",
      brief: "Traffic follows a daily curve. Serve the peak without paying for peak capacity all day.",
      refresher: [
        {
          title: "Capacity that follows demand",
          body: "Autoscaling adds servers when utilization rises and removes them when it falls, so you pay for peak capacity only during the peak.",
          note: "New servers take time to boot and warm up. Here they need 6 seconds before they take traffic.",
        },
        {
          title: "Scale before you need it",
          body: "If autoscaling waits until servers are nearly full, the new ones arrive after the damage is done. A lower target utilization starts scaling earlier, at the cost of more idle headroom.",
          note: "Autoscaling handles gradual curves well and sudden spikes poorly. For spikes you know about, scale ahead of time.",
        },
      ],
      journal: {
        title: "Autoscaling lags behind demand",
        body: "Autoscaling saves money on uneven traffic, but new capacity arrives late. Set the target utilization low enough that servers are ready before the peak.",
        note: "Keep a minimum number of servers for redundancy, and a maximum to cap a runaway bill.",
      },
      unlocks: {
        nodes: ["api", "database", "cache", "load-balancer"],
        features: ["size", "instances", "autoscaling", "health-checks", "sessions", "ttl"],
      },
      start: () =>
        standardPark({
          "load-balancer": { healthChecks: true },
          api: { size: "L", instances: 1, sessions: "shared" },
          database: { size: "M" },
          cache: { ttlSeconds: 120 },
        }),
      scenario: {
        durationSeconds: 60,
        timeScale: "1 second = 24 minutes",
        traffic: {
          redirects: [[0, 900], [12, 1_200], [24, 5_400], [34, 5_600], [46, 1_400], [60, 900]],
          creates: [[0, 20]],
        },
        data: { linkRows: 5_000_000 },
      },
      targets: [
        { kind: "availability", min: 0.995 },
        { kind: "p95", maxMs: 80 },
        { kind: "budget", maxMonthly: 850 },
      ],
      par: { monthly: 840, complexity: 5 },
      finalHint: [
        "On the API, keep Server size L and Servers 1, then turn on Autoscaling.",
        "Set Minimum to 1, Maximum to 4, and Target busy to 50%.",
        "Keep Login sessions at Shared cache, load balancer Health checks on, database size M, and cache Time to live at 120 s.",
        "Keep all existing routes.",
      ],
      hints: [
        "One server is fine at night and overwhelmed at lunch; four servers all day blow the budget.",
        "Capacity needs to follow the daily curve.",
        "Turn on autoscaling with a target utilization around 50%, so new servers are warm before the peak.",
      ],
    },
  ],
};
