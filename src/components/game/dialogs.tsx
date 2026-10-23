import { Activity, ArrowRight, BookOpen, CircleCheck, CircleX, Map as MapIcon, RotateCcw, Star, Users, Wrench, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { curriculum, type Lesson, type QuizStep } from "@/lib/curriculum";
import type { Outcome } from "@/lib/evaluate";
import type { Progress } from "@/lib/progress";

import { formatMoney } from "./buildings";
import type { Prediction } from "./game-state";

function Overlay({ children, label, onEscape }: { children: ReactNode; label: string; onEscape?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
  }, []);
  useEffect(() => {
    if (!onEscape) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onEscape();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEscape]);
  return (
    <div className="game-overlay" ref={ref}>
      <section className="dialog-frame" role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </section>
    </div>
  );
}

function CoachFrame({ kicker, progress, children, actions }: { kicker: string; progress?: { current: number; total: number }; children: ReactNode; actions: ReactNode }) {
  return (
    <div className="advisor-dialog">
      <div className="advisor-character" aria-hidden="true">
        <span>!</span>
        <Users />
      </div>
      <div className="advisor-copy">
        <header className="advisor-header">
          <span className="advisor-label">{kicker}</span>
          {progress && progress.total > 1 && (
            <div className="advisor-progress" role="progressbar" aria-valuemin={1} aria-valuemax={progress.total} aria-valuenow={progress.current} aria-valuetext={`${progress.current} of ${progress.total}`}>
              <span className="advisor-progress-label">
                {progress.current} of {progress.total}
              </span>
              <span className="advisor-progress-track" aria-hidden="true">
                {Array.from({ length: progress.total }, (_, index) => (
                  <i key={index} className={index < progress.current ? "complete" : undefined} />
                ))}
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
    <Overlay label={lesson.title}>
      <CoachFrame
        kicker="Mina · Systems coach"
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
        <aside className="advisor-detail" aria-label="Coach's note">
          <BookOpen aria-hidden="true" />
          <div>
            <strong>Coach's note</strong>
            <p>{lesson.note}</p>
          </div>
        </aside>
      </CoachFrame>
    </Overlay>
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
    <Overlay label={title}>
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
    </Overlay>
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
    <Overlay label="Make a prediction">
      <CoachFrame
        kicker="Before the run · make a prediction"
        actions={
          <button type="button" onClick={() => onPredict("none")}>
            Nothing will break
            <ArrowRight aria-hidden="true" />
          </button>
        }
      >
        <h2>What breaks first?</h2>
        <p>Guessing before you look makes the answer stick. Which building will run out of headroom first?</p>
        <div className="quiz-options prediction-options" role="group" aria-label="Buildings">
          {options.map((option) => (
            <button className="quiz-option" key={option.id} type="button" onClick={() => onPredict(option.id)}>
              <i aria-hidden="true" />
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      </CoachFrame>
    </Overlay>
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
    <Overlay label={won ? "Level complete" : "Run finished"} onEscape={onEdit}>
      <div className={`outcome-dialog ${won ? "won" : "lost"}`}>
        <span className="outcome-icon">{won ? "★" : isSandbox ? "i" : "!"}</span>
        <span className="outcome-label">{isSandbox ? "Run finished" : won ? "Level complete" : "Not yet"}</span>
        <h2>{isSandbox ? "Here is how the park held up." : won ? "The links stayed alive." : "The park missed a target."}</h2>
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
            <button type="button" onClick={onNext}>
              Next level <ArrowRight />
            </button>
          ) : (
            <button type="button" onClick={onEdit}>
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
    </Overlay>
  );
}

export function JournalDialog({ progress, onClose }: { progress: Progress; onClose: () => void }) {
  const entries = curriculum.flatMap((module) =>
    module.levels
      .filter((level) => progress.levels[level.id]?.completed)
      .map((level) => ({ module, level })),
  );
  return (
    <Overlay label="System design journal" onEscape={onClose}>
      <div className="journal">
        <button type="button" onClick={onClose} aria-label="Close journal">
          <X />
        </button>
        <span className="journal-label">Field notes</span>
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
    </Overlay>
  );
}
