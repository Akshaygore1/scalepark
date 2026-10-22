import { standardPark } from "./parks";
import type { CurriculumModule } from "./types";

export const caching: CurriculumModule = {
  number: 3,
  title: "Caching",
  summary: "Keep popular data in memory to spare the database, without serving stale data.",
  levels: [
    {
      kind: "sim",
      id: "read-heavy",
      module: 3,
      code: "3.1",
      title: "Read Heavy",
      strapline: "Every link is clicked a hundred times for each one created.",
      concept: "Cache-aside",
      brief: "Redirects are overwhelming the database. Keep them fast without paying for a bigger database.",
      refresher: [
        {
          title: "Most work is repeated work",
          body: "Popular links are looked up again and again, and the answer barely changes. Asking the database each time spends its capacity on questions it already answered a moment ago.",
          note: "A cache keeps recent answers in memory. Cache-aside means the API checks the cache first; on a miss it reads the database and stores the result for next time.",
        },
        {
          title: "Hit rate is the number that matters",
          body: "The hit rate is the share of reads answered by the cache. At 75%, the database sees a quarter of the reads it used to. A longer time-to-live (TTL) keeps entries around longer and raises the hit rate.",
          note: "Memory is fast and cheap compared to database capacity, which is why caches are usually the first scaling step for read-heavy systems.",
        },
      ],
      journal: {
        title: "Cache what is read often and changes rarely",
        body: "A cache answers repeated reads from memory, so the database only sees misses. The hit rate tells you how much work the cache absorbed.",
        note: "Cache-aside: read the cache, fall back to the database on a miss, then fill the cache.",
      },
      unlocks: { nodes: ["api", "database", "cache"], features: ["ttl"] },
      start: () => standardPark({ api: { size: "XL" }, database: { size: "M" } }),
      scenario: {
        durationSeconds: 40,
        traffic: { redirects: [[0, 1_600], [15, 2_600], [40, 2_700]], creates: [[0, 25]] },
        data: { linkRows: 5_000_000 },
      },
      targets: [
        { kind: "availability", min: 0.995 },
        { kind: "p95", maxMs: 80 },
        { kind: "budget", maxMonthly: 650 },
      ],
      par: { monthly: 630, complexity: 3 },
      hints: [
        "Redirects slow down as traffic climbs, while the API server still has room.",
        "The database answers the same popular lookups over and over.",
        "Build a cache and route the API server to it. Keep the TTL long enough for a good hit rate.",
      ],
    },
    {
      kind: "sim",
      id: "stale-links",
      module: 3,
      code: "3.2",
      title: "Stale Links",
      strapline: "A customer fixed a typo in their link. Visitors still land on the broken page.",
      concept: "Invalidation",
      brief: "Link owners now edit destinations. Visitors must see edits right away, and the database must stay protected.",
      refresher: [
        {
          title: "A cached value is a copy",
          body: "When the source changes, the copy in the cache is wrong until it expires. With a 10-minute TTL, an edited link can keep sending visitors to the old destination for up to 10 minutes.",
          note: "Shortening the TTL reduces staleness but lowers the hit rate, which sends more reads back to the database. That is the freshness-versus-protection trade-off.",
        },
        {
          title: "Invalidate on write",
          body: "Instead of waiting for expiry, the API can delete the cache entry whenever a link is edited. The next read misses, fetches the new value, and refills the cache.",
          note: "Invalidation keeps a long TTL safe for data you control. It costs one extra cache operation per write.",
        },
      ],
      journal: {
        title: "Freshness versus protection",
        body: "Long TTLs protect the database but serve stale data after edits. Short TTLs are fresh but leak load. Invalidating on write gets both, for data your own code changes.",
        note: "There are only two hard things in computer science: cache invalidation and naming things.",
      },
      unlocks: { nodes: ["api", "database", "cache"], features: ["ttl", "invalidate"] },
      start: () =>
        standardPark({ api: { size: "XL" }, database: { size: "M" }, cache: { size: "S", ttlSeconds: 600 } }),
      scenario: {
        durationSeconds: 40,
        traffic: { redirects: [[0, 2_600], [40, 2_700]], creates: [[0, 25]], edits: [[0, 20]] },
        data: { linkRows: 5_000_000 },
      },
      targets: [
        { kind: "availability", min: 0.995 },
        { kind: "p95", maxMs: 80 },
        { kind: "stale-reads", max: 100 },
        { kind: "budget", maxMonthly: 650 },
      ],
      par: { monthly: 630, complexity: 3 },
      hints: [
        "The system is fast, but visitors are sent to old destinations.",
        "The cache keeps the old URL until its TTL runs out.",
        "Turn on invalidate-on-write so edits clear the cache, and keep the TTL long.",
      ],
    },
    {
      kind: "sim",
      id: "going-viral",
      module: 3,
      code: "3.3",
      title: "Going Viral",
      strapline: "One link is on every phone in the country.",
      concept: "Hot keys and stampedes",
      brief: "A single link carries most of the traffic. Keep the worst seconds fast on a small database.",
      refresher: [
        {
          title: "When a hot entry expires",
          body: "Thousands of requests per second ask for the same key. The moment its cache entry expires or is invalidated, every one of those requests misses at once and stampedes to the database.",
          note: "Request coalescing lets only one request refill the entry while the others wait for that result.",
        },
        {
          title: "When everything expires together",
          body: "If the cache was filled all at once with the same TTL, every entry expires in the same second, and the database briefly takes all the traffic.",
          note: "Adding random jitter to each TTL spreads expiries out, so the database sees a steady trickle of misses instead of a wave.",
        },
      ],
      journal: {
        title: "Averages hide stampedes",
        body: "A cache can have a great average hit rate and still let the database drown for a second at a time. Coalescing protects hot keys; TTL jitter prevents synchronized expiry.",
        note: "Watch the worst second, not just the average. Users remember the spikes.",
      },
      unlocks: { nodes: ["api", "database", "cache"], features: ["ttl", "invalidate", "coalesce", "jitter"] },
      start: () =>
        standardPark({
          api: { size: "XL" },
          database: { size: "S" },
          cache: { size: "S", ttlSeconds: 20, invalidateOnWrite: true },
        }),
      scenario: {
        durationSeconds: 60,
        traffic: {
          redirects: [[0, 1_800], [10, 2_700]],
          hotKey: [[0, 0], [10, 1_500]],
          creates: [[0, 20]],
          edits: [[0, 10]],
        },
        data: { linkRows: 5_000_000 },
        params: { hotEditEvery: 7 },
      },
      targets: [
        { kind: "availability", min: 0.995 },
        { kind: "peak-p95", maxMs: 150 },
        { kind: "stale-reads", max: 100 },
        { kind: "budget", maxMonthly: 560 },
      ],
      par: { monthly: 540, complexity: 3 },
      hints: [
        "Most seconds are fine, but every few seconds latency spikes.",
        "The spikes line up with the viral link's cache entry refreshing, and with whole-cache expiry.",
        "Turn on request coalescing for the hot key and TTL jitter for the rest.",
      ],
    },
  ],
};
