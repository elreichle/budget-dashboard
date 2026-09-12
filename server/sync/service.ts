import type { Connector } from "../connectors/types.js";
import { finishInterruptedSyncRuns, latestSyncRun, type Db, type SyncRun } from "../db/index.js";
import type { MilestoneDetector } from "../milestones/service.js";
import { runSync, type SyncOptions, type SyncResult } from "./run.js";

export interface SyncStatus {
  running: boolean;
  /** Most recently started run for this connector, or null before the first one. */
  last: SyncRun | null;
}

/**
 * One connector's sync, serialized: at most one run in flight per process. Create it once, at
 * startup: creating it finishes runs a previous process left open (any connector's, CSV imports
 * too) with error `interrupted`.
 */
export interface SyncService {
  /**
   * Starts a run, or returns `undefined` when one is already in flight. Connector and apply
   * failures resolve (see `SyncResult.failure`); the promise rejects only when the database
   * cannot record the run at all.
   */
  trigger(opts?: Pick<SyncOptions, "since">): Promise<SyncResult> | undefined;
  status(): SyncStatus;
  /** Passthrough of `Connector.isConfigured`, for the scheduler and the UI's first-run state. */
  configured(): boolean;
}

export interface SyncServiceOptions extends Pick<SyncOptions, "now" | "categorizer"> {
  /** Runs after each successful run has committed; its warnings join the run's. */
  milestones?: MilestoneDetector;
}

export function createSyncService(db: Db, connector: Connector, opts: SyncServiceOptions = {}): SyncService {
  const { milestones, ...runDefaults } = opts;
  let inFlight: Promise<SyncResult> | undefined;
  finishInterruptedSyncRuns(db, (opts.now ?? (() => new Date().toISOString()))());

  return {
    trigger(runOpts = {}) {
      if (inFlight) return undefined;
      inFlight = runSync(db, connector, { ...runOpts, ...runDefaults })
        .then((result) => {
          if (!result.failure && milestones) result.warnings.push(...milestones.run().warnings);
          return result;
        })
        .finally(() => {
          inFlight = undefined;
        });
      return inFlight;
    },
    status() {
      return { running: inFlight !== undefined, last: latestSyncRun(db, connector.id) ?? null };
    },
    configured: () => connector.isConfigured(),
  };
}
