import type { FileBucketResponse, ReviewResponse } from "../api.js";
import { formatMoney } from "../lib/money.js";
import { formatDate } from "../lib/time.js";
import type { AsyncState } from "../lib/useAsync.js";
import type { BucketOption } from "./buckets.js";
import { FilingForm } from "./FilingForm.js";

interface Props {
  state: AsyncState<ReviewResponse>;
  /** Empty while the plan does not load: the inbox is then read-only. */
  options: readonly BucketOption[];
  currency: string;
  onFiled: (result: FileBucketResponse) => void;
}

/** Every transaction that needs review (unfiled, uncategorized, or in a bucket the plan no longer has), across months and accounts, each with its own filing form. */
export function ReviewInbox({ state, options, currency, onFiled }: Props) {
  const items = state.status === "ok" ? state.data.transactions : [];
  return (
    <section className="card inbox" aria-labelledby="inbox-title" aria-busy={state.status === "loading"}>
      <div className="section-head">
        <h2 id="inbox-title">Review inbox</h2>
        {items.length > 0 && <span className="muted">{items.length} to file</span>}
      </div>
      {state.status === "loading" && <p className="muted">Loading the inbox…</p>}
      {state.status === "error" && (
        <p className="error-text" role="alert">
          {state.error.message}
        </p>
      )}
      {state.status === "ok" && items.length === 0 && <p className="muted">All caught up: nothing needs review.</p>}
      {items.length > 0 && (
        <ul className="inbox-list">
          {items.map((t) => (
            <li key={t.id} className={t.pending ? "inbox-item pending" : "inbox-item"}>
              <div className="txn-line">
                <span>
                  <span className="txn-desc">{t.description}</span>
                  {t.pending && <span className="tag">Pending</span>}
                </span>
                <span className={t.amount > 0 ? "money amount-in" : "money"}>{formatMoney(t.amount, currency)}</span>
              </div>
              <div className="txn-meta">
                {formatDate(t.date)} · {t.account.name}
              </div>
              {options.length > 0 && <FilingForm transaction={t} options={options} onFiled={onFiled} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
