import { useEffect } from "react";
import { getSyncStatus, type SyncStatus } from "../api.js";
import { formatWhen } from "../lib/time.js";
import { useAsync } from "../lib/useAsync.js";

/** How often the strip re-reads sync status: quickly while a sync runs, otherwise to catch scheduled runs. */
export const POLL_RUNNING_MS = 3_000;
export const POLL_IDLE_MS = 60_000;

/** One line under the nav: when the last sync ran and how it went. */
export function StatusStrip() {
  const status = useAsync(getSyncStatus);
  const running = status.status === "ok" && status.data.running;
  const { reload } = status;

  useEffect(() => {
    if (status.status === "loading") return;
    const timer = setTimeout(reload, running ? POLL_RUNNING_MS : POLL_IDLE_MS);
    return () => clearTimeout(timer);
  }, [status, running, reload]);

  return (
    <div className="status-strip" role="status" aria-live="polite">
      {status.status === "loading" && <span>Checking last sync…</span>}
      {status.status === "error" && (
        <span>
          <span className="dot failed" /> Server unreachable: {status.error.message}
        </span>
      )}
      {status.status === "ok" && <SyncLine status={status.data} />}
    </div>
  );
}

/** The last sync run in one line: running, never, unfinished, failed with its error, or its counts. */
export function SyncLine({ status }: { status: SyncStatus }) {
  if (status.running) {
    return (
      <span>
        <span className="dot running" /> Sync running…
      </span>
    );
  }
  const last = status.last;
  if (!last) {
    return (
      <span>
        <span className="dot" /> Never synced
      </span>
    );
  }
  if (last.finishedAt === null) {
    // Nothing is running, yet the row never finished: the process stopped mid-sync.
    return (
      <span>
        <span className="dot failed" /> Last sync did not finish (started {formatWhen(last.startedAt)})
      </span>
    );
  }
  const when = formatWhen(last.finishedAt);
  if (last.error) {
    return (
      <span>
        <span className="dot failed" /> Last sync failed {when}: {last.error}
      </span>
    );
  }
  return (
    <span>
      <span className="dot ok" /> Last sync {when} · {last.transactionsN} transactions across {last.accountsN} accounts
    </span>
  );
}
