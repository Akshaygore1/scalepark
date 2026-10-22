import { runSimulation, type Scenario } from "../simulation";
import { standardPark } from "./parks";
import type { CurriculumModule, QuizStep } from "./types";

const functional = (label: string, explanation: string): QuizStep => ({
  prompt: "Functional or non-functional?",
  context: label,
  options: [
    { label: "Functional: something the system does", correct: true, explanation },
    {
      label: "Non-functional: how well it does it",
      correct: false,
      explanation: `Not quite. ${explanation}`,
    },
  ],
});

const quality = (label: string, explanation: string): QuizStep => ({
  prompt: "Functional or non-functional?",
  context: label,
  options: [
    {
      label: "Functional: something the system does",
      correct: false,
      explanation: `Not quite. ${explanation}`,
    },
    { label: "Non-functional: how well it does it", correct: true, explanation },
  ],
});

const tradeoffScenario: Scenario = {
  durationSeconds: 30,
  traffic: { redirects: [[0, 1_200], [10, 1_500]], creates: [[0, 15]] },
  data: { linkRows: 2_000_000 },
};
const planA = standardPark({ api: { size: "L" }, database: { size: "M" } });
const planB = standardPark({ api: { size: "XL" }, database: { size: "L" }, cache: { size: "S", ttlSeconds: 300 } });

function planRow(name: string, result: ReturnType<typeof runSimulation>) {
  return [
    name,
    `${Math.round(result.totals.p95Ms)} ms`,
    `${(result.totals.availability * 100).toFixed(2)}%`,
    `$${Math.round(result.totals.averageMonthlyCost)}/mo`,
  ];
}

function tradeoffTable() {
  return {
    headers: ["Plan", "p95 latency", "Availability", "Running cost"],
    rows: [
      planRow("A · one L server, M database", runSimulation(planA, tradeoffScenario)),
      planRow("B · XL server, L database, cache", runSimulation(planB, tradeoffScenario)),
    ],
  };
}

export const foundations: CurriculumModule = {
  number: 1,
  title: "What is system design?",
  summary: "Requirements first, then trade-offs. Every design gives something up.",
  levels: [
    {
      kind: "quiz",
      id: "the-brief",
      module: 1,
      code: "1.1",
      title: "The Brief",
      strapline: "A founder wants short links. What do they actually need?",
      concept: "Requirements",
      refresher: [
        {
          title: "System design is a set of choices",
          body: "Designing a system means choosing what to build so it does its job well enough, for the people who use it, within real limits like money and time. There is rarely one right answer, only answers that fit the requirements better or worse.",
          note: "The design process runs from a vague request to running code: clarify requirements, estimate scale, sketch the API and data, draw the big pieces, then go deep where the risk is.",
        },
        {
          title: "Two kinds of requirements",
          body: "Functional requirements say what the system does: create a short link, redirect a visitor. Non-functional requirements say how well: how fast, how reliable, how many users, at what cost.",
          note: "Non-functional requirements decide the architecture. A link shortener for ten friends and one for a million visitors do the same thing, but are built very differently.",
        },
      ],
      journal: {
        title: "Requirements come first",
        body: "Functional requirements describe behaviour; non-functional requirements describe speed, reliability, scale, and cost. The second kind shapes the design.",
        note: "When numbers are missing, ask or estimate them. Designing without them is guessing.",
      },
      steps: [
        functional("Turn a long URL into a short one.", "This is a behaviour the product must have."),
        functional("Send visitors from the short link to the original URL.", "Redirecting is the core behaviour of a link shortener."),
        quality("Redirects feel instant: under 100 ms.", "This is about speed, a quality of the redirect, not a new behaviour."),
        quality("Links keep working even if a server fails.", "This is availability: how reliably the system does its job."),
        functional("Show how many times a link was clicked.", "Counting clicks is a feature users ask for."),
        quality("Handle 3,000 redirects per second at launch.", "This is scale: how much load the system must carry."),
        quality("Running costs stay under $500 a month.", "Cost is a constraint on the design, not a feature."),
        {
          prompt: "Nobody told you how many links get created compared to how many get clicked. What do you do?",
          options: [
            {
              label: "Assume creates and clicks are about equal",
              correct: false,
              explanation: "A guess like this can be off by a factor of a hundred, and it changes the whole design.",
            },
            {
              label: "Ask, or estimate from similar products: links are read far more than written",
              correct: true,
              explanation: "Right. Each link is created once and clicked many times, often 100 reads per write. That ratio will drive caching and replicas later.",
            },
            {
              label: "Build for the largest numbers you can imagine",
              correct: false,
              explanation: "Designing for imaginary scale wastes money and adds complexity you have to maintain.",
            },
          ],
        },
        {
          prompt: "What do you do first in the design process?",
          options: [
            {
              label: "Pick a database",
              correct: false,
              explanation: "Technology choices come after you know what the system must do and how much load it carries.",
            },
            {
              label: "Write down requirements and estimate the scale",
              correct: true,
              explanation: "Right. Requirements and rough numbers tell you which problems you actually have.",
            },
            {
              label: "Draw boxes for every service you might need",
              correct: false,
              explanation: "Boxes without requirements tend to solve problems you do not have.",
            },
          ],
        },
      ],
    },
    {
      kind: "quiz",
      id: "everything-is-a-tradeoff",
      module: 1,
      code: "1.2",
      title: "Everything Is a Trade-off",
      strapline: "Two plans. Both work. Which one fits?",
      concept: "Trade-offs",
      refresher: [
        {
          title: "Better is not a property of a design",
          body: "A faster design usually costs more. A cheaper design usually has less headroom. A design is only better or worse against a specific set of requirements.",
          note: "When you choose, say what you are giving up. Engineers trust a design whose trade-offs are stated out loud.",
        },
      ],
      journal: {
        title: "Every choice gives something up",
        body: "Speed, cost, reliability, and simplicity pull against each other. Choose the design that meets the requirements, not the most impressive one.",
        note: "Write down what you traded away, so you know what to revisit when the requirements change.",
      },
      steps: [
        {
          prompt: "The brief: 1,500 redirects per second, p95 under 150 ms, and under $400 a month. Which plan fits?",
          table: tradeoffTable(),
          options: [
            {
              label: "Plan A",
              correct: true,
              explanation: "Right. Plan A meets the latency target and stays inside the budget. Plan B is faster, but the brief never asked for that speed and cannot afford it.",
            },
            {
              label: "Plan B",
              correct: false,
              explanation: "Plan B is faster, but it breaks the budget. Faster than required is not a requirement.",
            },
          ],
        },
        {
          prompt: "Marketing now promises p95 under 20 ms. What changes?",
          table: tradeoffTable(),
          options: [
            {
              label: "Keep Plan A; latency is close enough",
              correct: false,
              explanation: "A promise to users is a requirement. Plan A does not meet it.",
            },
            {
              label: "Choose Plan B and revisit the budget",
              correct: true,
              explanation: "Right. The new requirement buys speed with money. The trade-off is now explicit: someone must approve the higher cost.",
            },
          ],
        },
        {
          prompt: "You chose Plan A for the original brief. What did you give up?",
          options: [
            {
              label: "Headroom: a traffic spike will hurt sooner",
              correct: true,
              explanation: "Right. Plan A runs closer to its limits, so it has less room for surprises. That is an acceptable risk if you watch it.",
            },
            {
              label: "Nothing: it meets every requirement",
              correct: false,
              explanation: "Meeting the requirements is not the same as giving nothing up. Every design has a weaker side.",
            },
          ],
        },
      ],
    },
  ],
};
