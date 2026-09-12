export interface OutcomeState {
  ok: boolean;
  message: string;
  warnings: string[];
}

/** What the last action on a settings card did: a success line with any warnings, or the error. */
export function Outcome({ outcome }: { outcome: OutcomeState | null }) {
  if (!outcome) return null;
  return (
    <div className="outcome">
      <p className={outcome.ok ? "success-text" : "error-text"} role={outcome.ok ? "status" : "alert"}>
        {outcome.message}
      </p>
      {outcome.warnings.length > 0 && (
        <ul className="warnings">
          {outcome.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const failure = (err: unknown): OutcomeState => ({ ok: false, message: err instanceof Error ? err.message : String(err), warnings: [] });
