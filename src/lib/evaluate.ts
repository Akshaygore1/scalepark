import type { SimLevel, Target } from "./curriculum/types";
import { architectureComplexity, nodeLabel, type Architecture } from "./model";
import type { SimulationResult, Totals } from "./simulation";

export type TargetResult = { target: Target; label: string; goal: string; measured: string; pass: boolean };

export type Outcome = {
  passed: boolean;
  stars: 0 | 1 | 2 | 3;
  targets: TargetResult[];
  monthlyCost: number;
  complexity: number;
  /** Plain-language account of what went wrong, first cause first. */
  story: string[];
  score?: CapstoneScore;
};

export type CapstoneScore = {
  total: number;
  factors: Array<{ label: string; earned: number; possible: number }>;
};

const percent = (value: number, digits = 2) => `${(value * 100).toFixed(digits)}%`;
const count = (value: number) => Math.round(value).toLocaleString();
const money = (value: number) => `$${Math.round(value).toLocaleString()}/mo`;

function peakP95(result: SimulationResult) {
  return result.snapshots.reduce((peak, snapshot) => Math.max(peak, snapshot.p95Ms), 0);
}

export function measureTarget(target: Target, result: SimulationResult): TargetResult {
  const totals: Totals = result.totals;
  switch (target.kind) {
    case "availability":
      return row(target, "Availability", `≥ ${percent(target.min)}`, percent(totals.availability), totals.availability >= target.min);
    case "p95":
      return row(target, "p95 latency", `≤ ${target.maxMs} ms`, `${Math.round(totals.p95Ms)} ms`, totals.p95Ms <= target.maxMs);
    case "peak-p95": {
      const peak = peakP95(result);
      return row(target, "Worst-second p95", `≤ ${target.maxMs} ms`, `${Math.round(peak)} ms`, peak <= target.maxMs);
    }
    case "budget":
      return row(target, "Running cost", `≤ ${money(target.maxMonthly)}`, money(totals.averageMonthlyCost), totals.averageMonthlyCost <= target.maxMonthly + 0.5);
    case "stale-reads":
      return row(target, "Stale redirects", `≤ ${count(target.max)}`, count(totals.staleReads), totals.staleReads <= target.max);
    case "not-found":
      return row(target, "New links not found", `≤ ${count(target.max)}`, count(totals.notFound), totals.notFound <= target.max);
    case "lost-writes":
      return row(target, "Lost writes", `≤ ${count(target.max)}`, count(totals.lostWrites), totals.lostWrites <= target.max);
    case "lost-links":
      return row(target, "Links lost", `≤ ${count(target.max)}`, count(totals.lostLinks), totals.lostLinks <= target.max);
    case "duplicates":
      return row(target, "Double-counted jobs", `≤ ${count(target.max)}`, count(totals.duplicates), totals.duplicates <= target.max);
    case "logged-out":
      return row(target, "Users logged out", `≤ ${count(target.max)}`, count(totals.loggedOut), totals.loggedOut <= target.max);
    case "bots-passed":
      return row(target, "Bot requests let through", `≤ ${count(target.maxRps)}/s`, `${count(totals.peakBotsPassed)}/s`, totals.peakBotsPassed <= target.maxRps);
    case "viewers-connected":
      return row(target, "Live viewers served", `≥ ${percent(target.min, 1)}`, percent(totals.minViewersConnected, 1), totals.minViewersConnected >= target.min);
    case "freshness":
      return row(target, "Counter freshness", `≤ ${target.maxSeconds} s`, totals.maxFreshnessSeconds >= 60 ? "updates missed" : `${totals.maxFreshnessSeconds.toFixed(1)} s`, totals.maxFreshnessSeconds <= target.maxSeconds);
    case "missed-updates":
      return row(target, "Viewers missing updates", `≤ ${percent(target.max, 0)}`, percent(totals.maxMissedUpdates, 0), totals.maxMissedUpdates <= target.max);
    case "analytics-delay":
      return row(target, "Click count delay", `≤ ${target.maxSeconds} s`, `${totals.maxAnalyticsDelaySeconds.toFixed(1)} s`, totals.maxAnalyticsDelaySeconds <= target.maxSeconds);
    case "backlog-drained":
      return row(target, "Jobs left at the end", "0", count(totals.finalBacklog), totals.finalBacklog < 1);
    case "operation-availability": {
      const measured = totals.operations[target.operation]?.availability ?? 1;
      return row(target, `${target.label} succeeding`, `≥ ${percent(target.min)}`, percent(measured), measured >= target.min);
    }
    case "clicks-lost":
      return row(target, "Clicks lost", `≤ ${count(target.max)}`, count(totals.clicksLost), totals.clicksLost <= target.max);
    case "double-claims":
      return row(target, "Aliases given out twice", `≤ ${count(target.max)}`, count(totals.doubleClaims), totals.doubleClaims <= target.max);
  }
}

function row(target: Target, label: string, goal: string, measured: string, pass: boolean): TargetResult {
  return { target, label, goal, measured, pass };
}

const failureReasons: Record<Target["kind"], string> = {
  availability: "Too many requests failed: they were dropped after waiting too long, sent to a dead server, or had nowhere to go.",
  p95: "The slowest 5% of requests took too long. Look for a stage running close to full capacity.",
  "peak-p95": "Latency spiked during the worst seconds, even if the average looked fine.",
  budget: "The park costs more per month than the budget allows.",
  "stale-reads": "Visitors were redirected to old destinations because cached copies outlived edits.",
  "not-found": "People opened links they had just created and got a 404 from a replica that had not caught up.",
  "lost-writes": "Writes confirmed to users never reached the copy that took over.",
  "lost-links": "Links created since the last usable backup could not be recovered.",
  duplicates: "Jobs were delivered twice and processed twice.",
  "logged-out": "Users were logged out because their session lived in one server's memory.",
  "bots-passed": "Too much bot traffic got past the rate limiter.",
  "viewers-connected": "Some live viewers could not connect.",
  freshness: "Live counters showed numbers that were too old.",
  "missed-updates": "Some viewers never received updates because their server did not hear about the clicks.",
  "analytics-delay": "Clicks waited too long in the queue before being counted.",
  "backlog-drained": "Background jobs were still waiting when the run ended.",
  "operation-availability": "Too many requests of one kind failed. Follow the failing calls to the service behind them.",
  "clicks-lost": "Clicks were dropped because the call that records them failed and nothing kept them for later.",
  "double-claims": "Two people were given the same custom alias because a lock was trusted after it had expired.",
};

export function evaluateRun(
  level: SimLevel,
  architecture: Architecture,
  result: SimulationResult,
  reasoning?: { correct: number; total: number },
): Outcome {
  const complexity = architectureComplexity(architecture);
  const monthlyCost = result.totals.averageMonthlyCost;
  if (!result.validation.ok) {
    return {
      passed: false,
      stars: 0,
      targets: [],
      monthlyCost,
      complexity,
      story: result.validation.errors,
    };
  }
  const targets = level.targets.map((target) => measureTarget(target, result));
  const passed = targets.every((item) => item.pass);
  const lean = monthlyCost <= level.par.monthly + 0.5;
  const simple = complexity <= level.par.complexity;
  const stars = !passed ? 0 : lean && simple ? 3 : lean ? 2 : 1;
  const story: string[] = [];
  const first = result.totals.firstSaturated;
  if (first) {
    const snapshot = result.snapshots[first.second]?.nodes[first.node];
    const node = architecture.nodes.find((candidate) => candidate.id === first.node);
    story.push(
      `${node ? nodeLabel(node) : "A building"} ran out of headroom first, at ${formatClock(first.second)}${
        snapshot && Number.isFinite(snapshot.capacity) && snapshot.capacity > 0
          ? ` (${count(snapshot.load)} units of work for ${count(snapshot.capacity)} of capacity)`
          : ""
      }.`,
    );
  }
  for (const event of result.events.filter((item) => item.kind === "incident")) {
    story.push(`${formatClock(event.second)} · ${event.message}`);
  }
  for (const item of targets.filter((target) => !target.pass)) {
    story.push(failureReasons[item.target.kind]);
  }
  return {
    passed,
    stars,
    targets,
    monthlyCost,
    complexity,
    story,
    score: level.capstone ? capstoneScore(level, result, monthlyCost, targets, reasoning) : undefined,
  };
}

function capstoneScore(
  level: SimLevel,
  result: SimulationResult,
  monthlyCost: number,
  targets: TargetResult[],
  reasoning = { correct: 0, total: 0 },
): CapstoneScore {
  const availabilityTarget = level.targets.find((target) => target.kind === "availability");
  const latencyTarget = level.targets.find((target) => target.kind === "p95");
  const correctness = targets.filter(
    (item) => !["availability", "p95", "budget"].includes(item.target.kind),
  );
  const availabilityGoal = availabilityTarget?.kind === "availability" ? availabilityTarget.min : 0.99;
  const latencyGoal = latencyTarget?.kind === "p95" ? latencyTarget.maxMs : 100;
  const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
  const factors = [
    {
      label: "Availability",
      possible: 250,
      earned: 250 * clamp01((result.totals.availability - 0.9) / (availabilityGoal - 0.9)),
    },
    { label: "Latency", possible: 200, earned: 200 * clamp01(latencyGoal / Math.max(1, result.totals.p95Ms)) },
    {
      label: "Correctness",
      possible: 200,
      earned: correctness.length ? (200 * correctness.filter((item) => item.pass).length) / correctness.length : 200,
    },
    { label: "Cost", possible: 200, earned: 200 * clamp01(level.par.monthly / Math.max(1, monthlyCost)) },
    {
      label: "Reasoning",
      possible: 150,
      earned: reasoning.total ? (150 * reasoning.correct) / reasoning.total : 0,
    },
  ].map((factor) => ({ ...factor, earned: Math.round(factor.earned) }));
  return { total: factors.reduce((sum, factor) => sum + factor.earned, 0), factors };
}

export function formatClock(second: number) {
  return `${String(Math.floor(second / 60)).padStart(2, "0")}:${String(second % 60).padStart(2, "0")}`;
}
