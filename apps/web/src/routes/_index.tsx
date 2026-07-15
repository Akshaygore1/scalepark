import { TycoonGame } from "@/components/tycoon-game";

export function meta() {
  return [
    { title: "ScaleLab Park — A system design tycoon" },
    {
      name: "description",
      content:
        "Grow a URL-shortener startup and learn system design through a living traffic simulation.",
    },
  ];
}

export default function Home() {
  return <TycoonGame />;
}
