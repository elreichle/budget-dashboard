import { useState, type FormEvent } from "react";
import { claimSimpleFin, type SimpleFinStatus } from "../api.js";
import type { AsyncState } from "../lib/useAsync.js";
import { failure, Outcome, type OutcomeState } from "./Outcome.js";

interface Props {
  state: AsyncState<SimpleFinStatus>;
  onConnected: () => void;
}

/**
 * Connection state and the setup-token form. A token can be claimed once, so it leaves the
 * input as the request goes out and is never shown again, whatever the answer.
 */
export function SimpleFinCard({ state, onConnected }: Props) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<OutcomeState | null>(null);
  const configured = state.status === "ok" && state.data.configured;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const pasted = token.trim();
    if (busy || pasted === "") return;
    setToken("");
    setBusy(true);
    setOutcome(null);
    try {
      await claimSimpleFin(pasted);
      setOutcome({ ok: true, message: "Connected. Sync now to pull in your accounts.", warnings: [] });
      onConnected();
    } catch (err) {
      setOutcome(failure(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="simplefin-title">
      <div className="section-head">
        <h2 id="simplefin-title">SimpleFIN</h2>
        <span className="connection">
          {state.status === "loading" && "Checking…"}
          {state.status === "error" && (
            <>
              <span className="dot failed" /> Unknown: {state.error.message}
            </>
          )}
          {state.status === "ok" && (
            <>
              <span className={configured ? "dot ok" : "dot"} /> {configured ? "Connected" : "Not connected"}
            </>
          )}
        </span>
      </div>
      <p className="muted">
        {configured ? "Paste a new setup token to replace the connection." : "Create a setup token in your SimpleFIN Bridge account and paste it here."} The token is sent once and not shown again.
      </p>
      <form className="settings-form" aria-label="Connect SimpleFIN" onSubmit={(e) => void submit(e)}>
        <label className="field grow">
          <span>Setup token</span>
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} disabled={busy} />
        </label>
        <button type="submit" className="button" disabled={busy || token.trim() === ""}>
          {busy ? "Connecting…" : configured ? "Reconnect" : "Connect"}
        </button>
      </form>
      <Outcome outcome={outcome} />
    </section>
  );
}
