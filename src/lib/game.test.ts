import { describe, expect, test } from "bun:test";

import {
  GAME_PROGRESS_VERSION,
  campaignParkForChapter,
  campaignChapters,
  completeCampaignChapter,
  emptyGameProgress,
  gameProgressStorageKey,
  restoreGameProgress,
  validateChapterStartingState,
} from "./game";
import { starterArchitecture } from "./architecture";

function memoryStorage(values: Record<string, string>) {
  return {
    getItem(key: string) {
      return values[key] ?? null;
    },
  };
}

describe("campaign progress restoration", () => {
  test("preserves existing chapter unlocks", () => {
    const progress = restoreGameProgress(
      memoryStorage({
        [gameProgressStorageKey]: JSON.stringify({
          version: GAME_PROGRESS_VERSION,
          completedChapterIds: ["opening-day", "first-spike"],
          encounteredConcepts: ["capacity"],
          obsoleteRunState: { second: 42 },
        }),
      }),
    );

    expect(progress.completedChapterIds).toEqual(["opening-day", "first-spike"]);
    expect(progress.claimedRewardChapterIds).toEqual(["opening-day", "first-spike"]);
    expect("obsoleteRunState" in progress).toBe(false);
  });

  test("falls back safely when local progress is malformed", () => {
    expect(restoreGameProgress(memoryStorage({ [gameProgressStorageKey]: "not-json" }))).toEqual(
      emptyGameProgress(),
    );
  });

  test("restores the same park and economy for the next chapter", () => {
    const architecture = starterArchitecture();
    architecture.name = "Akshay's persistent park";
    const progress = restoreGameProgress(
      memoryStorage({
        [gameProgressStorageKey]: JSON.stringify({
          version: GAME_PROGRESS_VERSION,
          completedChapterIds: ["opening-day"],
          encounteredConcepts: ["capacity"],
          claimedRewardChapterIds: ["opening-day"],
          campaignPark: {
            architecture,
            cash: 31_250,
            reputation: 93,
            revenue: 18_400,
            operatingCost: 5_120,
          },
        }),
      }),
    );

    const carried = campaignParkForChapter(progress, campaignChapters[1]!);
    expect(carried.architecture.name).toBe("Akshay's persistent park");
    expect(carried.cash).toBe(31_250);
    expect(carried.reputation).toBe(93);
    expect(progress.claimedRewardChapterIds).toEqual(["opening-day"]);
  });

  test("awards a mission reward once without making replays farmable", () => {
    const chapter = campaignChapters[0]!;
    const park = campaignParkForChapter(emptyGameProgress(), chapter);
    const first = completeCampaignChapter(emptyGameProgress(), chapter, park);
    const replay = completeCampaignChapter(first.progress, chapter, first.progress.campaignPark!);

    expect(first.reward).toBe(12_000);
    expect(first.progress.campaignPark?.cash).toBe(30_000);
    expect(replay.reward).toBe(0);
    expect(replay.progress.campaignPark?.cash).toBe(30_000);
  });

  test("every mission offers a safe planning runway before its traffic wave", () => {
    for (const chapter of campaignChapters) {
      expect(validateChapterStartingState(chapter).safe).toBe(true);
    }
  });
});
