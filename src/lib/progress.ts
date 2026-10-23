import { levels } from "./curriculum";
import type { Architecture } from "./model";
import { parseArchitecture } from "./park-file";

export const PROGRESS_VERSION = 3 as const;
export const progressStorageKey = "scalelab:progress";

export type LevelRecord = { completed: boolean; stars: 0 | 1 | 2 | 3; bestScore?: number };

export type Progress = {
  version: typeof PROGRESS_VERSION;
  levels: Record<string, LevelRecord>;
  /** The player's latest design for each level, so leaving and returning keeps their work. */
  parks: Record<string, Architecture>;
};

export function emptyProgress(): Progress {
  return { version: PROGRESS_VERSION, levels: {}, parks: {} };
}

function isLevelRecord(value: unknown): value is LevelRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.completed === "boolean" &&
    [0, 1, 2, 3].includes(record.stars as number) &&
    (record.bestScore === undefined || typeof record.bestScore === "number")
  );
}

/**
 * Restore saved progress. Versions before 3 belonged to the old five-chapter campaign,
 * whose levels no longer exist, so they start fresh rather than migrating.
 */
export function restoreProgress(storage: Pick<Storage, "getItem">): Progress {
  const serialized = storage.getItem(progressStorageKey);
  if (!serialized) return emptyProgress();
  try {
    const candidate = JSON.parse(serialized) as Partial<Progress>;
    if (candidate.version !== PROGRESS_VERSION) return emptyProgress();
    const known = new Set(levels.map((level) => level.id).concat("sandbox"));
    const records = Object.entries(candidate.levels ?? {}).filter(
      ([id, record]) => known.has(id) && isLevelRecord(record),
    );
    const parks = Object.entries(candidate.parks ?? {}).flatMap(([id, value]) => {
      const park = known.has(id) ? parseArchitecture(value) : undefined;
      return park ? [[id, park] as const] : [];
    });
    return {
      version: PROGRESS_VERSION,
      levels: Object.fromEntries(records),
      parks: Object.fromEntries(parks),
    };
  } catch {
    return emptyProgress();
  }
}

export function saveProgress(storage: Pick<Storage, "setItem">, progress: Progress) {
  try {
    storage.setItem(progressStorageKey, JSON.stringify(progress));
  } catch {
    // Storage can be full or blocked; progress then lasts for this session only.
  }
}

export function isUnlocked(progress: Progress, levelId: string) {
  if (levelId === "sandbox") return true;
  const index = levels.findIndex((level) => level.id === levelId);
  if (index < 0) return false;
  return index === 0 || Boolean(progress.levels[levels[index - 1]!.id]?.completed);
}

export function recordResult(
  progress: Progress,
  levelId: string,
  result: { stars: 0 | 1 | 2 | 3; score?: number },
): Progress {
  const previous = progress.levels[levelId];
  return {
    ...progress,
    levels: {
      ...progress.levels,
      [levelId]: {
        completed: true,
        stars: Math.max(previous?.stars ?? 0, result.stars) as LevelRecord["stars"],
        bestScore:
          result.score === undefined
            ? previous?.bestScore
            : Math.max(previous?.bestScore ?? 0, result.score),
      },
    },
  };
}

export function savePark(progress: Progress, levelId: string, park: Architecture): Progress {
  return { ...progress, parks: { ...progress.parks, [levelId]: park } };
}

export function forgetPark(progress: Progress, levelId: string): Progress {
  const parks = { ...progress.parks };
  delete parks[levelId];
  return { ...progress, parks };
}
