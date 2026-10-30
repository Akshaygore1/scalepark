import { ArrowRight, BookOpen, Cloud, Map as MapIcon, RotateCcw, Star } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import { moduleFor, nextLevel, type QuizLevel } from "@/lib/curriculum";
import { recordResult } from "@/lib/progress";

import { DialogOverlay, QuizDialog, RefresherDialog } from "./game/dialogs";
import { updateProgress } from "./progress-store";

type Stage = { kind: "refresher"; step: number } | { kind: "quiz"; attempt: number } | { kind: "done"; correct: number; total: number };

function starsFor(correct: number, total: number): 1 | 2 | 3 {
  const share = total ? correct / total : 1;
  return share === 1 ? 3 : share >= 0.75 ? 2 : 1;
}

export function QuizScreen({ level }: { level: QuizLevel }) {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>(level.refresher.length ? { kind: "refresher", step: 0 } : { kind: "quiz", attempt: 0 });
  const next = nextLevel(level.id);
  const module = moduleFor(level);
  return (
    <main className="game-menu quiz-screen">
      <div className="menu-sky" aria-hidden="true">
        <Cloud className="cloud cloud-one" />
        <Cloud className="cloud cloud-two" />
      </div>
      <section className="menu-hero">
        <p className="menu-eyebrow">
          {level.code} · {module?.title}
        </p>
        <h1>{level.title}</h1>
        <p className="menu-lede">{level.strapline}</p>
      </section>

      {stage.kind === "refresher" && (
        <RefresherDialog
          lesson={level.refresher[stage.step]!}
          step={stage.step}
          total={level.refresher.length}
          onNext={() =>
            setStage(stage.step + 1 < level.refresher.length ? { kind: "refresher", step: stage.step + 1 } : { kind: "quiz", attempt: 0 })
          }
        />
      )}
      {stage.kind === "quiz" && (
        <QuizDialog
          key={stage.attempt}
          title={`${level.code} · ${level.concept}`}
          steps={level.steps}
          onComplete={(result) => {
            updateProgress((current) => recordResult(current, level.id, { stars: starsFor(result.correct, result.total) }));
            setStage({ kind: "done", ...result });
          }}
        />
      )}
      {stage.kind === "done" && (
        <DialogOverlay label="Level complete">
          <div className="outcome-dialog won">
            <span className="outcome-label">Level complete</span>
            <h2>{level.journal.title}</h2>
            <div className="outcome-stars" aria-label={`${starsFor(stage.correct, stage.total)} of 3 stars`}>
              {[1, 2, 3].map((star) => (
                <Star key={star} className={star <= starsFor(stage.correct, stage.total) ? "earned" : ""} />
              ))}
            </div>
            <p>
              {stage.correct} of {stage.total} answered right on the first try. {level.journal.body}
            </p>
            <div className="causal-chain">
              <b>
                <BookOpen size={14} /> Added to your journal
              </b>
              <span>{level.journal.note}</span>
            </div>
            <div className="outcome-actions">
              <button type="button" onClick={() => setStage({ kind: "quiz", attempt: Date.now() })}>
                <RotateCcw /> Try again
              </button>
              {next && (
                <button className="dialog-primary" type="button" onClick={() => navigate(`/game/${next.id}`)}>
                  Next level <ArrowRight />
                </button>
              )}
              <button type="button" onClick={() => navigate("/")}>
                <MapIcon /> Campaign map
              </button>
            </div>
          </div>
        </DialogOverlay>
      )}
    </main>
  );
}
