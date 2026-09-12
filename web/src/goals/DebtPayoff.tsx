import { useId } from "react";
import type { DebtResponse } from "../api.js";
import { formatMoney, formatWhole } from "../lib/money.js";
import { formatMonth } from "../lib/time.js";
import { ProgressBar } from "./ProgressBar.js";
import { aheadLabel, joinNames, payoffOutlook, percentLabel, type PayoffOutlook } from "./progress.js";

type Figures = Pick<DebtResponse["progress"]["totals"], "startingBalance" | "currentBalance" | "paidSoFar" | "percent">;

/**
 * Debt payoff: when it will be gone, what has been paid and the interest that did not get
 * charged, then a bar per debt (and one for all of them) from the starting balance down to zero.
 */
export function DebtPayoff({ debt, currency }: { debt: DebtResponse; currency: string }) {
  const { progress } = debt;
  const outlook = payoffOutlook(debt);
  const unsynced = progress.debts.filter((d) => d.balanceSource === "plan");
  const estimated = progress.debts.filter((d) => d.balanceSource === "snapshot" && d.interestSource === "estimate");

  return (
    <section className="card payoff" aria-labelledby="payoff-title">
      <h2 id="payoff-title">Debt payoff</h2>
      <dl className="stats">
        <div>
          <dt>{outlook.kind === "planned" ? "Planned debt-free" : "Projected debt-free"}</dt>
          <dd className="stat">{outlookText(outlook)}</dd>
          {outlook.kind === "projected" && outlook.monthsAhead !== null && (
            <dd className={outlook.monthsAhead < 0 ? "schedule behind" : "schedule"}>{aheadLabel(outlook.monthsAhead)}</dd>
          )}
          {outlook.kind === "never" && <dd className="muted">At the planned payments the balance does not reach zero.</dd>}
        </div>
        <div>
          <dt>Paid so far</dt>
          <dd className="stat money">{formatMoney(progress.totals.paidSoFar, currency)}</dd>
        </div>
        <div>
          <dt>Interest saved so far</dt>
          <dd className="stat money">{formatMoney(progress.totals.interestSavedSoFar, currency)}</dd>
          {estimated.length > 0 && (
            <dd className="muted">
              {estimated.length === progress.debts.length
                ? "Estimated from balance changes until interest charges are filed as Interest."
                : `${joinNames(estimated.map((d) => d.name))}: estimated from balance changes until ${estimated.length === 1 ? "its" : "their"} interest charges are filed as Interest.`}
            </dd>
          )}
        </div>
      </dl>
      {unsynced.length > 0 && (
        <p className="muted note">
          {unsynced.length === progress.debts.length
            ? "No card balance has synced yet, so these are the plan's starting balances and its debt-free date."
            : `${joinNames(unsynced.map((d) => d.name))} ${unsynced.length === 1 ? "has not synced yet, so it shows its plan starting balance" : "have not synced yet, so they show their plan starting balances"} and the debt-free date is the plan's.`}
        </p>
      )}
      {progress.debts.length > 1 && (
        <div className="payoff-total">
          <PayoffRow name="All debt" figures={progress.totals} paidOff={progress.totals.currentBalance <= 0} currency={currency} />
        </div>
      )}
      <ul className="payoff-list">
        {progress.debts.map((d) => (
          <li key={d.id}>
            <PayoffRow name={d.name} figures={d} paidOff={d.paidOff} currency={currency} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function outlookText(outlook: PayoffOutlook): string {
  switch (outlook.kind) {
    case "debt-free":
      return "Debt-free now";
    case "never":
      return "Not at current payments";
    case "projected":
      return formatMonth(outlook.month);
    case "planned":
      return outlook.month === null ? "Not at the planned payments" : formatMonth(outlook.month);
  }
}

function PayoffRow({ name, figures, paidOff, currency }: { name: string; figures: Figures; paidOff: boolean; currency: string }) {
  const id = useId();
  const percent = percentLabel(figures.percent);
  return (
    <div className={paidOff ? "payoff-row paid-off" : "payoff-row"}>
      <div className="progress-head">
        <span className="progress-name" id={id}>
          {name}
        </span>
        <span className="progress-figure">{paidOff ? "Paid off" : `${percent} paid`}</span>
      </div>
      <ProgressBar
        labelledBy={id}
        percent={figures.percent}
        done={paidOff}
        valueText={`${percent} paid off, ${formatMoney(figures.currentBalance, currency)} left of ${formatWhole(figures.startingBalance, currency)}`}
      />
      <div className="progress-foot">
        <span>
          Paid <span className="money">{formatMoney(figures.paidSoFar, currency)}</span> so far
        </span>
        <span>
          <span className="money">{formatMoney(figures.currentBalance, currency)}</span> left of <span className="money">{formatWhole(figures.startingBalance, currency)}</span>
        </span>
      </div>
    </div>
  );
}
