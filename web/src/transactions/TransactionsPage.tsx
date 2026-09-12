import { useEffect, useState } from "react";
import { getPlan, getReview, listMonths, listTransactions, type FileBucketResponse, type MonthList, type Plan, type TransactionsResponse } from "../api.js";
import { Toast } from "../components/Toast.js";
import { Link } from "../lib/router.js";
import { formatMonth } from "../lib/time.js";
import { useAsync } from "../lib/useAsync.js";
import { bucketOptions, ruleSavedMessage } from "./buckets.js";
import { ReviewInbox } from "./ReviewInbox.js";
import { TransactionList } from "./TransactionList.js";

/** The review inbox on top, then the month's transactions with month and account filters. */
export function TransactionsPage() {
  const plan = useAsync(getPlan);
  const months = useAsync(listMonths);
  const failed = plan.status === "error" ? plan.error : months.status === "error" ? months.error : null;

  return (
    <>
      <h1>Transactions</h1>
      {failed ? (
        <section className="card problem">
          <h2>Could not load transactions</h2>
          <p>{failed.message}</p>
        </section>
      ) : plan.status === "ok" && months.status === "ok" ? (
        <TransactionsView plan={plan.data.ok ? plan.data.plan : null} months={months.data} />
      ) : (
        <p className="muted">Loading transactions…</p>
      )}
    </>
  );
}

function TransactionsView({ plan, months }: { plan: Plan | null; months: MonthList }) {
  const currency = plan?.currency ?? "USD";
  const [month, setMonth] = useState(months.current);
  const [accountId, setAccountId] = useState<number | undefined>(undefined);
  const [toast, setToast] = useState<string | null>(null);
  const review = useAsync(getReview);
  const list = useAsync(() => listTransactions({ month, accountId }), [month, accountId]);

  // While another filter loads, the previous rows (and the account list) stay up, dimmed.
  const [shown, setShown] = useState<TransactionsResponse | null>(null);
  useEffect(() => {
    if (list.status === "ok") setShown(list.data);
  }, [list]);
  const view = list.status === "ok" ? list.data : list.status === "loading" ? shown : null;
  // Kept through a failed load too, so an account filter that is set can always be cleared.
  const accounts = view?.accounts ?? shown?.accounts ?? [];

  const ids = review.status === "ok" ? review.data.buckets : (shown?.buckets ?? []);
  // Without a valid plan the server refuses every filing, so nothing offers one.
  const options = plan ? bucketOptions(ids, plan) : [];
  const monthOptions = [...new Set([months.current, month, ...months.months])].sort().reverse();

  function onFiled(result: FileBucketResponse) {
    review.reload();
    list.reload();
    if (result.rule) setToast(ruleSavedMessage(result.rule, plan));
  }

  return (
    <>
      {!plan && (
        <section className="card problem">
          <h2>Filing needs a valid plan</h2>
          <p>
            Buckets come from the plan file, so transactions are read-only for now. <Link to="/">The overview</Link> says what to fix.
          </p>
        </section>
      )}
      <ReviewInbox state={review} options={options} currency={currency} onFiled={onFiled} />
      <section className="card" aria-labelledby="txn-list-title" aria-busy={list.status === "loading"}>
        <div className="section-head">
          <h2 id="txn-list-title">{formatMonth(month)}</h2>
          <div className="filters">
            <label>
              Month
              <select value={month} onChange={(e) => setMonth(e.target.value)}>
                {monthOptions.map((m) => (
                  <option key={m} value={m}>
                    {formatMonth(m)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Account
              <select value={accountId ?? ""} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : undefined)}>
                <option value="">All accounts</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.institution})
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        {list.status === "error" && (
          <p className="error-text" role="alert">
            {list.error.message}
          </p>
        )}
        {view === null && list.status === "loading" && <p className="muted">Loading {formatMonth(month)}…</p>}
        {view && (
          <div className={list.status === "loading" ? "txn-body stale" : "txn-body"}>
            <TransactionList transactions={view.transactions} plan={plan} options={options} currency={currency} onFiled={onFiled} />
          </div>
        )}
      </section>
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
