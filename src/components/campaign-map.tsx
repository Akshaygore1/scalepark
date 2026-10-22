import { Activity, Boxes, Cloud, Lock, Play, Star } from "lucide-react";
import { Link } from "react-router";

import { curriculum, levels } from "@/lib/curriculum";
import { isUnlocked } from "@/lib/progress";

import { useProgress } from "./progress-store";

export function CampaignMap() {
  const progress = useProgress();
  const next = levels.find((level) => !progress.levels[level.id]?.completed) ?? levels.at(-1)!;
  const completed = levels.filter((level) => progress.levels[level.id]?.completed).length;
  const stars = levels.reduce((total, level) => total + (progress.levels[level.id]?.stars ?? 0), 0);
  return (
    <main className="game-menu">
      <div className="menu-sky" aria-hidden="true">
        <Cloud className="cloud cloud-one" />
        <Cloud className="cloud cloud-two" />
      </div>
      <section className="menu-hero">
        <div className="menu-brand">
          <span className="menu-brand-mark">
            <Activity />
          </span>
          <span>ScaleLab Park</span>
        </div>
        <p className="menu-eyebrow">Learn system design by running the system</p>
        <h1>
          Grow the crowd.
          <br />
          Keep the links alive.
        </h1>
        <p className="menu-lede">
          Build a link shortener from one server to a system that survives viral spikes, crashed
          databases, and bot attacks. Every level shows you a failure first, then you fix it.
        </p>
        <Link className="menu-primary" to={`/game/${next.id}`}>
          <Play size={18} fill="currentColor" />
          {completed === 0 ? "Start with the brief" : `Continue · ${next.code} ${next.title}`}
        </Link>
        <Link className="menu-secondary" to="/game/sandbox">
          <Boxes size={18} /> Sandbox
        </Link>
        {completed > 0 && (
          <div className="persistent-park-summary" aria-label="Your progress">
            <span>
              <b>{completed}</b> of {levels.length} levels
            </span>
            <span>
              <Star />
              <b>{stars}</b> of {levels.length * 3} stars
            </span>
          </div>
        )}
      </section>

      <section className="chapter-path" aria-label="Curriculum">
        <div className="chapter-path-heading">
          <span>Part 1 · Foundations</span>
          <small>
            {completed} / {levels.length} complete
          </small>
        </div>
        <div className="chapter-path-scroll">
          {curriculum.map((module) => (
            <section className="module-stop" key={module.number} aria-label={`Module ${module.number}: ${module.title}`}>
              <header>
                <span className="module-number">{module.number}</span>
                <span>
                  <b>{module.title}</b>
                  <small>{module.summary}</small>
                </span>
              </header>
              {module.levels.map((level) => {
                const unlocked = isUnlocked(progress, level.id);
                const record = progress.levels[level.id];
                return (
                  <Link
                    className={`chapter-stop ${record?.completed ? "complete" : ""}`}
                    aria-disabled={!unlocked}
                    key={level.id}
                    to={unlocked ? `/game/${level.id}` : "#"}
                    onClick={unlocked ? undefined : (event) => event.preventDefault()}
                  >
                    <span className="chapter-number">{unlocked ? level.code : <Lock size={14} />}</span>
                    <span>
                      <b>{level.title}</b>
                      <small>{unlocked ? `${level.concept}${level.kind === "quiz" ? " · design questions" : ""}` : "Finish the level before this one"}</small>
                    </span>
                    {record?.completed && (
                      <span className="chapter-stars" aria-label={`${record.stars} of 3 stars`}>
                        {[1, 2, 3].map((star) => (
                          <Star key={star} className={star <= record.stars ? "earned" : ""} />
                        ))}
                      </span>
                    )}
                  </Link>
                );
              })}
            </section>
          ))}
        </div>
      </section>

      <p className="menu-disclaimer">
        Educational simulation · progress stays in this browser · simplified numbers, not a capacity plan
      </p>
    </main>
  );
}
