/** A bar filling toward a finish line. `percent` is 0–100; name it with `labelledBy` or `label`. */
export function ProgressBar({ percent, valueText, labelledBy, label, done = false }: { percent: number; valueText: string; labelledBy?: string; label?: string; done?: boolean }) {
  const value = Math.min(100, Math.max(0, percent));
  return (
    <div
      className={done ? "progress-track done" : "progress-track"}
      role="progressbar"
      aria-labelledby={labelledBy}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      aria-valuetext={valueText}
    >
      <span className="progress-fill" style={{ width: `${value}%` }} />
    </div>
  );
}
