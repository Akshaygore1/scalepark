import { createBrowserRouter } from "react-router";

import App from "./root";
import GameLevel from "./routes/game.$level";
import Home from "./routes/_index";

function NotFound() {
  return (
    <main className="route-error">
      <p className="menu-eyebrow">404</p>
      <h1>That route is outside the park.</h1>
      <a href="/">Return to the campaign map</a>
    </main>
  );
}

export const router = createBrowserRouter([
  {
    path: "/",
    Component: App,
    ErrorBoundary: NotFound,
    children: [
      { index: true, Component: Home },
      { path: "game/:level", Component: GameLevel },
      { path: "*", Component: NotFound },
    ],
  },
]);
