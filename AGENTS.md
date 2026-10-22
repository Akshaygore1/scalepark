# Repository Guide

## Tooling

- Use Bun 1.3.2 (`packageManager` in `package.json`): `bun install`, `bun run dev`, `bun run typecheck`, and `bun run build`.
- `bun run build` is only the Vite production build; run `bun run typecheck` separately because Vite does not type-check. There is no lint or formatter script.
- Do not add tests.

## Architecture

- One client-only Vite/React app. `src/main.tsx` mounts the browser router in `src/router.tsx`; route-like filenames under `src/routes/` do not imply file-based routing.
- Domain logic lives in `src/lib/` and has no React: `model.ts` (buildings, settings, capacities, costs), `topology.ts` (validation and request paths), `simulation.ts` (deterministic per-second engine), `evaluate.ts` (targets, stars, capstone score), `progress.ts` (persistence).
- Levels live in `src/lib/curriculum/`, one file per module of the sys0.in Part 1 syllabus. A level unlocks buildings and settings (`unlocks.features`); the inspector shows only unlocked settings.
- `src/components/game/game-screen.tsx` orchestrates a level through the reducer in `game-state.ts`. A run is simulated in full when it starts and then played back; parks can only be edited while no run is playing.
- Styles are plain CSS in `src/styles/` with the park tokens in `base.css`. No Tailwind.
- Use the `@/` alias for `src/` imports.

## Level design rules

- The starting park must fail in a way that shows the level's idea; the intended fix must pass; brute force (bigger hardware) must fail the budget or another target. Win conditions are outcome targets, never required routes.
- After changing the engine or any level numbers, rebalance with a throwaway script (outside the repo, run via `bun`) that checks the start park, the intended fix, and brute-force alternatives for every level.
- Keep simulation behavior deterministic: no randomness or wall-clock input.

## Compatibility

- Saved progress (`PROGRESS_VERSION`) and exported parks (`ARCHITECTURE_VERSION`) are versioned. When changing persisted shapes, update the runtime validators in `progress.ts` and `park-file.ts`, not only the TypeScript types.
- Development mode dynamically loads `react-grab` from `src/main.tsx`; it must remain excluded from production behavior.
