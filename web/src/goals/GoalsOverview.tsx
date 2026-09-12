import { getDebt, getGoals, type Plan, type Streak } from "../api.js";
import { useAsync } from "../lib/useAsync.js";
import { DebtPayoff } from "./DebtPayoff.js";
import { SavingsGoals } from "./SavingsGoals.js";

/** Debt payoff and savings goals under the month's meters. Each loads on its own and is left out when the plan has nothing for it. */
export function GoalsOverview({ plan, streaks }: { plan: Plan; streaks?: readonly Streak[] | undefined }) {
  return (
    <>
      {plan.debts.length > 0 && <DebtSection currency={plan.currency} />}
      {plan.savingsGoals.length > 0 && <SavingsSection currency={plan.currency} streaks={streaks} />}
    </>
  );
}

function DebtSection({ currency }: { currency: string }) {
  const debt = useAsync(getDebt);
  if (debt.status === "loading") return <p className="muted">Loading debt payoff…</p>;
  if (debt.status === "error") return <LoadError title="Could not load debt payoff" message={debt.error.message} />;
  return <DebtPayoff debt={debt.data} currency={currency} />;
}

function SavingsSection({ currency, streaks }: { currency: string; streaks: readonly Streak[] | undefined }) {
  const goals = useAsync(getGoals);
  if (goals.status === "loading") return <p className="muted">Loading savings goals…</p>;
  if (goals.status === "error") return <LoadError title="Could not load savings goals" message={goals.error.message} />;
  return <SavingsGoals goals={goals.data.goals} currency={currency} streaks={streaks} />;
}

function LoadError({ title, message }: { title: string; message: string }) {
  return (
    <section className="card problem">
      <h2>{title}</h2>
      <p>{message}</p>
    </section>
  );
}
