import { Toaster } from "@infraplay/ui/components/sonner";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { Outlet, useLocation } from "react-router";
import Header from "./components/header";
import { queryClient } from "./utils/trpc";

export default function App() {
  const location = useLocation();
  const isGameSurface = location.pathname === "/" || location.pathname.startsWith("/game/");
  return (
    <QueryClientProvider client={queryClient}>
      <div className="app-shell">
        {!isGameSurface && <Header />}
        <Outlet />
      </div>
      <Toaster richColors />
      <ReactQueryDevtools position="bottom" buttonPosition="bottom-right" />
    </QueryClientProvider>
  );
}
