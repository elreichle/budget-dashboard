import { useState } from "react";
import { triggerSync, type SyncStatus } from "../api.js";
import { SyncLine } from "../components/StatusStrip.js";
import type { AsyncState } from "../lib/useAsync.js";
import { failure, Outcome, type OutcomeState } from "./Outcome.js";
import { resultWarnings, syncSummary } from "./summary.js";

interface Props {
  status: AsyncState<SyncStatus>;
  /** Whether SimpleFIN holds credentials; null while unknown. */
  configured: boolean | null;
  /** Called after every attempt, so the last-run line catches up with success or failure. */
  onFinished: () => void;
}

/** The last run (when, counts, error) and a Sync now button with what that run did. */
export function SyncCard({ status, configured, onFinished }: Props) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<OutcomeState | null>(null);
  const running = busy || (status.status === "ok" && status.data.running);

  async function run() {
    setBusy(true);
    setOutcome(null);
    try {
      const result = await triggerSync();
      setOutcome({ ok: true, message: syncSummary(result), warnings: resultWarnings(result) });
    } catch (err) {
      setOutcome(failure(err));
    } finally {
      setBusy(false);
      onFinished();
    }
  }

  return (
    <section className="card" aria-labelledby="sync-title">
      <div className="section-head">
        <h2 id="sync-title">Sync</h2>
        <button type="button" className="button" onClick={() => void run()} disabled={running || configured !== true}>
          {running ? "Syncing…" : "Sync now"}
        </button>
      </div>
      <p className="sync-last">
        {status.status === "loading" && "Checking last sync…"}
        {status.status === "error" && (
          <>
            <span className="dot failed" /> Could not read sync status: {status.error.message}
          </>
        )}
        {status.status === "ok" && <SyncLine status={status.data} />}
      </p>
      {configured === false && <p className="muted">Connect SimpleFIN above to sync. CSV imports work without it.</p>}
      <Outcome outcome={outcome} />
    </section>
  );
}
