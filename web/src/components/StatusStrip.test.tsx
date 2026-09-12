import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncRun, SyncStatus } from "../api.js";
import { POLL_IDLE_MS, POLL_RUNNING_MS, StatusStrip } from "./StatusStrip.js";

const api = vi.hoisted(() => ({ getSyncStatus: vi.fn<() => Promise<SyncStatus>>() }));
vi.mock("../api.js", () => api);

const run = (over: Partial<SyncRun>): SyncRun => ({
  id: 1,
  connector: "simplefin",
  startedAt: "2026-09-10T12:00:00.000Z",
  finishedAt: "2026-09-10T12:00:05.000Z",
  accountsN: 4,
  transactionsN: 120,
  error: null,
  requestedSince: null,
  ...over,
});

const flush = () => act(async () => {});

beforeEach(() => {
  vi.useFakeTimers();
  api.getSyncStatus.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("StatusStrip", () => {
  it("polls quickly while a sync runs and shows the result when it finishes", async () => {
    api.getSyncStatus.mockResolvedValueOnce({ running: true, last: null }).mockResolvedValue({ running: false, last: run({}) });
    render(<StatusStrip />);
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent("Sync running…");

    await act(async () => vi.advanceTimersByTime(POLL_RUNNING_MS));
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent(/120 transactions across 4 accounts/);
    expect(api.getSyncStatus).toHaveBeenCalledTimes(2);
  });

  it("re-reads the status periodically when idle, to catch scheduled syncs", async () => {
    api.getSyncStatus.mockResolvedValueOnce({ running: false, last: null }).mockResolvedValue({ running: false, last: run({ error: "connector timed out" }) });
    render(<StatusStrip />);
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent("Never synced");

    await act(async () => vi.advanceTimersByTime(POLL_RUNNING_MS));
    expect(api.getSyncStatus).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(POLL_IDLE_MS));
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent(/last sync failed .*connector timed out/i);
  });

  it("does not show a run that never finished as a success", async () => {
    api.getSyncStatus.mockResolvedValue({ running: false, last: run({ finishedAt: null, accountsN: 0, transactionsN: 0 }) });
    render(<StatusStrip />);
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent(/last sync did not finish/i);
    expect(screen.getByRole("status")).not.toHaveTextContent(/transactions across/);
  });
});
