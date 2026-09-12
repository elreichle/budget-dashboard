import type { MonthSummary, Streak } from "../api.js";
import { StreakBadge } from "../celebrate/StreakBadge.js";
import { formatMoney, formatWhole } from "../lib/money.js";
import { meterGeometry, PACE_LABEL } from "./meter.js";

type BucketFigures = MonthSummary["buckets"][number];

/**
 * One bucket: posted spending against the plan, pending drawn greyed after it (never counted in
 * the figures), for a living bucket a tick where spending would be if it ran evenly through the month, and the pace,
 * with any running streak of closed months under plan badged by the name.
 */
export function BucketMeter({ bucket, currency, streak }: { bucket: BucketFigures; currency: string; streak?: Streak | undefined }) {
  const geo = meterGeometry(bucket);
  // Over-ness comes from pace alone so the pill and the footer can never disagree.
  const over = bucket.pace === "over";
  const pace = PACE_LABEL[bucket.pace];
  // ARIA needs max > min; an unplanned or overspent bucket scales to what was spent, like the bar.
  const valueMax = Math.max(bucket.planned, bucket.posted) || 1;
  const titleId = `bucket-${bucket.id}`;

  return (
    <li className={`meter pace-${bucket.pace}`} data-bucket={bucket.id}>
      <div className="meter-head">
        <span className="meter-title">
          <span className="meter-name" id={titleId}>
            {bucket.name}
          </span>
          <StreakBadge streak={streak} />
        </span>
        <span className="pace-pill">{pace}</span>
      </div>
      <div
        className="meter-track"
        role="meter"
        aria-labelledby={titleId}
        aria-valuemin={0}
        aria-valuemax={valueMax}
        aria-valuenow={Math.max(0, Math.min(bucket.posted, valueMax))}
        aria-valuetext={`${formatMoney(bucket.posted, currency)} of ${formatWhole(bucket.planned, currency)} spent, ${pace.toLowerCase()}`}
      >
        <div className="meter-fill">
          <span className="meter-posted" style={{ width: `${geo.posted}%` }} />
          {geo.pending > 0 && <span className="meter-pending" style={{ left: `${geo.posted}%`, width: `${geo.pending}%` }} />}
        </div>
        {geo.plan !== null && <span className="meter-plan" style={{ left: `${geo.plan}%` }} title="Plan" />}
        {geo.expected > 0 && bucket.expectedByToday !== null && <span className="meter-expected" style={{ left: `${geo.expected}%` }} title={`Expected by today: ${formatWhole(bucket.expectedByToday, currency)}`} />}
      </div>
      <div className="meter-foot">
        <span>
          <span className="money">{formatMoney(bucket.posted, currency)}</span> of <span className="money">{formatWhole(bucket.planned, currency)}</span>
          {bucket.pending > 0 && (
            <span className="meter-pending-note">
              {" "}
              · <span className="money">{formatMoney(bucket.pending, currency)}</span> pending
            </span>
          )}
        </span>
        <span className="meter-remaining money">{over ? `${formatMoney(Math.max(0, -bucket.remaining), currency)} over` : `${formatMoney(Math.max(0, bucket.remaining), currency)} left`}</span>
      </div>
    </li>
  );
}
