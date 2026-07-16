import { useEffect } from "react";

import { TycoonGame } from "@/components/tycoon-game";

export default function Home() {
  useEffect(() => {
    document.title = "ScaleLab Park — Guided system design";
  }, []);
  return <TycoonGame />;
}
