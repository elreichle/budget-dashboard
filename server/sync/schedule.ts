import type { SyncService } from "./service.js";

export interface SchedulerHandle {
  /** False when the interval was 0 and nothing was scheduled. */
  active: boolean;
  stop(): void;
}

export interface Timers {
  setInterval: (fn: () => void, ms: number) => NodeJS.Timeout;
  clearInterval: (t: NodeJS.Timeout) => void;
}

/**
 * Triggers a sync every `intervalMinutes`. A tick is skipped while a run is in flight and while
 * the connector has no credentials yet (no failed run rows piling up before setup). Failures
 * are logged, never thrown. The timer is unref'd so it never keeps the process alive; 0
 * disables scheduling.
 */
export function startSyncScheduler(service: SyncService, intervalMinutes: number, timers: Timers = globalThis): SchedulerHandle {
  if (intervalMinutes <= 0) return { active: false, stop() {} };
  const timer = timers.setInterval(() => {
    if (!service.configured()) return;
    service
      .trigger()
      ?.then((result) => {
        if (result.failure) console.error(`scheduled sync failed (${result.failure.code}): ${result.failure.message}`);
      })
      .catch((err: unknown) => console.error("scheduled sync could not run:", err));
  }, intervalMinutes * 60_000);
  timer.unref();
  return {
    active: true,
    stop: () => timers.clearInterval(timer),
  };
}
