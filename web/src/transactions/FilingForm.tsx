import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { fileTransaction, type FileBucketResponse, type Transaction } from "../api.js";
import type { BucketOption } from "./buckets.js";

interface Props {
  transaction: Pick<Transaction, "id" | "description" | "bucketId">;
  options: readonly BucketOption[];
  onFiled: (result: FileBucketResponse) => void;
  /** Adds a Cancel button and closes on Escape. */
  onCancel?: () => void;
  autoFocus?: boolean;
}

/**
 * Files one transaction through `POST /api/transactions/:id/bucket`. The picker is a native
 * select and Enter submits, so it works from the keyboard. "Save as rule" reveals the match
 * text, prefilled with the trimmed description. A successful filing leaves the form locked:
 * the caller refreshes and the row it belongs to moves away or closes.
 */
export function FilingForm({ transaction, options, onFiled, onCancel, autoFocus = false }: Props) {
  const description = transaction.description.trim();
  const current = transaction.bucketId;
  const [bucket, setBucket] = useState(current !== null && options.some((o) => o.id === current) ? current : "");
  const [saveRule, setSaveRule] = useState(false);
  const [match, setMatch] = useState(description);
  const [status, setStatus] = useState<"idle" | "busy" | "filed">("idle");
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (autoFocus) picker.current?.focus();
  }, [autoFocus]);

  const locked = status !== "idle";
  const canSubmit = !locked && bucket !== "" && (!saveRule || match.trim() !== "");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setStatus("busy");
    setError(null);
    try {
      const result = await fileTransaction(transaction.id, saveRule ? { bucket, saveRule: true, match: match.trim() } : { bucket });
      setStatus("filed");
      onFiled(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("idle");
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape" && onCancel && !locked) {
      event.preventDefault();
      onCancel();
    }
  }

  return (
    <form className="filing" aria-label={`File ${description}`} onSubmit={(e) => void submit(e)} onKeyDown={onKeyDown}>
      <label>
        <span className="visually-hidden">Bucket</span>
        <select ref={picker} value={bucket} onChange={(e) => setBucket(e.target.value)} disabled={locked}>
          <option value="" disabled>
            Choose a bucket…
          </option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="filing-rule">
        <input type="checkbox" checked={saveRule} onChange={(e) => setSaveRule(e.target.checked)} disabled={locked} />
        Save as rule
      </label>
      {saveRule && (
        <label className="filing-match">
          <span>Matches</span>
          <input type="text" value={match} onChange={(e) => setMatch(e.target.value)} disabled={locked} spellCheck={false} />
        </label>
      )}
      <button type="submit" className="button" disabled={!canSubmit}>
        {status === "busy" ? "Filing…" : "File"}
      </button>
      {onCancel && (
        <button type="button" className="button secondary" onClick={onCancel} disabled={locked}>
          Cancel
        </button>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
