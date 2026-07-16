import { Outlet } from "react-router";

export default function App() {
  return (
    <div className="app-shell">
      <Outlet />
    </div>
  );
}
