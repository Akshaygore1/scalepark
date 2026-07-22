# Repository Guide

## Tooling

- Use Bun 1.3.2 (`packageManager` in `package.json`): `bun install`, `bun run dev`, `bun run typecheck`, and `bun run build`.
- `bun run build` is only the Vite production build; run `bun run typecheck` separately because Vite does not type-check. There is no lint or formatter script.
- Do not add tests.

## Architecture

- This is one client-only Vite/React app, not a monorepo. `src/main.tsx` mounts the manually configured browser router in `src/router.tsx`; route-like filenames under `src/routes/` do not imply file-based routing.
- `src/components/tycoon-game.tsx` owns gameplay orchestration, UI state, persistence, and the simulation worker lifecycle. Keep deterministic domain logic in `src/lib/`; `src/workers/simulation.worker.ts` is the live simulation message boundary.
- Campaign definitions, unlock/progression rules, and starting-state validation live together in `src/lib/game.ts`. Architecture schema/import validation is in `src/lib/architecture.ts`; simulation behavior is in `src/lib/simulation.ts`.
- Use the `@/` alias for `src/` imports. The worker must continue to be constructed with `new URL(..., import.meta.url)` so Vite bundles it correctly.

## Compatibility

- Browser persistence and exported architecture JSON are versioned compatibility boundaries: `GAME_PROGRESS_VERSION`, `ATTEMPT_HISTORY_VERSION`, and `ARCHITECTURE_VERSION`. When changing persisted shapes, update the corresponding runtime restore/import validators and migration behavior, not only TypeScript types.
- Campaign and scored simulations use fixed seeds. Preserve deterministic behavior when changing simulation logic or chapter scenarios.
- Development mode dynamically loads `react-grab` from `src/main.tsx`; it must remain excluded from production behavior.
