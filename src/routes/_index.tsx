import { useEffect } from "react";

import { CampaignMap } from "@/components/campaign-map";

export default function Home() {
  useEffect(() => {
    document.title = "ScaleLab Park · Learn system design";
  }, []);
  return <CampaignMap />;
}
