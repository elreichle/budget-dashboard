import { getPlan, getStreaks, type Plan } from "../api.js";
import { Celebrations } from "../celebrate/Celebrations.js";
import { FirstRunCard } from "../components/FirstRunCard.js";
import { GoalsOverview } from "../goals/GoalsOverview.js";
import { useAsync } from "../lib/useAsync.js";
import { MonthOverview } from "../overview/MonthOverview.js";

export function Overview() {
  const plan = useAsync(getPlan);

  if (plan.status === "loading") return <p className="muted">Loading your plan…</p>;
  if (plan.status === "error") {
    return (
      <section className="card problem">
        <h2>Could not load the plan</h2>
        <p>{plan.error.message}</p>
      </section>
    );
  }
  const state = plan.data;
  if (!state.ok) {
    if (state.error === "plan_missing") return <FirstRunCard path={state.path} hint={state.hint} />;
    return (
      <section className="card problem" aria-labelledby="plan-invalid-title">
        <h2 id="plan-invalid-title">The plan file needs a fix</h2>
        <p>
          <code>{state.path}</code> did not validate:
        </p>
        <ul>
          {state.issues.map((issue, i) => (
            <li key={i}>
              {issue.path ? `${issue.path}: ` : ""}
              {issue.message}
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return <PlanOverview plan={state.plan} />;
}

/** A valid plan's overview: meters, debt and savings, then the celebrations. Streaks load once and badge both. */
function PlanOverview({ plan }: { plan: Plan }) {
  const streaks = useAsync(getStreaks);
  // Badges are a bonus: until streaks load, or if they cannot, the meters and goals go without.
  const found = streaks.status === "ok" ? streaks.data : null;
  return (
    <>
      <MonthOverview currency={plan.currency} streaks={found?.buckets} />
      <GoalsOverview plan={plan} streaks={found?.goals} />
      <Celebrations />
    </>
  );
}
