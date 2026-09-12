import { isIP } from "node:net";
import path from "node:path";
import { hostnameOf } from "./http/guards.js";

/** Runtime configuration read from the environment. Nothing personal lives here; see DATA_DIR. */
export interface Config {
  port: number;
  /** Address the server listens on: 127.0.0.1 unless HOST opens it wider. */
  host: string;
  /** Lower-cased hostnames `/api` answers to besides localhost, 127.0.0.1 and [::1]. */
  allowedHosts: string[];
  dataDir: string;
  syncIntervalMinutes: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 8420);
  if (!Number.isInteger(port) || port <= 0) throw new Error(`Invalid PORT: ${env.PORT}`);
  const syncIntervalMinutes = Number(env.SYNC_INTERVAL_MINUTES ?? 60);
  if (!Number.isFinite(syncIntervalMinutes) || syncIntervalMinutes < 0) {
    throw new Error(`Invalid SYNC_INTERVAL_MINUTES: ${env.SYNC_INTERVAL_MINUTES}`);
  }
  // An address, not a name: tcsh exports HOST as the machine's name, which would open the server to the network.
  const host = env.HOST?.trim() || "127.0.0.1";
  if (host !== "localhost" && isIP(host) === 0) {
    throw new Error(`Invalid HOST: ${host} (use an IP address such as 127.0.0.1 or 0.0.0.0; tcsh sets HOST to the machine name)`);
  }
  const allowedHosts = (env.ALLOWED_HOSTS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const hostname = hostnameOf(entry);
      if (hostname === null) throw new Error(`Invalid ALLOWED_HOSTS entry: ${entry}`);
      return hostname;
    });
  return {
    port,
    host,
    allowedHosts,
    dataDir: path.resolve(env.DATA_DIR ?? "./data"),
    syncIntervalMinutes,
  };
}
