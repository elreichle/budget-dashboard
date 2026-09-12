import type { ImportResult, SyncResult } from "../api.js";

export const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

export function syncSummary(result: SyncResult): string {
  return `Synced: ${count(result.inserted, "new transaction")}, ${result.updated} updated, ${count(result.snapshots, "balance reading")}.`;
}

export function importSummary(result: ImportResult): string {
  const parts = [count(result.inserted, "new transaction"), `${result.updated} updated`];
  if (result.skipped > 0) parts.push(`${result.skipped} skipped`);
  if (result.skippedOverlap > 0) parts.push(`${count(result.skippedOverlap, "row")} already covered by SimpleFIN`);
  if (result.pendingIgnored > 0) parts.push(`${count(result.pendingIgnored, "pending row")} left out until posted`);
  return `Imported into ${result.account?.name ?? "the account"}: ${parts.join(", ")}.`;
}

/** Source warnings plus categorization's, which say why rules did not run. */
export function resultWarnings(result: Pick<SyncResult, "warnings" | "categorized">): string[] {
  return [...result.warnings, ...(result.categorized?.warnings ?? [])];
}
