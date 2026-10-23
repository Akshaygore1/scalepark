import { standardPark, type ParkSpec } from "./parks";
import type { CurriculumModule } from "./types";

const fleet: ParkSpec = {
  "load-balancer": { healthChecks: true },
  api: { size: "L", instances: 2, sessions: "shared" },
  cache: { ttlSeconds: 120, invalidateOnWrite: true },
};

const dashboardTraffic = {
  redirects: [[0, 1_500]],
  creates: [[0, 5]],
  edits: [[0, 10]],
  dashboard: [[0, 450], [12, 780], [40, 820]],
} as const;

export const scalingDatabases: CurriculumModule = {
  number: 5,
  title: "When one database isn't enough",
  summary: "Add read replicas, then handle replication lag, failover, backups, and recovery.",
  levels: [
    {
      kind: "sim",
      id: "read-replicas",
      module: 5,
      code: "5.1",
      title: "Read Replicas",
      strapline: "Every customer wants their dashboard. None of it can be cached.",
      concept: "Read replicas",
      brief: "Personal dashboards are flooding the database with reads the cache cannot help with. Spread the reads.",
      refresher: [
        {
          title: "Some reads cannot be cached",
          body: "Dashboards are personal and change constantly, so caching them helps little. Those reads land on the database no matter what.",
          note: "A read replica is a copy of the database that receives every change from the primary and answers reads, while the primary handles writes.",
        },
        {
          title: "Reads scale out, writes do not",
          body: "You can add replicas until reads are covered, because each replica holds the full data. Every write must still go through the single primary, and every replica must apply it too.",
          note: "Replicas are the second scaling step for read-heavy systems, after caching.",
        },
      ],
      journal: {
        title: "Replicas scale reads",
        body: "Read replicas copy the primary and take read traffic off it. They do nothing for write capacity, because every write still goes to the primary.",
        note: "Route uncacheable reads, like dashboards and reports, to replicas first.",
      },
      unlocks: {
        nodes: ["api", "database", "cache", "load-balancer", "replica"],
        features: ["size", "instances", "health-checks", "sessions", "ttl", "invalidate"],
      },
      start: () => standardPark({ ...fleet, database: { size: "M" } }),
      scenario: {
        durationSeconds: 40,
        traffic: dashboardTraffic,
        data: { linkRows: 5_000_000 },
      },
      targets: [
        { kind: "availability", min: 0.995 },
        { kind: "p95", maxMs: 100 },
        { kind: "budget", maxMonthly: 800 },
      ],
      par: { monthly: 780, complexity: 5 },
      finalHint: [
        "Build a read replica. Set Replica size to S and Replicas to 3.",
        "Connect API server → Read replica and Database → Read replica.",
        "Keep the existing two L API servers, M primary database, S cache, and other routes.",
      ],
      hints: [
        "The database is saturated, and the cache's hit rate is already high.",
        "Dashboard reads are personal, so they skip the cache and all land on the primary.",
        "Add read replicas: route the API to them and replicate the database into them. Several small replicas cost less than a bigger primary.",
      ],
    },
    {
      kind: "sim",
      id: "just-created",
      module: 5,
      code: "5.2",
      title: "Just Created, Not Found",
      strapline: "Customers create a link, click it, and get a 404.",
      concept: "Replication lag",
      brief: "A bulk-import feature creates links quickly. People who just created a link must be able to open it.",
      refresher: [
        {
          title: "Replicas are slightly behind",
          body: "Replication is usually asynchronous: the primary confirms a write and sends it to replicas a moment later. For that moment, replicas do not know about the new link.",
          note: "Lag is normally under a second, and it grows when the primary is busy.",
        },
        {
          title: "Read your own writes",
          body: "Most readers do not care about a link created half a second ago. The person who just created it does. Route their reads to the primary, and everyone else's to replicas.",
          note: "This is a consistency guarantee called read-your-writes. You choose it per request, not for the whole system.",
        },
      ],
      journal: {
        title: "Read-your-writes",
        body: "Asynchronous replicas lag behind the primary. Reads that must see a just-made write go to the primary; everything else can use replicas.",
        note: "Choose consistency per kind of read. Making every read strongly consistent throws away the point of replicas.",
      },
      unlocks: {
        nodes: ["api", "database", "cache", "load-balancer", "replica"],
        features: ["size", "instances", "health-checks", "sessions", "ttl", "invalidate", "read-after-write"],
      },
      start: () => standardPark({ ...fleet, database: { size: "M" }, replica: { size: "M", instances: 2 } }),
      scenario: {
        durationSeconds: 40,
        traffic: { ...dashboardTraffic, creates: [[0, 40], [10, 140]] },
        data: { linkRows: 5_000_000 },
      },
      targets: [
        { kind: "availability", min: 0.995 },
        { kind: "p95", maxMs: 100 },
        { kind: "not-found", max: 20 },
        { kind: "budget", maxMonthly: 920 },
      ],
      par: { monthly: 900, complexity: 5 },
      finalHint: [
        "On the API, set Reads after a create to Primary.",
        "Keep two L API servers, the M primary database, two M replicas, and all existing cache and replication routes.",
      ],
      hints: [
        "Some people get 404s for links that definitely exist.",
        "Their first visit is served by the replica before the new link has been copied to it.",
        "Route reads that follow a create to the primary.",
      ],
    },
    {
      kind: "sim",
      id: "primary-down",
      module: 5,
      code: "5.3",
      title: "Primary Down",
      strapline: "The primary database just died. Who takes over?",
      concept: "Failover",
      brief: "The primary database will fail. Keep accepting writes, and lose none of the ones you already confirmed.",
      refresher: [
        {
          title: "Failover promotes a replica",
          body: "When the primary fails, a replica can be promoted to become the new primary. Done by hand, that takes minutes of someone waking up. Done automatically, it takes seconds.",
          note: "A promoted replica stops serving as a replica. If it was your only one, the new primary now carries every read alone.",
        },
        {
          title: "Asynchronous replication can lose writes",
          body: "With asynchronous replication, writes from the last moment before the crash may never have reached the replica. Promote it, and those confirmed writes are gone.",
          note: "Synchronous replication waits for a replica to confirm each write before answering, so nothing confirmed is lost. Every write gets slower.",
        },
      ],
      journal: {
        title: "Failover and durability",
        body: "Automatic failover promotes a replica within seconds. Synchronous replication makes sure confirmed writes survive the switch, at the cost of slower writes.",
        note: "Plan capacity for after the failover: the promoted replica is no longer serving reads.",
      },
      unlocks: {
        nodes: ["api", "database", "cache", "load-balancer", "replica"],
        features: [
          "size",
          "instances",
          "health-checks",
          "sessions",
          "ttl",
          "invalidate",
          "read-after-write",
          "replication",
          "failover",
        ],
      },
      start: () =>
        standardPark({
          ...fleet,
          api: { size: "L", instances: 2, sessions: "shared", readAfterWrite: "primary" },
          database: { size: "M" },
          replica: { size: "M", instances: 2 },
        }),
      scenario: {
        durationSeconds: 50,
        traffic: { ...dashboardTraffic, creates: [[0, 120]] },
        data: { linkRows: 5_000_000 },
        incidents: [{ at: 15, type: "primary-failure" }],
      },
      targets: [
        { kind: "availability", min: 0.99 },
        { kind: "p95", maxMs: 120 },
        { kind: "lost-writes", max: 0 },
        { kind: "budget", maxMonthly: 1_070 },
      ],
      par: { monthly: 1_050, complexity: 5 },
      finalHint: [
        "On the database, set Replication to Synchronous and Failover to Automatic (5s).",
        "On the read replica, keep Replica size M and raise Replicas to 3.",
        "Keep two L API servers and Reads after a create set to Primary. Keep all existing routes.",
      ],
      hints: [
        "After the primary fails, writes stop for a long time, and some confirmed links vanish.",
        "Failover is manual, replication is asynchronous, and there is only one replica.",
        "Use automatic failover and synchronous replication, and add a replica so reads survive the promotion.",
      ],
    },
    {
      kind: "sim",
      id: "dropped-table",
      module: 5,
      code: "5.4",
      title: "Oops, Dropped Table",
      strapline: "Someone ran the cleanup script on production.",
      concept: "Backups and recovery",
      brief: "The links table will be deleted by mistake. Lose at most an hour of new links, and recover quickly.",
      refresher: [
        {
          title: "Replicas are not backups",
          body: "Replicas copy every change from the primary, including mistakes. Drop a table on the primary, and every replica drops it a moment later.",
          note: "Backups are copies from the past that a mistake cannot reach.",
        },
        {
          title: "Two numbers describe recovery",
          body: "RPO, the recovery point objective, is how much recent data you can afford to lose. RTO, the recovery time objective, is how long you can afford to be down while restoring.",
          note: "Daily snapshots are cheap but can lose a day. Hourly snapshots lose at most an hour. Continuous backups lose almost nothing, cost the most, and take a little longer to replay.",
        },
      ],
      journal: {
        title: "Backups, RPO, and RTO",
        body: "Replication protects against machines failing, not people making mistakes. Backup frequency sets how much data you can lose; restore speed sets how long you are down.",
        note: "A backup you have never restored is a hope, not a backup. Test restores regularly.",
      },
      unlocks: {
        nodes: ["api", "database", "cache", "load-balancer", "replica"],
        features: ["size", "instances", "health-checks", "sessions", "ttl", "invalidate", "read-after-write", "backups"],
      },
      start: () =>
        standardPark({
          ...fleet,
          api: { size: "L", instances: 2, sessions: "shared", readAfterWrite: "primary" },
          database: { size: "M" },
          replica: { size: "M" },
        }),
      scenario: {
        durationSeconds: 40,
        timeScale: "1 second = 30 minutes",
        traffic: { redirects: [[0, 2_800]], creates: [[0, 25]], dashboard: [[0, 200]] },
        data: { linkRows: 50_000_000 },
        incidents: [{ at: 20, type: "table-drop" }],
      },
      targets: [
        { kind: "availability", min: 0.95 },
        { kind: "lost-links", max: 10_000 },
        { kind: "budget", maxMonthly: 1_000 },
      ],
      par: { monthly: 950, complexity: 5 },
      finalHint: [
        "On the database, set Backups to Hourly.",
        "Keep the M primary database, one M replica, two L API servers, S cache, and all existing routes.",
      ],
      hints: [
        "When the table disappears, the replica loses it too, and nothing can bring it back.",
        "Replication copied the mistake. You need a copy from before the mistake.",
        "Turn on backups. Hourly snapshots keep the loss under an hour of links without paying for continuous backups.",
      ],
    },
  ],
};
