import type { MilestoneView } from "../api.js";
import { formatDate } from "../lib/time.js";
import { milestoneMessage } from "./messages.js";

/**
 * Every milestone reached, dismissed or not, newest first, with the day it was first seen.
 * `history` is null until milestones have loaded once; `error` is shown only in that case.
 */
export function WinsPanel({ history, error }: { history: readonly MilestoneView[] | null; error: Error | null }) {
  return (
    <section className="card wins" aria-labelledby="wins-title">
      <h2 id="wins-title">Wins</h2>
      {history === null && (error ? <p className="muted">Could not load wins: {error.message}</p> : <p className="muted">Loading wins…</p>)}
      {history?.length === 0 && (
        <p className="muted">No wins yet. Paying off a card, closing a month under plan or reaching a savings target will show up here.</p>
      )}
      {history !== null && history.length > 0 && (
        <ul className="wins-list">
          {history.map((m) => (
            <li key={m.id} className="win">
              <span>{milestoneMessage(m)}</span>
              {/* The server judges milestones by its UTC calendar day, so that is the day shown. */}
              <time className="win-date" dateTime={m.firstSeen}>
                {formatDate(m.firstSeen)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
