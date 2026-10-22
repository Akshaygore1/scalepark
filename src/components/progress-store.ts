import { useSyncExternalStore } from "react";

import { restoreProgress, saveProgress, type Progress } from "@/lib/progress";

let current: Progress | undefined;
let saveTimer: number | undefined;
const listeners = new Set<() => void>();

function read(): Progress {
  current ??= restoreProgress(window.localStorage);
  return current;
}

function flush() {
  window.clearTimeout(saveTimer);
  saveTimer = undefined;
  if (current) saveProgress(window.localStorage, current);
}

/** Update progress. Frequent edits, like dragging a building, are saved after a short pause. */
export function updateProgress(change: (progress: Progress) => Progress, options = { debounce: false }) {
  current = change(read());
  for (const listener of listeners) listener();
  if (options.debounce) {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(flush, 400);
  } else {
    flush();
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    if (saveTimer !== undefined) flush();
  });
}

export function useProgress(): Progress {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    read,
  );
}
