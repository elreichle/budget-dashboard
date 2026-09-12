import type { Config } from "./config.js";
import { loadCsvPresets, type CsvPresetsResult } from "./connectors/csvPresets.js";
import { claimSetupToken, createSimpleFinConnector } from "./connectors/simplefin.js";
import type { Connector } from "./connectors/types.js";
import { dbPath, openDatabase, type Db } from "./db/index.js";
import { createMilestoneDetector, type MilestoneDetector } from "./milestones/service.js";
import { createPlanLoader, type PlanLoader } from "./plan/load.js";
import { createCategorizer, type Categorizer } from "./rules/service.js";
import { createSyncService, type SyncService } from "./sync/service.js";

/** Long-lived process state the routes share. Built once in index.ts; tests inject fakes. */
export interface Services {
  db: Db;
  connector: Connector;
  sync: SyncService;
  /** The plan file, re-read when it changes. */
  plan: PlanLoader;
  /** Runs rule categorization; sync and import call it after every batch. */
  categorizer: Categorizer;
  /** Detects and records milestones; sync and import run it after every committed batch. */
  milestones: MilestoneDetector;
  /** The CSV presets `<DATA_DIR>/csv-presets.json` allows, re-read on every call. */
  csvPresets: () => CsvPresetsResult;
  /** Clock every writer stamps rows with, ISO timestamps. Injected by tests. */
  now: () => string;
  /** Exchanges a SimpleFIN setup token for access and stores it in secrets.json. */
  claimSimpleFin: (token: string) => Promise<void>;
}

export interface ServiceOverrides {
  db?: Db;
  connector?: Connector;
  /** Clock for sync runs, ISO timestamps. */
  now?: () => string;
  /** fetch for the SimpleFIN connector and token claim; tests inject a fake so nothing hits the network. */
  fetch?: typeof fetch;
}

export function createServices(config: Config, overrides: ServiceOverrides = {}): Services {
  const db = overrides.db ?? openDatabase(dbPath(config.dataDir));
  const simplefin = { dataDir: config.dataDir, ...(overrides.fetch ? { fetch: overrides.fetch } : {}) };
  const connector = overrides.connector ?? createSimpleFinConnector(simplefin);
  const now = overrides.now ?? (() => new Date().toISOString());
  const plan = createPlanLoader(config.dataDir);
  const categorizer = createCategorizer(db, plan, config.dataDir, now);
  const milestones = createMilestoneDetector(db, plan, now);
  const sync = createSyncService(db, connector, { now, categorizer, milestones });
  const csvPresets = () => loadCsvPresets(config.dataDir);
  const claimSimpleFin = (token: string) => claimSetupToken(token, simplefin);
  return { db, connector, sync, plan, categorizer, milestones, csvPresets, now, claimSimpleFin };
}
