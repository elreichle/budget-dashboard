import type { Db } from "./db/index.js";
import type { SchedulerHandle } from "./sync/schedule.js";

/** How long open requests get to finish before their connections are cut. */
export const SHUTDOWN_GRACE_MS = 5_000;

/** The part of the HTTP server shutdown uses; `@hono/node-server`'s `serve` result fits. */
export interface ClosableServer {
  close(callback?: (err?: Error) => void): unknown;
  /** Node's http.Server has it; an HTTP/2 server does not. */
  closeAllConnections?(): void;
}

export interface ShutdownServices {
  scheduler: Pick<SchedulerHandle, "stop">;
  db: Pick<Db, "close">;
}

/** The slice of `process` shutdown touches; tests pass a fake instead of sending real signals. */
export interface ShutdownProcess {
  once(event: "SIGTERM" | "SIGINT", listener: () => void): unknown;
  exit(code: number): void;
}

/**
 * On SIGTERM or SIGINT: stop scheduling syncs, stop accepting connections, and once the server
 * has closed (open requests get `SHUTDOWN_GRACE_MS`), close the database and exit 0. A run in
 * flight at that point fails against the closed database; the next start marks it `interrupted`.
 */
export function installShutdown(server: ClosableServer, services: ShutdownServices, proc: ShutdownProcess = process): void {
  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    console.log(`${signal} received, shutting down`);
    services.scheduler.stop();
    const grace = setTimeout(() => server.closeAllConnections?.(), SHUTDOWN_GRACE_MS);
    grace.unref();
    server.close(() => {
      clearTimeout(grace);
      services.db.close();
      proc.exit(0);
    });
  };
  proc.once("SIGTERM", () => shutdown("SIGTERM"));
  proc.once("SIGINT", () => shutdown("SIGINT"));
}
