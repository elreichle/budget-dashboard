import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { accountRoutes } from "./accounts/routes.js";
import type { Config } from "./config.js";
import { connectorRoutes } from "./connectors/routes.js";
import { debtRoutes } from "./debt/routes.js";
import { goalRoutes } from "./goals/routes.js";
import { planUnavailable } from "./http/errors.js";
import { crossSiteGuard, hostForAddress, hostGuard } from "./http/guards.js";
import { milestoneRoutes } from "./milestones/routes.js";
import { monthRoutes } from "./months/routes.js";
import { reviewRoutes } from "./rules/routes.js";
import type { Services } from "./services.js";
import { importRoutes } from "./sync/importRoutes.js";
import { syncRoutes } from "./sync/routes.js";

/**
 * Builds the HTTP app. Kept separate from index.ts so tests can call it without binding a port.
 * The caller builds `services`, so the scheduler can share them and tests can inject an in-memory DB and a fake connector.
 */
export function createApp(config: Config, services: Services): Hono {
  const app = new Hono();
  const plan = services.plan;

  // Every /api error is JSON so the dashboard can always read `error` (and `message` for 500s).
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "internal", message: err.message }, 500);
  });

  // Only /api holds data; the dashboard shell is safe to serve whatever the Host. A specific listen
  // address is reachable only by that address, so it is allowed without listing it.
  const listenHost = hostForAddress(config.host);
  app.use("/api/*", hostGuard(listenHost ? [...config.allowedHosts, listenHost] : config.allowedHosts));
  // A page on another origin can still post a form to localhost; only the dashboard itself may change state.
  app.use("/api/*", crossSiteGuard());

  app.get("/api/health", (c) => c.json({ ok: true, dataDir: config.dataDir }));

  app.get("/api/plan", (c) => {
    const result = plan.load();
    if (result.ok) return c.json(result.plan);
    return planUnavailable(c, result);
  });

  app.route("/api/sync", syncRoutes(services.sync));
  app.route("/api/import", importRoutes(services));
  app.route("/api/connectors", connectorRoutes(services));
  app.route("/api", accountRoutes(services));
  app.route("/api", reviewRoutes(services));
  app.route("/api", monthRoutes(services));
  app.route("/api", debtRoutes(services));
  app.route("/api", goalRoutes(services));
  app.route("/api", milestoneRoutes(services));
  // An unknown API path or method must not fall through to the dashboard shell below.
  app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

  // Built dashboard (vite build -> dist/web). Any non-API path falls back to index.html.
  app.use("/*", serveStatic({ root: "./dist/web" }));
  app.get("/*", serveStatic({ root: "./dist/web", path: "index.html" }));

  return app;
}
