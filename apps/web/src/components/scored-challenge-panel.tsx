import { nextHintPreview, revealedHints, type Attempt, type AttemptHistory } from "@/lib/attempts";

type ScoredChallengePanelProps = {
  canStart: boolean;
  running: boolean;
  attempt?: Attempt;
  history: AttemptHistory;
  onHint: () => void;
  onRetry: () => void;
  onSelectAttempt: (attempt: Attempt) => void;
  onStart: () => void;
};

export function ScoredChallengePanel({
  attempt,
  canStart,
  history,
  onHint,
  onRetry,
  onSelectAttempt,
  onStart,
  running,
}: ScoredChallengePanelProps) {
  const score = attempt?.score;
  const hints = attempt ? revealedHints(attempt) : [];
  const nextHint = attempt ? nextHintPreview(attempt) : null;
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
      {history.attempts.length > 0 && (
        <div className="attempt-summary">
          <span>
            Best <b>{history.bestScore?.toLocaleString()} / 1,000</b>
          </span>
          <span>{history.attempts.length} saved locally</span>
        </div>
      )}
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
            <div className="score-penalty">
              <dt>Hints requested</dt>
              <dd>
                <b>−{score.penalties.hints}</b>
                <span>published progressive penalties</span>
              </dd>
            </div>
          </dl>
          <p className="score-cost">
            Estimated run cost <b>${score.estimatedCost.toFixed(2)}</b>. {score.disclaimer}
          </p>
          {attempt && (
            <div className="hint-panel" aria-label="Progressive hints">
              {hints.map((hint) => (
                <article key={hint.level}>
                  <strong>
                    {hint.label} · −{hint.penalty}
                  </strong>
                  <p>{hint.text}</p>
                </article>
              ))}
              {nextHint ? (
                <button type="button" onClick={onHint}>
                  Reveal {nextHint.label.toLowerCase()} hint · −{nextHint.penalty}
                </button>
              ) : (
                <small>All three hint levels revealed.</small>
              )}
              {attempt.outcome === "failed" && (
                <button type="button" className="retry-attempt" onClick={onRetry}>
                  Retry from failed architecture
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {history.attempts.length > 0 && !running && (
        <ol className="attempt-history" aria-label="Saved attempt history">
          {history.attempts.slice(0, 5).map((savedAttempt) => (
            <li key={savedAttempt.id}>
              <button type="button" onClick={() => onSelectAttempt(savedAttempt)}>
                <span>{savedAttempt.outcome}</span>
                <b>{savedAttempt.score.total}</b>
                <time dateTime={savedAttempt.completedAt}>
                  {new Date(savedAttempt.completedAt).toLocaleString()}
                </time>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
