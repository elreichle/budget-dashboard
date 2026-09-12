import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { hostForAddress } from "./http/guards.js";
import { createServices } from "./services.js";
import { installShutdown } from "./shutdown.js";
import { startSyncScheduler } from "./sync/schedule.js";

const config = loadConfig();
const services = createServices(config);
const app = createApp(config, services);
const scheduler = startSyncScheduler(services.sync, config.syncIntervalMinutes);

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`budget-dashboard listening on http://${hostForAddress(config.host) ?? "localhost"}:${info.port} (data dir: ${config.dataDir})`);
  console.log(scheduler.active ? `automatic sync every ${config.syncIntervalMinutes} min` : "automatic sync off (SYNC_INTERVAL_MINUTES=0)");
});

installShutdown(server, { scheduler, db: services.db });
