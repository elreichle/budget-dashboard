import type { ComponentType } from "react";
import { StatusStrip } from "./components/StatusStrip.js";
import { Link, usePath } from "./lib/router.js";
import { Accounts } from "./pages/Accounts.js";
import { Overview } from "./pages/Overview.js";
import { Settings } from "./pages/Settings.js";
import { Transactions } from "./pages/Transactions.js";

interface Route {
  path: string;
  label: string;
  page: ComponentType;
}

export const ROUTES: readonly Route[] = [
  { path: "/", label: "Overview", page: Overview },
  { path: "/transactions", label: "Transactions", page: Transactions },
  { path: "/accounts", label: "Accounts", page: Accounts },
  { path: "/settings", label: "Settings", page: Settings },
];

export function App() {
  const path = usePath();
  const route = ROUTES.find((r) => r.path === path);
  const Page = route?.page ?? NotFound;
  return (
    <>
      <header className="app-header">
        <div className="app-header-inner">
          <a className="brand" href="#/">
            <span className="brand-mark">●</span> Budget Dashboard
          </a>
          <nav className="app-nav" aria-label="Main">
            {ROUTES.map((r) => (
              <Link key={r.path} to={r.path}>
                {r.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <StatusStrip />
      <main className="app-main">
        <Page />
      </main>
    </>
  );
}

function NotFound() {
  return (
    <>
      <h1>Nothing here</h1>
      <section className="card">
        <p>
          That page does not exist. <Link to="/">Back to the overview</Link>.
        </p>
      </section>
    </>
  );
}
