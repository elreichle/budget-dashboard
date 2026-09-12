import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../db/index.js";
import { account, fakeConnector } from "./__fixtures__/fakeConnector.js";
import { startSyncScheduler } from "./schedule.js";
import { createSyncService } from "./service.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("startSyncScheduler", () => {
  it("does nothing when the interval is 0", () => {
    const service = createSyncService(openDatabase(":memory:"), fakeConnector());
    const trigger = vi.spyOn(service, "trigger");
    const handle = startSyncScheduler(service, 0);
    expect(handle.active).toBe(false);
    vi.advanceTimersByTime(60 * 60_000);
    expect(trigger).not.toHaveBeenCalled();
    handle.stop();
  });

  it("triggers a sync every interval and stops on request", async () => {
    const service = createSyncService(openDatabase(":memory:"), fakeConnector({ accounts: [account()] }));
    const trigger = vi.spyOn(service, "trigger");

    const handle = startSyncScheduler(service, 15);
    expect(handle.active).toBe(true);
    expect(trigger).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(trigger).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(trigger).toHaveBeenCalledTimes(2);

    handle.stop();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(trigger).toHaveBeenCalledTimes(2);
  });

  it("skips ticks while the connector is not configured", async () => {
    const connector = fakeConnector({ accounts: [account()] });
    connector.configured = false;
    const service = createSyncService(openDatabase(":memory:"), connector);
    const trigger = vi.spyOn(service, "trigger");
    const handle = startSyncScheduler(service, 15);
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(trigger).not.toHaveBeenCalled();
    connector.configured = true;
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(trigger).toHaveBeenCalledTimes(1);
    handle.stop();
  });

  it("logs, and does not throw, when a run rejects", async () => {
    const service = createSyncService(openDatabase(":memory:"), fakeConnector());
    vi.spyOn(service, "trigger").mockImplementation(() => Promise.reject(new Error("database is locked")));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const handle = startSyncScheduler(service, 15);
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(error).toHaveBeenCalledWith("scheduled sync could not run:", expect.any(Error));
    handle.stop();
    error.mockRestore();
  });

  it("unrefs the timer so it never keeps the process alive", () => {
    const service = createSyncService(openDatabase(":memory:"), fakeConnector());
    const unref = vi.fn();
    const clearInterval = vi.fn();
    const timers = {
      setInterval: vi.fn(() => ({ unref }) as unknown as NodeJS.Timeout),
      clearInterval,
    };
    const handle = startSyncScheduler(service, 30, timers);
    expect(timers.setInterval).toHaveBeenCalledWith(expect.any(Function), 30 * 60_000);
    expect(unref).toHaveBeenCalledOnce();
    handle.stop();
    expect(clearInterval).toHaveBeenCalledOnce();
  });
});
