import { useRef, useState, type FormEvent } from "react";
import { getAccounts, importCsv, listCsvPresets } from "../api.js";
import { useAsync } from "../lib/useAsync.js";
import { failure, Outcome, type OutcomeState } from "./Outcome.js";
import { importSummary, resultWarnings } from "./summary.js";

const NEW_ACCOUNT = "new";

/** Upload a bank export: the file, its preset, and an existing account or a name for a new one. */
export function CsvImportCard() {
  const presets = useAsync(listCsvPresets);
  const accounts = useAsync(getAccounts);
  const [file, setFile] = useState<File | null>(null);
  const [preset, setPreset] = useState("");
  const [account, setAccount] = useState("");
  const [accountName, setAccountName] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<OutcomeState | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const accountList = accounts.status === "ok" ? accounts.data.accounts : [];
  // With no account to pick, the only choice is a new one.
  const choice = account === "" && accounts.status === "ok" && accountList.length === 0 ? NEW_ACCOUNT : account;
  const name = accountName.trim();
  const target = choice === NEW_ACCOUNT ? (name ? { accountName: name } : null) : choice ? { accountId: Number(choice) } : null;
  const canSubmit = !busy && file !== null && preset !== "" && target !== null;
  const loadError = presets.status === "error" ? presets.error : accounts.status === "error" ? accounts.error : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit || file === null || target === null) return;
    setBusy(true);
    setOutcome(null);
    try {
      const result = await importCsv({ file, preset, target });
      setOutcome({ ok: true, message: importSummary(result), warnings: resultWarnings(result) });
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      if (result.account && choice === NEW_ACCOUNT) {
        setAccount(String(result.account.id));
        setAccountName("");
      }
      accounts.reload();
    } catch (err) {
      setOutcome(failure(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="csv-title">
      <h2 id="csv-title">Import a CSV</h2>
      <p className="muted">For a bank SimpleFIN cannot reach, download its CSV export and pick the matching format. Importing the same file again does not duplicate anything.</p>
      {loadError && (
        <p className="error-text" role="alert">
          {loadError.message}
        </p>
      )}
      <form className="settings-form" aria-label="Import CSV" onSubmit={(e) => void submit(e)}>
        <label className="field">
          <span>File</span>
          <input ref={fileInput} type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} disabled={busy} />
        </label>
        <label className="field">
          <span>Bank format</span>
          <select value={preset} onChange={(e) => setPreset(e.target.value)} disabled={busy}>
            <option value="" disabled>
              Choose a format…
            </option>
            {(presets.status === "ok" ? presets.data : []).map((p) => (
              <option key={p.name} value={p.name}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Account</span>
          <select value={choice} onChange={(e) => setAccount(e.target.value)} disabled={busy}>
            <option value="" disabled>
              Choose an account…
            </option>
            {accountList.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.institution})
              </option>
            ))}
            <option value={NEW_ACCOUNT}>New account…</option>
          </select>
        </label>
        {choice === NEW_ACCOUNT && (
          <label className="field">
            <span>New account name</span>
            <input type="text" value={accountName} onChange={(e) => setAccountName(e.target.value)} maxLength={80} disabled={busy} />
          </label>
        )}
        <button type="submit" className="button" disabled={!canSubmit}>
          {busy ? "Importing…" : "Import"}
        </button>
      </form>
      <Outcome outcome={outcome} />
    </section>
  );
}
