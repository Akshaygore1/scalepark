import { TycoonGame } from "@/components/tycoon-game";
import { gameLevelById } from "@/lib/game";
import { useEffect } from "react";
import { Navigate, useParams } from "react-router";

export default function GameLevel() {
  const { level: levelId } = useParams();
  const level = levelId ? gameLevelById(levelId) : undefined;
  if (!level) {
    return <Navigate replace to="/" />;
  }
  return <GameLevelContent levelId={level.id} levelName={level.name} />;
}

function GameLevelContent({ levelId, levelName }: { levelId: string; levelName: string }) {
  useEffect(() => {
    document.title = `${levelName} — ScaleLab Park`;
  }, [levelName]);
  return <TycoonGame levelId={levelId} />;
}
