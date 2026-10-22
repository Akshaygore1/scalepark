import { standardPark, type ParkSpec } from "./parks";
import type { CurriculumModule } from "./types";

const fleet: ParkSpec = {
  "load-balancer": { healthChecks: true },
  api: { size: "L", instances: 3, sessions: "shared", readAfterWrite: "primary" },
  cache: { ttlSeconds: 120, invalidateOnWrite: true },
};

export const growingBig: CurriculumModule = {
  number: 9,
  title: "Growing big",
  summary: "Archive and partition first. Put off the hardest step, sharding, for as long as you can.",
  levels: [
    {
      kind: "sim",
      id: "cold-links",
      module: 9,
      code: "9.1",
      title: "Cold Links",
      strapline: "Most of your 220 million links have not been clicked in years.",
      concept: "Archiving",
      brief: "The links table no longer fits in the database's memory, so reads hit disk. Make it fit again without the biggest database.",
      refresher: [
        {
          title: "Memory is the cliff",
          body: "A database is fast while its working data fits in memory. Once the table outgrows memory, reads start going to disk and each one costs several times more.",
          note: "Data that is never read still takes up the memory and backup time of the data that is.",
        },
        {
          title: "Move cold data somewhere cheap",
          body: "Archiving moves rarely read rows into cheap, slow storage. The main table shrinks back into memory; the occasional old link is still served, just a little slower.",
          note: "Pick the cutoff carefully: archive too aggressively and too many reads land on the slow tier, which shows up in p95.",
        },
      ],
      journal: {
        title: "Keep the hot set small",
        body: "Archiving cold rows keeps the hot table in memory. Choose a cutoff where archived reads stay rare enough not to hurt tail latency.",
        note: "Archiving is cheap and reversible. Try it long before sharding.",
      },
      unlocks: {
        nodes: ["api", "database", "cache", "load-balancer", "archive"],
        features: ["size", "instances", "health-checks", "sessions", "ttl", "invalidate", "archive-after"],
      },
      start: () => standardPark({ ...fleet, database: { size: "L" } }),
      scenario: {
        durationSeconds: 40,
        traffic: { redirects: [[0, 4_200]], creates: [[0, 30]], edits: [[0, 10]] },
        data: { linkRows: 220_000_000 },
        // A long tail of distinct links: most reads are for links nobody else read recently.
        params: { reuseSeconds: 600 },
      },
      targets: [
        { kind: "availability", min: 0.995 },
        { kind: "p95", maxMs: 100 },
        { kind: "budget", maxMonthly: 1_100 },
      ],
      par: { monthly: 1_040, complexity: 5 },
      hints: [
        "The database is saturated even though traffic has not changed much.",
        "The table is bigger than the database's memory, so reads spill to disk.",
        "Build archive storage and archive links older than a year. 90 days moves too many reads to the slow tier.",
      ],
    },
    {
      kind: "sim",
      id: "partitioning",
      module: 9,
      code: "9.2",
      title: "Partitioning",
      strapline: "Three billion click rows, and the dashboard only ever shows last month.",
      concept: "Partitioning",
      brief: "Dashboard queries scan an enormous clicks table, and a nightly cleanup deletes old rows one by one. Keep the database calm.",
      refresher: [
        {
          title: "Split one table by time",
          body: "Partitioning splits one big table into pieces inside the same database, for example one partition per month. A query for last month only touches last month's partition.",
          note: "The application still sees one table. The database skips partitions a query cannot need.",
        },
        {
          title: "Deleting old data gets cheap",
          body: "Deleting a year of old rows one by one is enormous work. With monthly partitions, the database drops a whole partition in one cheap step.",
          note: "Partition on the column your hottest queries filter by. Partitioning on the wrong column makes every query visit every partition.",
        },
      ],
      journal: {
        title: "Partition by how you query",
        body: "Partitioning keeps hot data small and makes dropping old data nearly free, all inside one database.",
        note: "Partitioning keeps one database. Sharding spreads data over many, which is a much bigger step.",
      },
      unlocks: {
        nodes: ["api", "database", "cache", "load-balancer", "archive", "replica"],
        features: ["size", "instances", "health-checks", "sessions", "ttl", "invalidate", "partitioning"],
      },
      start: () => standardPark({ ...fleet, database: { size: "L" } }),
      scenario: {
        durationSeconds: 40,
        traffic: { redirects: [[0, 3_600]], creates: [[0, 30]], dashboard: [[0, 220]] },
        data: { linkRows: 40_000_000, clickRows: 3_000_000_000 },
        incidents: [{ at: 22, type: "retention-job", duration: 10 }],
      },
      targets: [
        { kind: "availability", min: 0.995 },
        { kind: "p95", maxMs: 100 },
        { kind: "budget", maxMonthly: 1_100 },
      ],
      par: { monthly: 1_030, complexity: 5 },
      hints: [
        "Dashboards are slow all the time, and everything collapses when the cleanup job starts.",
        "Every dashboard query scans the whole clicks table, and the cleanup deletes rows one at a time.",
        "Partition the clicks table by month.",
      ],
    },
    {
      kind: "sim",
      id: "the-hard-step",
      module: 9,
      code: "9.3",
      title: "The Hard Step",
      strapline: "Enterprise customers now create links by the thousand.",
      concept: "Sharding",
      brief: "Writes are about to exceed what the largest database can take. Shard only as much as you need.",
      refresher: [
        {
          title: "When one primary cannot take the writes",
          body: "Caches, replicas, archiving, and partitioning all help reads or shrink data. None of them adds write capacity, because every write still goes to one primary. Sharding splits the data across several databases, each owning a slice.",
          note: "Sharding is one of the hardest steps in system design: cross-shard queries, rebalancing, and operations all get harder. Delay it until writes force your hand.",
        },
        {
          title: "The shard key decides everything",
          body: "Shard by creation time and every new link lands on the newest shard, so one shard takes all the writes. Shard by a hash of the code and writes spread evenly.",
          note: "Queries that do not include the shard key, like a dashboard listing a customer's links, must ask every shard.",
        },
      ],
      journal: {
        title: "Shard last, and pick the key carefully",
        body: "Sharding adds write capacity by splitting data across databases. A hashed key spreads load evenly; a time-based key creates a hot shard.",
        note: "Use the fewest shards that fit the load. Each one adds cost and complexity you carry forever.",
      },
      unlocks: {
        nodes: ["api", "database", "cache", "load-balancer", "replica"],
        features: ["size", "instances", "health-checks", "sessions", "ttl", "invalidate", "shards"],
      },
      start: () => standardPark({ ...fleet, api: { ...fleet.api, instances: 5 }, database: { size: "XL" } }),
      scenario: {
        durationSeconds: 50,
        traffic: {
          redirects: [[0, 3_000]],
          creates: [[0, 800], [20, 800], [32, 4_600], [50, 4_800]],
          dashboard: [[0, 60]],
        },
        data: { linkRows: 30_000_000 },
        // Bulk API customers create links for later campaigns; nobody opens them right away.
        params: { followupShare: 0 },
      },
      targets: [
        { kind: "availability", min: 0.995 },
        { kind: "p95", maxMs: 100 },
        { kind: "budget", maxMonthly: 2_200 },
      ],
      par: { monthly: 2_190, complexity: 11 },
      hints: [
        "The database falls over as soon as the bulk creates begin.",
        "Writes alone exceed what any single database can handle.",
        "Shard the database by a hash of the code. Three L shards are cheaper than two XL shards.",
      ],
    },
  ],
};
