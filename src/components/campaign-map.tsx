import { ArrowDown, ArrowRight, ArrowUpRight, Check, ChevronDown, GitFork, Lock, Play, Star } from "lucide-react";
import { Link } from "react-router";

import { levels, parts } from "@/lib/curriculum";
import { isUnlocked } from "@/lib/progress";

import { LandingPreview } from "./landing-preview";
import { useProgress } from "./progress-store";

const learningSteps = [
  { title: "Meet the problem", body: "A traffic spike. A slow database. A server that goes down. Start with a reason to change your design." },
  { title: "Build your solution", body: "Place servers, connect the pieces, and choose your settings. Make the architecture your own." },
  { title: "See what happens", body: "Run scenarios in a simulation. Follow the traffic, read the results, and improve your design." },
];

export function CampaignMap() {
  const progress = useProgress();
  const completed = levels.filter((level) => progress.levels[level.id]?.completed).length;
  const finished = completed === levels.length;
  const next = levels.find((level) => !progress.levels[level.id]?.completed)
    ?? levels.find((level) => level.kind === "sim" && level.capstone)
    ?? levels.at(-1)!;
  const stars = levels.reduce((total, level) => total + (progress.levels[level.id]?.stars ?? 0), 0);
  const startLabel = finished ? "Revisit the capstone" : completed > 0 ? "Continue learning" : "Start building";

  return (
    <main className="landing">
      <header className="landing-nav landing-width">
        <a className="landing-brand" href="#top" aria-label="ScaleLab Park home">
          <span className="landing-brand-icon"><GitFork size={23} strokeWidth={2.3} /></span>
          ScaleLab <span className="landing-brand-park">Park</span>
        </a>
        <nav aria-label="Main navigation">
          <a className="landing-nav-link" href="#how-it-works">How it works</a>
          <a className="landing-nav-link" href="#curriculum">The curriculum</a>
          <Link className="landing-nav-start" to={`/game/${next.id}`}>
            {finished ? "Revisit" : completed > 0 ? "Continue" : "Get started"} <ArrowUpRight size={16} />
          </Link>
        </nav>
      </header>

      <section className="landing-hero" id="top" aria-labelledby="landing-title">
        <div className="landing-hero-inner landing-width">
          <div className="landing-hero-copy">
            <p className="landing-eyebrow"><span /> A playground for system design</p>
            <h1 id="landing-title">Small links.<br /><span>Big systems.</span></h1>
            <p className="landing-hero-description">Learn system design by building a link shortener. Start small, grow your traffic, and discover why every piece belongs.</p>
            <div className="landing-hero-actions">
              <Link className="landing-button" to={`/game/${next.id}`}>
                <Play size={15} fill="currentColor" /> {startLabel} <ArrowRight size={18} />
              </Link>
              <a className="landing-text-link" href="#curriculum">Explore the lessons <ArrowDown size={15} /></a>
            </div>
            <p className="landing-start-note">Beginner friendly <span>·</span> No sign-up <span>·</span> Learn at your pace</p>
            {completed > 0 && (
              <div className="landing-resume" aria-label="Your learning progress">
                <span className="landing-resume-track" aria-hidden="true"><i style={{ width: `${completed / levels.length * 100}%` }} /></span>
                <span>{completed} of {levels.length} lessons complete</span>
                <span className="landing-resume-stars"><Star size={13} /> {stars}</span>
              </div>
            )}
          </div>
          <LandingPreview />
        </div>
        <div className="landing-hero-bottom landing-width">
          <p>One product. A whole world of design decisions.</p>
          <a href="#how-it-works">Take a look around <ArrowDown size={14} /></a>
        </div>
      </section>

      <section className="landing-method landing-width" id="how-it-works" aria-labelledby="method-title">
        <div className="landing-section-intro">
          <p className="landing-eyebrow">Learn by doing</p>
          <h2 id="method-title">The idea makes sense<br />when you can see it work.</h2>
          <p>You bring the curiosity. The park gives you a system to build, break, and make better.</p>
        </div>
        <ol className="landing-method-steps">
          {learningSteps.map((step, index) => (
            <li key={step.title}>
              <span className="landing-step-number">0{index + 1}</span>
              <div><h3>{step.title}</h3><p>{step.body}</p></div>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing-course" id="curriculum" aria-labelledby="course-title">
        <div className="landing-width">
          <div className="landing-course-heading">
            <div>
              <p className="landing-eyebrow">Your learning path</p>
              <h2 id="course-title">A little more capable.<br />One lesson at a time.</h2>
            </div>
            <p>From your first request to distributed systems.<br />{levels.length} lessons, all built around one link shortener.</p>
          </div>
          <div className="landing-course-layout">
            <aside className="landing-course-guide">
              <span className="landing-course-guide-icon"><GitFork size={27} /></span>
              <h3>{completed > 0 ? "Pick up where you left off." : "Every system starts somewhere."}</h3>
              <p>{finished ? "You have completed every lesson. Revisit a topic or refine your final design." : "Follow the lessons in order. Each new challenge builds on the ideas you have already explored."}</p>
              <Link className="landing-text-link" to={`/game/${next.id}`}>
                {finished ? "Revisit the capstone" : completed > 0 ? `Continue ${next.title}` : "Begin with the brief"} <ArrowRight size={16} />
              </Link>
              <div className="landing-course-count"><strong>{String(completed).padStart(2, "0")}</strong><span>/ {levels.length} lessons<br />completed</span></div>
            </aside>
            <div className="landing-course-parts">
              {parts.map((part) => (
                <div className="landing-course-part" key={part.number}>
                  <div className="landing-part-heading"><span>Part {String(part.number).padStart(2, "0")}</span><h3>{part.title}</h3></div>
                  {part.modules.map((module) => {
                    const moduleCompleted = module.levels.filter((level) => progress.levels[level.id]?.completed).length;
                    const moduleFinished = moduleCompleted === module.levels.length;
                    return (
                      <details className={`landing-module ${moduleFinished ? "is-complete" : ""}`} key={module.number} open={module.number === next.module}>
                        <summary>
                          <span className="landing-module-number">{moduleFinished ? <Check size={17} /> : String(module.number).padStart(2, "0")}</span>
                          <span className="landing-module-title"><strong>{module.title}</strong><span>{module.summary}</span></span>
                          <span className="landing-module-meta">{moduleCompleted > 0 ? `${moduleCompleted} / ${module.levels.length}` : `${module.levels.length} lessons`}</span>
                          <ChevronDown className="landing-module-chevron" size={18} />
                        </summary>
                        <ol className="landing-lessons">
                          {module.levels.map((level) => {
                            const unlocked = isUnlocked(progress, level.id);
                            const record = progress.levels[level.id];
                            const current = !finished && level.id === next.id;
                            const content = (
                              <>
                                <span className="landing-lesson-code">{level.code}</span>
                                <span className="landing-lesson-copy"><strong>{level.concept}</strong><span>{level.title}{level.kind === "quiz" ? " · Design questions" : " · Build & run"}</span></span>
                                {record?.completed ? (
                                  <span className="landing-lesson-stars" aria-label={`${record.stars} of 3 stars`}>
                                    {[1, 2, 3].map((star) => <Star key={star} size={12} className={star <= record.stars ? "earned" : ""} />)}
                                  </span>
                                ) : current ? <span className="landing-lesson-current">Up next <ArrowRight size={14} /></span> : <Lock size={14} aria-label="Locked" />}
                              </>
                            );
                            return (
                              <li key={level.id}>
                                {unlocked ? <Link className={`landing-lesson ${current ? "is-current" : ""}`} to={`/game/${level.id}`}>{content}</Link> : <div className="landing-lesson is-locked" aria-disabled="true">{content}<span className="landing-sr-only">Complete the previous lesson to unlock.</span></div>}
                              </li>
                            );
                          })}
                        </ol>
                      </details>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="landing-closing landing-width">
        <p className="landing-eyebrow">Your first system is waiting</p>
        <h2>A few pieces.<br />A lot of possibilities.</h2>
        <Link className="landing-button" to={`/game/${next.id}`}>{startLabel} <ArrowRight size={18} /></Link>
        <p>Runs in your browser. Your progress stays with you on this device.</p>
      </section>
      <footer className="landing-footer landing-width">
        <span className="landing-footer-brand"><GitFork size={18} /> ScaleLab Park</span>
        <p>An educational simulation. Simplified numbers, real design ideas.</p>
        <a href="#top">Back to top <ArrowUpRight size={14} /></a>
      </footer>
    </main>
  );
}
