import type { ChallengeScore } from "@/lib/challenge";

type ScoredChallengePanelProps = {
  canStart: boolean;
  running: boolean;
  score: ChallengeScore | null;
  onStart: () => void;
};

export function ScoredChallengePanel({
  canStart,
  onStart,
  running,
  score,
}: ScoredChallengePanelProps) {
  return (
    <section className="scored-challenge" aria-label="Scored challenge">
      <div className="scored-challenge-heading">
        <div>
          <p className="eyebrow">Scored mode</p>
          <strong>{running ? "Attempt in progress" : "72-second survival run"}</strong>
        </div>
        <button type="button" disabled={!canStart || running} onClick={onStart}>
          {running ? "Running…" : "Start scored attempt"}
        </button>
      </div>
      <p className="scored-challenge-note">
        Fixed seed · unpausable · no traffic or incident changes after launch. The schedule includes
        a spike, hot URL, cache failure, database slowdown and failure, and regional latency.
      </p>
      {score && !running && (
        <div className="scorecard" aria-live="polite">
          <div className="score-total">
            <span>Final score</span>
            <strong>{score.total.toLocaleString()} / 1,000</strong>
          </div>
          <dl className="score-factors">
            {score.factors.map((factor) => (
              <div key={factor.key}>
                <dt>{factor.label}</dt>
                <dd>
                  <b>
                    {factor.earned}/{factor.possible}
                  </b>
                  <span>
                    {factor.measured} · target {factor.target}
                  </span>
                </dd>
              </div>
            ))}
            <div className="score-penalty">
              <dt>Overprovisioning</dt>
              <dd>
                <b>−{score.penalties.overprovisioning}</b>
                <span>capacity above the $42/h ceiling</span>
              </dd>
            </div>
          </dl>
          <p className="score-cost">
            Estimated run cost <b>${score.estimatedCost.toFixed(2)}</b>. {score.disclaimer}
          </p>
        </div>
      )}
    </section>
  );
}
