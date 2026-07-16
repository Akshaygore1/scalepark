# ScaleLab Park

ScaleLab Park is a browser-based system-design tycoon game. Grow traffic, deploy infrastructure, respond to incidents, and complete a five-chapter campaign or experiment freely in the sandbox.

The application is fully client-side. Campaign progress and attempt history are stored in the browser.

## Run locally

```bash
bun install
bun run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Commands

- `bun run dev` starts the Vite development server.
- `bun run build` creates a production build in `dist/`.
- `bun run preview` serves the production build locally.
- `bun run typecheck` checks the TypeScript project.
- `bun run test` runs the game unit tests.
- `bun run test:e2e` builds the app and runs the Playwright campaign suite.

## Routes

- `/` opens the campaign map.
- `/game/opening-day` through `/game/global-launch` open campaign chapters.
- `/game/sandbox` opens the unrestricted sandbox.
