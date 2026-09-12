import { useEffect, useState } from "react";
import { dismissMilestone, getMilestones, type MilestonesResponse } from "../api.js";
import { useAsync } from "../lib/useAsync.js";
import { Confetti } from "./Confetti.js";
import { milestoneMessage } from "./messages.js";
import { WinsPanel } from "./WinsPanel.js";

/** How often the overview re-reads milestones, so one reached by a background sync still gets its moment. */
export const MILESTONE_POLL_MS = 60_000;

/**
 * The overview's celebrations: the oldest milestone not yet dismissed, as a toast with a confetti
 * burst, dismissed on the server so it never returns; then the Wins panel listing them all.
 */
export function Celebrations() {
  const milestones = useAsync(getMilestones);
  const { reload } = milestones;
  const settled = milestones.status === "ok" ? milestones.data : milestones.status === "error" ? milestones.error : null;

  useEffect(() => {
    if (settled === null) return;
    const timer = setTimeout(reload, MILESTONE_POLL_MS);
    return () => clearTimeout(timer);
  }, [settled, reload]);

  // A failed poll keeps the last good answer up, so a blip cannot snatch away a toast being read
  // (or cut its confetti short to replay later). Only a first load that fails shows the error.
  const [lastGood, setLastGood] = useState<MilestonesResponse | null>(null);
  useEffect(() => {
    if (settled !== null && !(settled instanceof Error)) setLastGood(settled);
  }, [settled]);
  const data = milestones.status === "ok" ? milestones.data : lastGood;

  // Hidden the moment Dismiss is pressed rather than after the round trip; shown again if it fails.
  const [hidden, setHidden] = useState<ReadonlySet<number>>(() => new Set());
  const [failure, setFailure] = useState<string | null>(null);
  const queue = data?.undismissed.filter((m) => !hidden.has(m.id)) ?? [];
  const current = queue[0] ?? null;

  function dismiss(id: number) {
    setFailure(null);
    setHidden((ids) => new Set(ids).add(id));
    dismissMilestone(id).then(reload, (err: unknown) => {
      setHidden((ids) => new Set([...ids].filter((x) => x !== id)));
      setFailure(`Could not dismiss: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  return (
    <>
      <Confetti milestoneId={current?.id ?? null} />
      <div className="toast-region" role="status">
        {current && (
          <div className="toast celebration">
            <span className="celebration-icon" aria-hidden="true">
              🎉
            </span>
            <span className="celebration-text">
              <span>{milestoneMessage(current)}</span>
              {queue.length > 1 && <span className="celebration-note">{queue.length - 1} more to celebrate</span>}
              {failure && <span className="celebration-note">{failure}</span>}
            </span>
            <button type="button" className="toast-dismiss" aria-label="Dismiss" onClick={() => dismiss(current.id)}>
              ×
            </button>
          </div>
        )}
      </div>
      <WinsPanel history={data?.history ?? null} error={milestones.status === "error" ? milestones.error : null} />
    </>
  );
}
