import type { AccountPatch, AccountsResponse, AccountUpdateResponse, AccountView, PlanLink } from "../../server/accounts/routes.js";
import type { SimpleFinStatus } from "../../server/connectors/routes.js";
import type { Milestone } from "../../server/db/milestones.js";
import type { SyncRun } from "../../server/db/syncRuns.js";
import type { Transaction } from "../../server/db/transactions.js";
import type { DebtResponse } from "../../server/debt/routes.js";
import type { GoalsProgress } from "../../server/goals/progress.js";
import type { MilestonesResponse, MilestoneView } from "../../server/milestones/routes.js";
import type { Streak, Streaks } from "../../server/milestones/streaks.js";
import type { MonthSummary, Pace } from "../../server/months/summary.js";
import type { Plan, PlanIssue } from "../../server/plan/schema.js";
import type { AccountRef, ReviewItem, TransactionsResponse } from "../../server/rules/routes.js";
import type { Rule } from "../../server/rules/schema.js";
import type { CategorizeOutcome } from "../../server/rules/service.js";
import type { ImportResult } from "../../server/sync/import.js";
import type { SyncResult } from "../../server/sync/run.js";

/**
 * The dashboard's only way to talk to the server. Response shapes are the server's own types
 * (type-only imports, erased at build time) so the two sides cannot drift apart silently.
 * Every non-2xx answer becomes an `ApiError` carrying the server's `error` code.
 */

export type { AccountPatch, AccountRef, AccountsResponse, AccountUpdateResponse, AccountView, CategorizeOutcome, DebtResponse, GoalsProgress, ImportResult, MilestonesResponse, MilestoneView, MonthSummary, Pace, Plan, PlanIssue, PlanLink, ReviewItem, Rule, SimpleFinStatus, Streak, Streaks, SyncResult, SyncRun, Transaction, TransactionsResponse };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** The server's `error` code (`plan_missing`, `not_configured`, …) or `http_error` when the body had none. */
    readonly code: string,
    message: string,
    readonly body: unknown = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type PlanState =
  | { ok: true; plan: Plan }
  | { ok: false; error: "plan_missing"; path: string; hint: string }
  | { ok: false; error: "plan_invalid"; path: string; issues: PlanIssue[] };

export interface SyncStatus {
  running: boolean;
  last: SyncRun | null;
}

export interface MonthList {
  months: string[];
  /** `YYYY-MM` of the server's today. */
  current: string;
}

export interface ReviewResponse {
  transactions: ReviewItem[];
  buckets: string[];
}

export interface TransactionFilter {
  month?: string | undefined;
  accountId?: number | undefined;
}

export interface FileBucketBody {
  bucket: string;
  saveRule?: boolean;
  match?: string;
}

/** What `POST /api/transactions/:id/bucket` answers: the filed row, the rule saved (if any), and the re-run's outcome. */
export interface FileBucketResponse {
  transaction: Transaction;
  rule: Rule | null;
  categorized: CategorizeOutcome;
}

/** One entry of `GET /api/import/csv/presets`. */
export interface CsvPresetOption {
  name: string;
  label: string;
  institution: string;
}

/** The CSV upload form: a file, its bank preset, and an existing account or a name for a new one. */
export interface CsvImportForm {
  file: File;
  preset: string;
  target: { accountId: number } | { accountName: string };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  // Only JSON bodies are strings here; a FormData body sets its own multipart boundary.
  if (typeof init.body === "string") headers["content-type"] = "application/json";
  const res = await fetch(path, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const err = typeof body === "object" && body !== null ? (body as { error?: unknown; message?: unknown }) : {};
    const code = typeof err.error === "string" ? err.error : "http_error";
    const message = typeof err.message === "string" ? err.message : `${res.status} ${res.statusText}`.trim();
    throw new ApiError(res.status, code, message, body);
  }
  return body as T;
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const patch = <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) });

/** The plan, or why it does not load: missing (first run) or invalid (edit needed). */
export async function getPlan(): Promise<PlanState> {
  try {
    return { ok: true, plan: await get<Plan>("/api/plan") };
  } catch (err) {
    if (err instanceof ApiError && (err.code === "plan_missing" || err.code === "plan_invalid")) {
      return { ok: false, ...(err.body as Omit<PlanState & { ok: false }, "ok">) } as PlanState;
    }
    throw err;
  }
}

export const getSyncStatus = () => get<SyncStatus>("/api/sync/status");
export const triggerSync = (since?: string) => post<SyncResult>("/api/sync", since ? { since } : undefined);
export const listMonths = () => get<MonthList>("/api/months");
export const getMonth = (month: string) => get<MonthSummary>(`/api/months/${month}`);
export const getDebt = () => get<DebtResponse>("/api/debt");
export const getGoals = () => get<GoalsProgress>("/api/goals");
export const getMilestones = () => get<MilestonesResponse>("/api/milestones");
/** The route takes no body but insists on JSON, so a cross-site form cannot dismiss; hence the empty object. */
export const dismissMilestone = (id: number) => post<{ milestone: Milestone }>(`/api/milestones/${id}/dismiss`, {});
export const getStreaks = () => get<Streaks>("/api/streaks");
export const getReview = () => get<ReviewResponse>("/api/review");
export const fileTransaction = (id: number, body: FileBucketBody) => post<FileBucketResponse>(`/api/transactions/${id}/bucket`, body);
export function listTransactions(filter: TransactionFilter = {}): Promise<TransactionsResponse> {
  const params = new URLSearchParams();
  if (filter.month) params.set("month", filter.month);
  if (filter.accountId !== undefined) params.set("accountId", String(filter.accountId));
  const query = params.toString();
  return get<TransactionsResponse>(`/api/transactions${query ? `?${query}` : ""}`);
}
export const getAccounts = () => get<AccountsResponse>("/api/accounts");
export const updateAccount = (id: number, body: AccountPatch) => patch<AccountUpdateResponse>(`/api/accounts/${id}`, body);
export const getSimpleFinStatus = () => get<SimpleFinStatus>("/api/connectors/simplefin");
/** Sends the setup token once; the answer carries only whether SimpleFIN is now configured. */
export const claimSimpleFin = (token: string) => post<SimpleFinStatus>("/api/connectors/simplefin/claim", { token });
export const listCsvPresets = () => get<CsvPresetOption[]>("/api/import/csv/presets");
export function importCsv(form: CsvImportForm): Promise<ImportResult> {
  const data = new FormData();
  data.set("file", form.file);
  data.set("preset", form.preset);
  if ("accountId" in form.target) data.set("accountId", String(form.target.accountId));
  else data.set("accountName", form.target.accountName);
  return request<ImportResult>("/api/import/csv", { method: "POST", body: data });
}
