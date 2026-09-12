import { useEffect, useState } from "react";
import { getMonth, listMonths, type MonthList, type MonthSummary, type Streak } from "../api.js";
import { Link } from "../lib/router.js";
import { formatMoney, formatWhole } from "../lib/money.js";
import { formatMonth } from "../lib/time.js";
import { useAsync } from "../lib/useAsync.js";
import { BucketMeter } from "./BucketMeter.js";
import { daysLeftLabel } from "./meter.js";

const GROUPS = [
  { id: "fixed", label: "Fixed" },
  { id: "living", label: "Living" },
] as const;

/**
 * The month's bucket meters with a picker for past months. Starts on the server's current month.
 * Streaks run through the last closed month, so only the current month's meters wear them.
 */
export function MonthOverview({ currency, streaks }: { currency: string; streaks?: readonly Streak[] | undefined }) {
  const months = useAsync(listMonths);
  const [picked, setPicked] = useState<string | null>(null);
  const month = picked ?? (months.status === "ok" ? months.data.current : null);

  if (months.status === "loading") return <p className="muted">Loading months…</p>;
  if (months.status === "error") return <LoadError message={months.error.message} />;
  return <MonthView month={month!} months={months.data} currency={currency} streaks={month === months.data.current ? streaks : undefined} onPick={setPicked} />;
}

function MonthView({ month, months, currency, streaks, onPick }: { month: string; months: MonthList; currency: string; streaks: readonly Streak[] | undefined; onPick: (month: string) => void }) {
  const summary = useAsync(() => getMonth(month), [month]);
  // While another month loads, the previous one stays up (dimmed) so the meters are not
  // remounted and their fill animation plays only once.
  const [shown, setShown] = useState<MonthSummary | null>(null);
  useEffect(() => {
    if (summary.status === "ok") setShown(summary.data);
  }, [summary]);
  const view = summary.status === "ok" ? summary.data : summary.status === "loading" ? shown : null;

  const options = [...new Set([months.current, month, ...months.months])].sort().reverse();

  return (
    <section className="month" aria-busy={summary.status === "loading"}>
      <div className="month-head">
        <h1>{formatMonth(month)}</h1>
        <label className="month-picker">
          <span className="visually-hidden">Month</span>
          <select value={month} onChange={(e) => onPick(e.target.value)}>
            {options.map((m) => (
              <option key={m} value={m}>
                {formatMonth(m)}
                {m === months.current ? " (this month)" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      {summary.status === "error" && <LoadError message={summary.error.message} />}
      {view === null && summary.status === "loading" && <p className="muted">Loading {formatMonth(month)}…</p>}
      {view && (
        <div className={summary.status === "loading" ? "month-body stale" : "month-body"}>
          <p className="month-summary">
            <span>
              Spent <span className="money">{formatMoney(view.totals.posted, currency)}</span> of <span className="money">{formatWhole(view.totals.planned, currency)}</span>
              {view.totals.pending > 0 && (
                <span className="muted">
                  {" "}
                  · <span className="money">{formatMoney(view.totals.pending, currency)}</span> pending
                </span>
              )}
            </span>
            <span className="muted">{daysLeftLabel(view)}</span>
          </p>
          {view.uncategorizedCount > 0 && (
            <p className="inbox-nudge">
              <Link to="/transactions">
                {view.uncategorizedCount} transaction{view.uncategorizedCount === 1 ? " needs" : "s need"} a bucket
              </Link>
            </p>
          )}
          {GROUPS.map((group) => {
            const buckets = view.buckets.filter((b) => b.group === group.id);
            if (buckets.length === 0) return null;
            return (
              <section key={group.id} className="card meter-group" aria-labelledby={`group-${group.id}`}>
                <h2 id={`group-${group.id}`}>{group.label}</h2>
                <ul className="meters">
                  {buckets.map((b) => (
                    <BucketMeter key={b.id} bucket={b} currency={currency} streak={streaks?.find((s) => s.id === b.id)} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}

function LoadError({ message }: { message: string }) {
  return (
    <section className="card problem">
      <h2>Could not load this month</h2>
      <p>{message}</p>
    </section>
  );
}
