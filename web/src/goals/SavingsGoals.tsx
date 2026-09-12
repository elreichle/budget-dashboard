import { useId } from "react";
import type { GoalsProgress, Streak } from "../api.js";
import { StreakBadge } from "../celebrate/StreakBadge.js";
import { formatMoney, formatWhole } from "../lib/money.js";
import { formatDate } from "../lib/time.js";
import { ProgressBar } from "./ProgressBar.js";
import { joinNames, percentLabel } from "./progress.js";

type Goal = GoalsProgress["goals"][number];

/** Each savings goal's balance against its next bill (a sinking fund) and its target (a buffer), with its streak of months met. */
export function SavingsGoals({ goals, currency, streaks }: { goals: Goal[]; currency: string; streaks?: readonly Streak[] | undefined }) {
  return (
    <section className="card savings" aria-labelledby="savings-title">
      <h2 id="savings-title">Savings goals</h2>
      <ul className="goal-list">
        {goals.map((g) => (
          <GoalRow key={g.id} goal={g} currency={currency} streak={streaks?.find((s) => s.id === g.id)} />
        ))}
      </ul>
    </section>
  );
}

function GoalRow({ goal, currency, streak }: { goal: Goal; currency: string; streak: Streak | undefined }) {
  const id = useId();
  const { nextBill, target } = goal;
  return (
    <li className="goal" aria-labelledby={id}>
      <div className="progress-head">
        <span className="progress-title">
          <span className="progress-name" id={id}>
            {goal.name}
          </span>
          <StreakBadge streak={streak} />
        </span>
        <span className="progress-figure money">{formatMoney(goal.balance, currency)}</span>
      </div>
      {goal.balanceSource === "none" && <p className="muted note">No linked savings account has synced yet.</p>}
      {nextBill && (
        <div className="goal-part">
          <ProgressBar
            label={`${goal.name}: next bill`}
            percent={nextBill.percent}
            done={nextBill.percent >= 100}
            valueText={`${percentLabel(nextBill.percent)} of ${formatMoney(nextBill.amount, currency)} needed by ${formatDate(nextBill.date)}`}
          />
          <div className="progress-foot">
            <span>
              <span className="money">{formatWhole(nextBill.amount, currency)}</span> needed by {formatDate(nextBill.date)} for {joinNames(nextBill.names)}
            </span>
            <span className="progress-figure">
              {nextBill.percent >= 100 ? (
                "Covered"
              ) : (
                <>
                  <span className="money">{formatMoney(Math.max(0, nextBill.amount - goal.balance), currency)}</span> to go
                </>
              )}
            </span>
          </div>
        </div>
      )}
      {target && (
        <div className="goal-part">
          <ProgressBar label={`${goal.name}: target`} percent={target.percent} done={target.percent >= 100} valueText={`${percentLabel(target.percent)} of the ${formatWhole(target.amount, currency)} target`} />
          <div className="progress-foot">
            <span>
              <span className="money">{formatMoney(goal.balance, currency)}</span> of <span className="money">{formatWhole(target.amount, currency)}</span> target
            </span>
            <span className="progress-figure">{target.percent >= 100 ? "Target reached" : percentLabel(target.percent)}</span>
          </div>
        </div>
      )}
      {!nextBill && !target && <p className="muted note">The plan sets no bill or target for this goal.</p>}
    </li>
  );
}
