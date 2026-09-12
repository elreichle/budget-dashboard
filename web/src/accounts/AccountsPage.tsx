import { useState } from "react";
import { getAccounts, updateAccount, type AccountPatch, type AccountsResponse, type AccountView, type PlanLink } from "../api.js";
import { formatMoney } from "../lib/money.js";
import { Link } from "../lib/router.js";
import { formatWhen } from "../lib/time.js";
import { useAsync } from "../lib/useAsync.js";

type Role = NonNullable<AccountView["role"]>;

const ROLES: readonly { value: Role; label: string }[] = [
  { value: "checking", label: "Checking" },
  { value: "savings", label: "Savings" },
  { value: "card", label: "Card" },
  { value: "ignore", label: "Ignore" },
];

/** Every synced or imported account with a role select, and debt or goal links for cards and savings. */
export function AccountsPage() {
  const state = useAsync(getAccounts);
  return (
    <>
      <h1>Accounts</h1>
      {state.status === "loading" && <p className="muted">Loading accounts…</p>}
      {state.status === "error" && (
        <section className="card problem">
          <h2>Could not load accounts</h2>
          <p>{state.error.message}</p>
        </section>
      )}
      {state.status === "ok" && <AccountList data={state.data} />}
    </>
  );
}

function AccountList({ data }: { data: AccountsResponse }) {
  const [accounts, setAccounts] = useState(data.accounts);
  const replace = (next: AccountView) => setAccounts((list) => list.map((a) => (a.id === next.id ? next : a)));

  if (accounts.length === 0) {
    return (
      <section className="card first-run">
        <h2>No accounts yet</h2>
        <p>
          Accounts appear here after the first sync or CSV import. <Link to="/settings">Connect SimpleFIN or import a CSV</Link> in Settings.
        </p>
      </section>
    );
  }

  return (
    <section className="card" aria-labelledby="accounts-title">
      <h2 id="accounts-title">Account roles</h2>
      <p className="muted">Income is read from checking, savings goals from savings accounts and debt payoff from cards. Ignored accounts count toward nothing.</p>
      {!data.planOk && <p className="note">Linking debts and goals needs a valid plan file; roles can be set now.</p>}
      <ul className="account-list">
        {accounts.map((a) => (
          <AccountRow key={a.id} account={a} debts={data.debts} goals={data.goals} currency={data.currency} onSaved={replace} />
        ))}
      </ul>
    </section>
  );
}

interface RowProps {
  account: AccountView;
  debts: readonly PlanLink[];
  goals: readonly PlanLink[];
  currency: string;
  onSaved: (account: AccountView) => void;
}

/** Each change is saved at once; while it saves the row shows the new value, and a refusal puts the old one back. */
function AccountRow({ account, debts, goals, currency, onSaved }: RowProps) {
  const [draft, setDraft] = useState<AccountPatch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = draft !== null;
  const role = draft?.role !== undefined ? draft.role : account.role;
  const linkedDebtId = draft?.linkedDebtId !== undefined ? draft.linkedDebtId : account.linkedDebtId;
  // Ids the plan no longer has are dropped on the next save rather than refused.
  const linkedGoalIds = (draft?.linkedGoalIds ?? account.linkedGoalIds).filter((id) => goals.some((g) => g.id === id));
  const titleId = `account-${account.id}`;

  async function save(change: AccountPatch) {
    setDraft(change);
    setError(null);
    try {
      onSaved((await updateAccount(account.id, change)).account);
    } catch (err) {
      setError(`Not saved: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDraft(null);
    }
  }

  function toggleGoal(id: string, on: boolean) {
    void save({ linkedGoalIds: on ? [...linkedGoalIds, id] : linkedGoalIds.filter((g) => g !== id) });
  }

  return (
    <li className="account-row" aria-labelledby={titleId} aria-busy={busy}>
      <div className="account-head">
        <div>
          <h3 id={titleId} className="account-name">
            {account.name}
          </h3>
          <div className="txn-meta">
            {account.institution} · {account.type}
          </div>
        </div>
        <div className="account-balance">
          {account.balance ? (
            <>
              <span className="money">{formatMoney(account.balance.amount, currency)}</span>
              <span className="txn-meta">as of {formatWhen(account.balance.at)}</span>
            </>
          ) : (
            <span className="muted">No balance yet</span>
          )}
        </div>
      </div>
      <div className="account-controls">
        <label className="field">
          <span>Role</span>
          <select value={role ?? ""} disabled={busy} onChange={(e) => void save({ role: e.target.value === "" ? null : (e.target.value as Role) })}>
            <option value="">Not set</option>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        {role === "card" && (
          <label className="field">
            <span>Pays down</span>
            <select value={linkedDebtId ?? ""} disabled={busy || (debts.length === 0 && linkedDebtId === null)} onChange={(e) => void save({ linkedDebtId: e.target.value || null })}>
              <option value="">No debt linked</option>
              {debts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
              {linkedDebtId !== null && !debts.some((d) => d.id === linkedDebtId) && <option value={linkedDebtId}>{linkedDebtId} (not in the plan)</option>}
            </select>
          </label>
        )}
        {role === "savings" && (
          <fieldset className="goal-links" disabled={busy}>
            <legend>Funds goals</legend>
            {goals.length === 0 ? (
              <span className="muted">No savings goals to link</span>
            ) : (
              goals.map((g) => (
                <label key={g.id}>
                  <input type="checkbox" checked={linkedGoalIds.includes(g.id)} onChange={(e) => toggleGoal(g.id, e.target.checked)} />
                  {g.name}
                </label>
              ))
            )}
          </fieldset>
        )}
        {busy && <span className="muted">Saving…</span>}
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}
