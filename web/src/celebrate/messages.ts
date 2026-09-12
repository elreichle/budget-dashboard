import type { MilestoneView } from "../api.js";
import { formatMonth } from "../lib/time.js";

/** One line naming what was reached, for the toast and the Wins panel. */
export function milestoneMessage({ kind, subject, month }: Pick<MilestoneView, "kind" | "subject" | "month">): string {
  const when = month === null ? "" : formatMonth(month);
  switch (kind) {
    case "debt-paid":
      return `${subject.name} is paid off!`;
    case "debt-halfway":
      return `${subject.name} is halfway paid off`;
    case "month-under-plan":
      return `${subject.name} finished ${when} under plan`;
    case "buffer-target-met":
      return `${subject.name} reached its target`;
    case "savings-month-met":
      return `${subject.name} got its full savings for ${when}`;
  }
}
