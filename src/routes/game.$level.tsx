import { useEffect } from "react";
import { Navigate, useParams } from "react-router";

import { GameScreen } from "@/components/game/game-screen";
import { useProgress } from "@/components/progress-store";
import { QuizScreen } from "@/components/quiz-screen";
import { levelById } from "@/lib/curriculum";
import { isUnlocked } from "@/lib/progress";

export default function GameLevel() {
  const { level: levelId = "" } = useParams();
  const progress = useProgress();
  const level = levelById(levelId);
  useEffect(() => {
    if (level) document.title = `${level.title} · ScaleLab Park`;
  }, [level]);
  if (!level || !isUnlocked(progress, level.id)) return <Navigate replace to="/" />;
  return level.kind === "quiz" ? <QuizScreen key={level.id} level={level} /> : <GameScreen key={level.id} level={level} />;
}
