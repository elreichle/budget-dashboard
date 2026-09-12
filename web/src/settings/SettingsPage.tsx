import { useEffect } from "react";
import { getSimpleFinStatus, getSyncStatus } from "../api.js";
import { POLL_RUNNING_MS } from "../components/StatusStrip.js";
import { useAsync } from "../lib/useAsync.js";
import { CsvImportCard } from "./CsvImportCard.js";
import { SimpleFinCard } from "./SimpleFinCard.js";
import { SyncCard } from "./SyncCard.js";

/** Connect SimpleFIN, sync by hand and see how the last run went, or import a bank CSV export. */
export function SettingsPage() {
  const simplefin = useAsync(getSimpleFinStatus);
  const sync = useAsync(getSyncStatus);
  const syncData = sync.status === "ok" ? sync.data : null;
  const { reload: reloadSync } = sync;

  // A sync already running when the page opens (a scheduled one) is re-read until it finishes.
  useEffect(() => {
    if (!syncData?.running) return;
    const timer = setTimeout(reloadSync, POLL_RUNNING_MS);
    return () => clearTimeout(timer);
  }, [syncData, reloadSync]);

  return (
    <>
      <h1>Settings</h1>
      <SimpleFinCard state={simplefin} onConnected={simplefin.reload} />
      <SyncCard status={sync} configured={simplefin.status === "ok" ? simplefin.data.configured : null} onFinished={reloadSync} />
      <CsvImportCard />
    </>
  );
}
