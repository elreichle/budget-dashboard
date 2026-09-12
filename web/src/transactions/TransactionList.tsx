import { Fragment, useEffect, useId, useRef, useState } from "react";
import type { FileBucketResponse, Plan, ReviewItem } from "../api.js";
import { formatMoney } from "../lib/money.js";
import { formatDate } from "../lib/time.js";
import { bucketLabel, type BucketOption } from "./buckets.js";
import { FilingForm } from "./FilingForm.js";

interface Props {
  transactions: readonly ReviewItem[];
  plan: Plan | null;
  /** Empty while the plan does not load: chips are then plain labels. */
  options: readonly BucketOption[];
  currency: string;
  onFiled: (result: FileBucketResponse) => void;
}

/** The filtered transactions as a table. A row's bucket chip opens a filing form beneath it. */
export function TransactionList({ transactions, plan, options, currency, onFiled }: Props) {
  const [editing, setEditing] = useState<number | null>(null);
  const editingNow = useRef(editing);
  useEffect(() => {
    editingNow.current = editing;
  });
  const ids = useId();

  if (transactions.length === 0) return <p className="muted">No transactions for these filters.</p>;

  // A filing can land after the user has opened another row: only close the editor it came from.
  const close = (id: number) => {
    if (editingNow.current !== id) return;
    editingNow.current = null;
    setEditing(null);
    document.getElementById(`${ids}-chip-${id}`)?.focus();
  };

  return (
    <div className="table-scroll">
      <table className="txn-table">
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Description</th>
            <th scope="col" className="num">
              Amount
            </th>
            <th scope="col">Bucket</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((t) => {
            const open = editing === t.id;
            const label = t.bucketId === null ? "Needs a bucket" : bucketLabel(t.bucketId, plan);
            const chip = t.bucketId === null ? "chip none" : "chip";
            return (
              <Fragment key={t.id}>
                <tr className={t.pending ? "pending" : undefined}>
                  <td className="date">{formatDate(t.date)}</td>
                  <td>
                    <span className="txn-desc">{t.description}</span>
                    {t.pending && <span className="tag">Pending</span>}
                    <div className="txn-meta">{t.account.name}</div>
                  </td>
                  <td className={t.amount > 0 ? "num money amount-in" : "num money"}>{formatMoney(t.amount, currency)}</td>
                  <td>
                    {options.length > 0 ? (
                      <button
                        type="button"
                        id={`${ids}-chip-${t.id}`}
                        className={chip}
                        title="Change bucket"
                        aria-expanded={open}
                        aria-controls={open ? `${ids}-file-${t.id}` : undefined}
                        onClick={() => setEditing(open ? null : t.id)}
                      >
                        {label}
                      </button>
                    ) : (
                      <span className={chip}>{label}</span>
                    )}
                  </td>
                </tr>
                {open && (
                  <tr className="editor" id={`${ids}-file-${t.id}`}>
                    <td colSpan={4}>
                      <FilingForm
                        transaction={t}
                        options={options}
                        autoFocus
                        onCancel={() => close(t.id)}
                        onFiled={(result) => {
                          close(t.id);
                          onFiled(result);
                        }}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
