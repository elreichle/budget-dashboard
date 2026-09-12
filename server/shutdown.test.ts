import { afterEach, describe, expect, it, vi } from "vitest";
import { installShutdown, SHUTDOWN_GRACE_MS, type ShutdownProcess } from "./shutdown.js";

type Signal = "SIGTERM" | "SIGINT";

function fakes() {
  const events: string[] = [];
  const listeners = new Map<Signal, () => void>();
  let closed: (() => void) | undefined;
  const proc: ShutdownProcess = {
    once: (event, listener) => listeners.set(event, listener),
    exit: (code) => events.push(`exit ${code}`),
  };
  const server = {
    close: (callback?: () => void) => {
      events.push("server.close");
      closed = callback;
    },
    closeAllConnections: () => events.push("server.closeAllConnections"),
  };
  const services = { scheduler: { stop: () => events.push("scheduler.stop") }, db: { close: () => events.push("db.close") } };
  const send = (signal: Signal) => listeners.get(signal)?.();
  const finishClosing = () => closed?.();
  return { events, listeners, proc, server, services, send, finishClosing };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("installShutdown", () => {
  it.each<Signal>(["SIGTERM", "SIGINT"])("on %s stops the scheduler, closes the server, then the database, and exits 0", (signal) => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const f = fakes();
    installShutdown(f.server, f.services, f.proc);
    expect([...f.listeners.keys()].sort()).toEqual(["SIGINT", "SIGTERM"]);
    expect(f.events).toEqual([]);

    f.send(signal);
    expect(f.events).toEqual(["scheduler.stop", "server.close"]);

    f.finishClosing();
    expect(f.events).toEqual(["scheduler.stop", "server.close", "db.close", "exit 0"]);
  });

  it("ignores a second signal while already shutting down", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const f = fakes();
    installShutdown(f.server, f.services, f.proc);
    f.send("SIGTERM");
    f.send("SIGINT");
    f.finishClosing();
    expect(f.events).toEqual(["scheduler.stop", "server.close", "db.close", "exit 0"]);
  });

  it("cuts open connections once the grace period passes, and not before", () => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const f = fakes();
    installShutdown(f.server, f.services, f.proc);
    f.send("SIGTERM");
    vi.advanceTimersByTime(SHUTDOWN_GRACE_MS - 1);
    expect(f.events).not.toContain("server.closeAllConnections");
    vi.advanceTimersByTime(1);
    expect(f.events).toContain("server.closeAllConnections");
    f.finishClosing();
    expect(f.events.slice(-2)).toEqual(["db.close", "exit 0"]);
  });
});
