import { TycoonGame } from "@/components/tycoon-game";
import { gameLevelById } from "@/lib/game";

import type { Route } from "./+types/game.$level";

export function loader({ params }: Route.LoaderArgs) {
  const level = gameLevelById(params.level);
  if (!level) {
    throw new Response("Not Found", { status: 404 });
  }
  return { levelId: level.id, levelName: level.name };
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData ? `${loaderData.levelName} — ScaleLab Park` : "ScaleLab Park" },
  ];
}

export default function GameLevel({ loaderData }: Route.ComponentProps) {
  return <TycoonGame levelId={loaderData.levelId} />;
}
