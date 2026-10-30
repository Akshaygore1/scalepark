import { Activity, ArrowRight, BookOpen, CircleCheck, CircleX, Map as MapIcon, RotateCcw, Star, Wrench, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { curriculum, type Lesson, type QuizStep } from "@/lib/curriculum";
import type { Outcome } from "@/lib/evaluate";
import type { Progress } from "@/lib/progress";

import { formatMoney } from "./buildings";
import type { Prediction } from "./game-state";

export function DialogOverlay({ children, label, onEscape, className = "" }: {
  children: ReactNode;
  label: string;
  onEscape?: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    const heading = dialog.querySelector<HTMLElement>("h2");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus();
    }
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      className={`game-overlay ${className}`}
      ref={ref}
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key === "Tab") {
          const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
          )).filter((element) => element.getClientRects().length > 0);
          const first = focusable[0];
          const last = focusable.at(-1);
          const active = document.activeElement as HTMLElement;
          if (first && last && (!focusable.includes(active) || (event.shiftKey ? active === first : active === last))) {
            event.preventDefault();
            (event.shiftKey ? last : first).focus();
          }
          return;
        }
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onEscape?.();
      }}
      onCancel={(event) => {
        event.preventDefault();
        onEscape?.();
      }}
      onClose={(event) => {
        const dialog = event.currentTarget;
        if (!dialog.isConnected || dialog.open) return;
        if (onEscape) onEscape();
        else dialog.showModal();
      }}
    >
      <div className="dialog-frame">{children}</div>
    </dialog>
  );
}

function CoachFrame({ kicker, progress, children, actions }: { kicker: string; progress?: { current: number; total: number }; children: ReactNode; actions: ReactNode }) {
  return (
    <div className="advisor-dialog">
      <div className="advisor-copy">
        <header className="advisor-header">
          <span className="advisor-label">{kicker}</span>
          {progress && progress.total > 1 && (
            <div className="advisor-progress" role="progressbar" aria-label="Progress" aria-valuemin={1} aria-valuemax={progress.total} aria-valuenow={progress.current} aria-valuetext={`${progress.current} of ${progress.total}`}>
              <span className="advisor-progress-label">
                {progress.current} of {progress.total}
              </span>
            </div>
          )}
        </header>
        <div className="advisor-lesson">{children}</div>
        <footer className="advisor-actions">{actions}</footer>
      </div>
    </div>
  );
}

export function RefresherDialog({ lesson, step, total, onNext }: { lesson: Lesson; step: number; total: number; onNext: () => void }) {
  return (
    <DialogOverlay label={lesson.title}>
      <CoachFrame
        kicker="Lesson"
        progress={{ current: step + 1, total }}
        actions={
          <button type="button" onClick={onNext}>
            {step + 1 === total ? "Start planning" : "Next"}
            <ArrowRight aria-hidden="true" />
          </button>
        }
      >
        <h2>{lesson.title}</h2>
        <p>{lesson.body}</p>
        <aside className="advisor-detail" aria-label="Key idea">
          <strong>Key idea</strong>
          <p>{lesson.note}</p>
        </aside>
      </CoachFrame>
    </DialogOverlay>
  );
}

/** Answer each question until it is right. First-try answers are what count. */
export function QuizDialog({
  title,
  steps,
  onComplete,
}: {
  title: string;
  steps: QuizStep[];
  onComplete: (result: { correct: number; total: number }) => void;
}) {
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<number | null>(null);
  const [tried, setTried] = useState<Set<number>>(new Set());
  const [firstTry, setFirstTry] = useState(0);
  const step = steps[index]!;
  const picked = chosen === null ? undefined : step.options[chosen];
  const solved = picked?.correct === true;
  const choose = (option: number) => {
    if (solved) return;
    if (tried.size === 0 && step.options[option]!.correct) setFirstTry((count) => count + 1);
    setTried((current) => new Set(current).add(option));
    setChosen(option);
  };
  const next = () => {
    if (index + 1 === steps.length) {
      onComplete({ correct: firstTry, total: steps.length });
      return;
    }
    setIndex(index + 1);
    setChosen(null);
    setTried(new Set());
  };
  return (
    <DialogOverlay label={title}>
      <CoachFrame
        kicker={title}
        progress={{ current: index + 1, total: steps.length }}
        actions={
          <button type="button" disabled={!solved} onClick={next}>
            {index + 1 === steps.length ? "Finish" : "Next question"}
            <ArrowRight aria-hidden="true" />
          </button>
        }
      >
        <h2 className="quiz-prompt">{step.prompt}</h2>
        {step.context && <p className="quiz-context">“{step.context}”</p>}
        {step.table && (
          <div className="dialog-table-scroll" tabIndex={0} role="region" aria-label="Question data">
            <table className="quiz-table">
              <thead>
                <tr>{step.table.headers.map((header) => <th key={header}>{header}</th>)}</tr>
              </thead>
              <tbody>
                {step.table.rows.map((row) => (
                  <tr key={row[0]}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="quiz-options" role="group" aria-label="Answers">
          {step.options.map((option, optionIndex) => {
            const state = tried.has(optionIndex) ? (option.correct ? "correct" : "wrong") : "";
            return (
              <button
                className={`quiz-option ${state}`}
                key={option.label}
                type="button"
                disabled={solved && !option.correct}
                aria-pressed={chosen === optionIndex}
                onClick={() => choose(optionIndex)}
              >
                {state === "correct" ? <CircleCheck /> : state === "wrong" ? <CircleX /> : <i aria-hidden="true" />}
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
        {picked && (
          <p className={`quiz-explanation ${picked.correct ? "correct" : "wrong"}`} role="status">
            {picked.explanation}
          </p>
        )}
      </CoachFrame>
    </DialogOverlay>
  );
}

export function PredictionDialog({
  options,
  onPredict,
}: {
  options: Array<{ id: string; label: string }>;
  onPredict: (prediction: Prediction) => void;
}) {
  return (
    <DialogOverlay label="Make a prediction">
      <CoachFrame
        kicker="Before the run"
        actions={
          <button type="button" onClick={() => onPredict("none")}>
            Nothing will break
            <ArrowRight aria-hidden="true" />
          </button>
        }
      >
        <h2>What breaks first?</h2>
        <p>Which building will run out of headroom first?</p>
        <div className="quiz-options prediction-options" role="group" aria-label="Buildings">
          {options.map((option) => (
            <button className="quiz-option" key={option.id} type="button" onClick={() => onPredict(option.id)}>
              <i aria-hidden="true" />
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      </CoachFrame>
    </DialogOverlay>
  );
}

export function OutcomeDialog({
  outcome,
  prediction,
  firstSaturated,
  labels,
  isSandbox,
  hasNext,
  onReview,
  onEdit,
  onNext,
  onMap,
}: {
  outcome: Outcome;
  prediction: Prediction | null;
  firstSaturated?: string;
  labels: ReadonlyMap<string, string>;
  isSandbox: boolean;
  hasNext: boolean;
  onReview: () => void;
  onEdit: () => void;
  onNext: () => void;
  onMap: () => void;
}) {
  const won = outcome.passed;
  const guessedRight = prediction !== null && (prediction === "none" ? !firstSaturated : prediction === firstSaturated);
  return (
    <DialogOverlay label={won ? "Level complete" : "Run finished"} onEscape={onEdit}>
      <div className={`outcome-dialog ${won ? "won" : "lost"}`}>
        <button className="dialog-close" type="button" onClick={onEdit} aria-label="Close run results"><X /></button>
        <span className="outcome-label">Run results</span>
        <h2>{isSandbox ? "Run complete" : won ? "Level complete" : "Targets missed"}</h2>
        {won && !isSandbox && (
          <div className="outcome-stars" aria-label={`${outcome.stars} of 3 stars`}>
            {[1, 2, 3].map((star) => (
              <Star key={star} className={star <= outcome.stars ? "earned" : ""} />
            ))}
          </div>
        )}
        {prediction !== null && (
          <p className={`outcome-prediction ${guessedRight ? "right" : "wrong"}`}>
            You predicted {prediction === "none" ? "nothing would break" : `the ${labels.get(prediction) ?? "building"}`}.{" "}
            {firstSaturated ? `The ${labels.get(firstSaturated) ?? "building"} ran out of headroom first.` : "Nothing ran out of headroom."}
          </p>
        )}
        {outcome.targets.length > 0 && (
          <div className="dialog-table-scroll" tabIndex={0} role="region" aria-label="Run targets">
            <table className="outcome-targets">
              <thead>
                <tr>
                  <th>Target</th>
                  <th>Goal</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {outcome.targets.map((item) => (
                  <tr key={item.label} className={item.pass ? "pass" : "fail"}>
                    <th scope="row">
                      {item.pass ? <CircleCheck /> : <CircleX />}
                      {item.label}
                    </th>
                    <td>{item.goal}</td>
                    <td>{item.measured}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {outcome.score && (
          <div className="score-summary">
            <b>{outcome.score.total.toLocaleString()} / 1,000</b>
            <span>{outcome.score.factors.map((factor) => `${factor.label} ${factor.earned}/${factor.possible}`).join(" · ")}</span>
          </div>
        )}
        <p className="outcome-meta">
          {formatMoney(outcome.monthlyCost)}/mo · complexity {outcome.complexity}
        </p>
        {outcome.story.length > 0 && (
          <div className="causal-chain">
            <b>{won ? "What happened" : "Why it fell short"}</b>
            {outcome.story.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </div>
        )}
        <div className="outcome-actions">
          <button type="button" onClick={onReview}>
            <Activity /> Run review
          </button>
          {won && hasNext && !isSandbox ? (
            <button className="dialog-primary" type="button" onClick={onNext}>
              Next level <ArrowRight />
            </button>
          ) : (
            <button className="dialog-primary" type="button" onClick={onEdit}>
              {isSandbox ? <Wrench /> : <RotateCcw />} {isSandbox ? "Keep building" : "Revise the park"}
            </button>
          )}
          <button type="button" onClick={won && hasNext && !isSandbox ? onEdit : onMap}>
            {won && hasNext && !isSandbox ? (
              <>
                <Wrench /> Keep tuning
              </>
            ) : (
              <>
                <MapIcon /> Campaign map
              </>
            )}
          </button>
        </div>
      </div>
    </DialogOverlay>
  );
}

export function JournalDialog({ progress, onClose }: { progress: Progress; onClose: () => void }) {
  const entries = curriculum.flatMap((module) =>
    module.levels
      .filter((level) => progress.levels[level.id]?.completed)
      .map((level) => ({ module, level })),
  );
  return (
    <DialogOverlay label="System design journal" onEscape={onClose}>
      <div className="journal">
        <button className="dialog-close" type="button" onClick={onClose} aria-label="Close journal">
          <X />
        </button>
        <span className="journal-label">Journal</span>
        <h2>System design journal</h2>
        {entries.length ? (
          entries.map(({ module, level }) => (
            <article key={level.id}>
              <span>
                {module.number}. {module.title} · {level.code} {level.title}
              </span>
              <h3>{level.journal.title}</h3>
              <p>{level.journal.body}</p>
              <p className="journal-note">{level.journal.note}</p>
            </article>
          ))
        ) : (
          <div className="journal-empty">
            <BookOpen />
            <p>Pass a level to add its lesson to your journal.</p>
          </div>
        )}
      </div>
    </DialogOverlay>
  );
}
