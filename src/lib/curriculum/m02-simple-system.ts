import { clientsOnly, standardPark } from "./parks";
import type { CurriculumModule } from "./types";

export const simpleSystem: CurriculumModule = {
  number: 2,
  title: "Start with a simple system",
  summary: "One client, one server, one database. Design the API and the data first.",
  levels: [
    {
      kind: "sim",
      id: "first-light",
      module: 2,
      code: "2.1",
      title: "First Light",
      strapline: "Your first users are about to arrive.",
      concept: "The request path",
      brief: "Build the smallest system that works: an API server that creates and redirects links, and a database that remembers them.",
      refresher: [
        {
          title: "Start simple on purpose",
          body: "A client sends a request, a server runs your code, and a database keeps the data safe when servers restart. Most products should start exactly here, because a simple system is easy to understand, cheap to run, and easy to change.",
          note: "Add pieces only when a requirement or a measurement says you need them. Every extra box is something to monitor, pay for, and debug.",
        },
        {
          title: "Design the interface before the boxes",
          body: "Decide what the API looks like and how the data is shaped before choosing infrastructure. The API is a promise to clients; the data model decides which questions are cheap to answer.",
          note: "For a link shortener the hot question is: given a code, what is the URL? The data model should make that lookup trivial.",
        },
      ],
      journal: {
        title: "Client, server, database",
        body: "Requests flow from the client to the API server, which reads and writes the database. Design the API and data model first: they outlive any particular server.",
        note: "A 302 redirect keeps every click flowing through your server, so you can count clicks and change destinations later.",
      },
      unlocks: { nodes: ["api", "database"], features: [] },
      start: clientsOnly,
      scenario: {
        durationSeconds: 30,
        traffic: { redirects: [[0, 80], [30, 250]], creates: [[0, 5]] },
        data: { linkRows: 10_000 },
      },
      targets: [
        { kind: "availability", min: 0.999 },
        { kind: "p95", maxMs: 100 },
        { kind: "budget", maxMonthly: 150 },
      ],
      par: { monthly: 100, complexity: 2 },
      hints: [
        "Requests from the clients have nowhere to go yet.",
        "You need something to run the code and something to store the links.",
        "Build an API server and a database, then route clients → API → database.",
      ],
      before: [
        {
          prompt: "Which endpoint should create a short link?",
          options: [
            {
              label: "POST /links with the long URL in the body",
              correct: true,
              explanation: "Right. Creating a resource is a POST, and the body can grow later (custom codes, expiry) without changing the URL shape.",
            },
            {
              label: "GET /create?url=…",
              correct: false,
              explanation: "GET requests should not change data. Browsers, crawlers, and caches may repeat them freely.",
            },
            {
              label: "PUT /{code}",
              correct: false,
              explanation: "PUT means the client chooses the code. Usually the server should generate it so codes stay unique.",
            },
          ],
        },
        {
          prompt: "How should GET /{code} respond?",
          options: [
            {
              label: "302 Found, pointing at the original URL",
              correct: true,
              explanation: "Right. A temporary redirect sends every visit through your server, so clicks can be counted and destinations edited.",
            },
            {
              label: "301 Moved Permanently",
              correct: false,
              explanation: "Browsers cache 301s, sometimes forever. That saves load, but you lose click counts and can never change the destination.",
            },
            {
              label: "200 with a page that links onward",
              correct: false,
              explanation: "An extra page and an extra click make every redirect slower for the visitor.",
            },
          ],
        },
        {
          prompt: "How should links be stored?",
          options: [
            {
              label: "A links table keyed by code: code, url, created_at",
              correct: true,
              explanation: "Right. The hot lookup, code to URL, is a single primary-key read.",
            },
            {
              label: "Encode the whole URL inside the code, no database",
              correct: false,
              explanation: "Codes would be as long as the URLs, which defeats the point of a short link.",
            },
            {
              label: "One row per click, each with the URL",
              correct: false,
              explanation: "The URL would be copied on every click, and finding a link's target would mean searching through clicks.",
            },
          ],
        },
      ],
    },
    {
      kind: "sim",
      id: "missing-index",
      module: 2,
      code: "2.2",
      title: "The Missing Index",
      strapline: "It was fast last week. Nothing changed. So why is it slow?",
      concept: "Data access",
      brief: "The links table is growing every day. Keep redirects fast as it grows, without buying a bigger database.",
      refresher: [
        {
          title: "Growth changes the cost of a query",
          body: "Without an index, the database finds a link by scanning rows until it finds the match. With ten thousand rows that is instant. With millions, every redirect reads a mountain of data, and the same traffic suddenly needs far more work.",
          note: "An index is a sorted lookup structure, like the index at the back of a book. Finding one code becomes a handful of steps no matter how big the table gets.",
        },
        {
          title: "Indexes are not free",
          body: "Every write must also update the index, so writes get a little more expensive. For a link shortener, with far more reads than writes, that trade is easy.",
          note: "In this simulation, one simulated second stands for a day of growth.",
        },
      ],
      journal: {
        title: "Design data for its hottest query",
        body: "An index turns a full table scan into a direct lookup. Reads stay fast as data grows, at a small cost to every write.",
        note: "Before scaling hardware, check whether the work itself is wasteful. A missing index can look exactly like an undersized database.",
      },
      unlocks: { nodes: ["api", "database"], features: ["index"] },
      start: () => standardPark({ api: { size: "S" }, database: { size: "S", index: false } }),
      scenario: {
        durationSeconds: 40,
        timeScale: "1 second = 1 day of growth",
        traffic: { redirects: [[0, 250], [40, 320]], creates: [[0, 8]] },
        data: { linkRows: 150_000, linkRowsPerSecond: 110_000 },
      },
      targets: [
        { kind: "availability", min: 0.995 },
        { kind: "p95", maxMs: 120 },
        { kind: "budget", maxMonthly: 150 },
      ],
      par: { monthly: 100, complexity: 2 },
      hints: [
        "The database works harder every day, even though traffic barely grows.",
        "Look at the database's read cost: it rises with the number of rows.",
        "Add an index on the short code. Reads become a direct lookup.",
      ],
    },
  ],
};
