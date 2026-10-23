import { servicePark } from "./parks";
import type { CurriculumModule } from "./types";

export const microservices: CurriculumModule = {
  number: 11,
  title: "Microservices",
  summary: "Split one app into services: where to draw the lines, and what every call between them costs.",
  levels: [
    {
      kind: "sim",
      id: "bad-deploy",
      module: 11,
      code: "11.1",
      title: "Bad Deploy",
      strapline: "The analytics team shipped a bug. Every redirect went down with it.",
      concept: "Failure isolation",
      brief: "A bad analytics deploy will crash-loop whatever runs analytics for 15 seconds. Keep redirects up and count every click.",
      refresher: [
        {
          title: "One app, one fate",
          body: "In a monolith every feature runs in the same process. A crash in the least important code takes down the most important code with it, and every team waits on one deploy.",
          note: "Splitting the app into services lets each part deploy, scale, and fail on its own.",
        },
        {
          title: "Draw a line, then decide how to cross it",
          body: "Once analytics is its own service, the app has to reach it over the network. If the app waits for the answer, an analytics crash still fails redirects. If it sends a message through a queue, the app can answer the visitor and analytics catches up later.",
          note: "Give a capability to a service in its settings. Choose how a route calls in the route's settings.",
        },
      ],
      journal: {
        title: "Services contain failures, if the calls between them allow it",
        body: "A separate service limits a bad deploy to that service. The call between services decides whether the failure spreads: waiting on a crashed service fails the caller too, while a queued message waits for it to come back.",
        note: "Split along parts that fail, deploy, or scale differently. Splitting alone is not isolation.",
      },
      unlocks: { nodes: ["service"], features: ["capabilities", "size", "instances", "async"] },
      start: () => servicePark({ capabilities: ["links", "analytics"], size: "L", instances: 3 }),
      scenario: {
        kind: "services",
        durationSeconds: 60,
        operations: [
          { id: "redirect", label: "Redirects", rate: [[0, 2_000]], steps: ["links", "analytics"] },
          { id: "create", label: "New links", rate: [[0, 40]], steps: ["links"] },
        ],
        incidents: [{ at: 20, type: "crash", capability: "analytics", duration: 15 }],
      },
      targets: [
        { kind: "availability", min: 0.995 },
        { kind: "clicks-lost", max: 0 },
        { kind: "backlog-drained" },
        { kind: "budget", maxMonthly: 650 },
      ],
      par: { monthly: 600, complexity: 3 },
      finalHint: [
        "On the existing service, turn Analytics off. Keep Links on, set Instance size to L, and Instances to 2.",
        "Build a second service with only Analytics on, Instance size M, and Instances 2.",
        "Keep Clients connected to the Links service. Connect Links service → Analytics service.",
        "In the Links service's Routes out section, set the Analytics route's Call to Send a message (queued).",
      ],
      hints: [
        "When the analytics deploy crashes, the whole app crashes with it, redirects included.",
        "Analytics runs in the same service as links, so it shares its fate.",
        "Build a second service, give it analytics, and route the app to it with a queued message instead of a call that waits.",
      ],
    },
    {
      kind: "sim",
      id: "chatty-services",
      module: 11,
      code: "11.2",
      title: "Chatty Services",
      strapline: "Every feature got its own service. Redirects got slow.",
      concept: "Service boundaries",
      brief: "A redirect now calls three services in a row before it answers. Bring p95 under 40 ms, keep analytics isolated, and spend less.",
      refresher: [
        {
          title: "Every call has a price",
          body: "A call to another service crosses the network, serializes the request and the answer, and waits in another queue. One call costs a few milliseconds. A request that makes several calls in a row pays for each one.",
          note: "Calls in a row add up. A service that owns everything a request needs answers it in one hop.",
        },
        {
          title: "Draw boundaries around data and change",
          body: "Good boundaries group things that change together and are needed together. Links, link safety, and geo lookup are all needed on every redirect. Analytics is needed later, and its team ships every day.",
          note: "Too few services and one failure takes everything down. Too many and every request is a chain of network calls.",
        },
      ],
      journal: {
        title: "Fewer, better boundaries",
        body: "Split where parts fail, scale, or change independently, and keep together what one request needs together. Each hop adds latency, work, and another thing that can fail.",
        note: "If two services always change and deploy together, they are one service with a network call in the middle.",
      },
      unlocks: { nodes: ["service"], features: ["capabilities", "size", "instances", "async"] },
      start: () =>
        servicePark(
          { capabilities: [], size: "L", instances: 1 },
          { capabilities: ["links"], size: "L", instances: 1 },
          { capabilities: ["safety"], size: "M", instances: 1 },
          { capabilities: ["geo"], size: "M", instances: 1 },
          { capabilities: ["analytics"], size: "M", instances: 1, call: { mode: "async" } },
        ),
      scenario: {
        kind: "services",
        durationSeconds: 60,
        operations: [
          { id: "redirect", label: "Redirects", rate: [[0, 800]], steps: ["links", "safety", "geo", "analytics"] },
          { id: "create", label: "New links", rate: [[0, 30]], steps: ["links", "safety"] },
        ],
        incidents: [{ at: 25, type: "crash", capability: "analytics", duration: 10 }],
      },
      targets: [
        { kind: "availability", min: 0.995 },
        { kind: "p95", maxMs: 40 },
        { kind: "clicks-lost", max: 0 },
        { kind: "backlog-drained" },
        { kind: "budget", maxMonthly: 550 },
      ],
      par: { monthly: 490, complexity: 3 },
      finalHint: [
        "Turn Links, Link safety, and Geo lookup off in their separate services, then turn all three on in the service connected to Clients.",
        "Set that entry service's Instance size to L and Instances to 2.",
        "Keep Analytics in its own service at size M with 1 instance. Remove the three services whose capabilities you moved.",
        "Keep Clients → Entry service → Analytics service connected. In the entry service's Routes out section, set the Analytics route's Call to Send a message (queued).",
      ],
      hints: [
        "Every service is healthy, but redirects are slow and the park costs too much.",
        "A redirect waits on three network calls in a row: links, link safety, and geo lookup.",
        "Run links, link safety, and geo lookup in one service, keep analytics separate behind a queue, and remove the empty services.",
      ],
    },
    {
      kind: "quiz",
      id: "reading-a-trace",
      module: 11,
      code: "11.3",
      title: "Where Did It Go Slow?",
      strapline: "Every dashboard is green. Users say redirects are slow.",
      concept: "Distributed tracing",
      refresher: [
        {
          title: "Averages per service hide the path",
          body: "Each service can look healthy on its own while a request that passes through five of them is slow. Server metrics tell you how busy a machine is, not where one request spent its time.",
          note: "A trace follows one request across every service it touches.",
        },
        {
          title: "Spans",
          body: "A trace is a tree of spans. Each span is one unit of work: a service handling a request, or one call to another service. Spans carry start and end times, so you can see what ran in a row, what overlapped, and where time went.",
          note: "The trace ID travels in a request header, so every service adds its spans to the same trace.",
        },
      ],
      journal: {
        title: "Traces show where one request spent its time",
        body: "Metrics show how busy each service is. Logs show what one service saw. A trace stitches one request's path together across services, so the slow step stands out.",
        note: "Look for the widest span on the critical path, and for calls in a row that could run at the same time or not at all.",
      },
      steps: [
        {
          prompt: "Here is one slow redirect. Which span should you fix first?",
          table: {
            headers: ["Span", "Starts at", "Duration"],
            rows: [
              ["gateway: GET /abc123", "0 ms", "212 ms"],
              ["→ links: lookup", "2 ms", "9 ms"],
              ["→ safety: check destination", "12 ms", "184 ms"],
              ["    → partner API: reputation", "15 ms", "178 ms"],
              ["→ geo: country", "197 ms", "6 ms"],
            ],
          },
          options: [
            {
              label: "The partner reputation call inside link safety",
              correct: true,
              explanation: "Right. It accounts for 178 of the 212 ms, and everything after it waits for it.",
            },
            {
              label: "The gateway, because it has the longest span",
              correct: false,
              explanation: "The gateway's span contains all the others. Its own work is only the few milliseconds not covered by a child span.",
            },
            {
              label: "Geo lookup, because it runs last",
              correct: false,
              explanation: "Running last is not the same as being slow. It takes 6 ms.",
            },
          ],
        },
        {
          prompt: "The safety team says the partner answer changes at most once a day per domain. What is the best fix?",
          options: [
            {
              label: "Cache reputation per domain for a few hours, and check new domains in the background",
              correct: true,
              explanation: "Right. Almost every redirect becomes a fast cache hit, and the slow call leaves the critical path.",
            },
            {
              label: "Give the safety service bigger servers",
              correct: false,
              explanation: "The time is spent waiting on the partner, not computing. Bigger servers wait just as long.",
            },
            {
              label: "Add retries to the partner call",
              correct: false,
              explanation: "Retries help with failures, not slowness. A slow call retried is slower still.",
            },
          ],
        },
        {
          prompt: "Metrics show the safety service at 15% CPU the whole time. Why did that not reveal the problem?",
          options: [
            {
              label: "Waiting on another service uses almost no CPU, so a slow dependency looks idle",
              correct: true,
              explanation: "Right. Utilization measures work, not waiting. Traces measure time, wherever it is spent.",
            },
            {
              label: "The CPU metric was broken",
              correct: false,
              explanation: "The metric was accurate. It measures the wrong thing for this question.",
            },
          ],
        },
        {
          prompt: "How does the links service know which trace its span belongs to?",
          options: [
            {
              label: "The gateway passes a trace ID and its span ID along with the call",
              correct: true,
              explanation: "Right. Context propagation is what makes a trace span many services. A service that drops the header breaks the trace.",
            },
            {
              label: "The tracing system matches spans by timestamp",
              correct: false,
              explanation: "Clocks on different machines disagree, and many requests overlap. Matching needs an explicit ID.",
            },
          ],
        },
      ],
    },
  ],
};
