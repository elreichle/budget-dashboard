import { Hono } from "hono";
import { z } from "zod";
import { getTransaction, listAccounts, listNeedingReview, listTransactions, setTransactionBucket, type Db, type Transaction } from "../db/index.js";
import { MonthSchema } from "../months/month.js";
import { issueMessage, planUnavailable } from "../http/errors.js";
import type { PlanLoader } from "../plan/load.js";
import type { Services } from "../services.js";
import { RulesFileError } from "./load.js";
import { isKnownBucket, knownBucketIds, RESERVED_BUCKET_IDS } from "./schema.js";

const BucketBody = z.object({
  bucket: z.string().min(1),
  saveRule: z.boolean().optional().default(false),
  /** Substring the saved rule matches on; defaults to the transaction's description, trimmed. */
  match: z.string().trim().min(1).optional(),
});

const TransactionsQuery = z.object({
  month: MonthSchema.optional(),
  accountId: z.coerce.number().int().positive().optional(),
});

/** The account a listed transaction came from. */
export interface AccountRef {
  id: number;
  name: string;
  institution: string;
}

/** A transaction as the review inbox and the transactions list show it: with the account it came from. */
export interface ReviewItem extends Transaction {
  account: AccountRef;
}

/** `GET /transactions`: the filtered rows, every account (whatever the filter) and the ids a filing may use. */
export interface TransactionsResponse {
  transactions: ReviewItem[];
  accounts: AccountRef[];
  buckets: string[];
}

function accountRefs(db: Db): AccountRef[] {
  return listAccounts(db).map((a) => ({ id: a.id, name: a.name, institution: a.institution }));
}

function withAccounts(transactions: Transaction[], accounts: AccountRef[]): ReviewItem[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  return transactions.map((t) => ({ ...t, account: byId.get(t.accountId) ?? { id: t.accountId, name: "?", institution: "?" } }));
}

/** Plan buckets and reserved ids; reserved only while the plan does not load. */
function bucketIds(plan: PlanLoader): string[] {
  const result = plan.load();
  return result.ok ? [...knownBucketIds(result.plan)] : [...RESERVED_BUCKET_IDS];
}

/**
 * `GET /review` lists every transaction (posted and pending, any month) that needs review, newest
 * first (see `needsReview`: a bucket the plan no longer has counts only while the plan loads),
 * plus `buckets`: every id a filing may use (plan buckets and reserved ids; reserved only
 * while the plan does not load). `GET /transactions?month=YYYY-MM&accountId=N` lists all of
 * them, filed or not, with the same `buckets` and every account for the filter.
 * `POST /transactions/:id/bucket` files one by hand; with
 * `saveRule` it also appends a rule and re-runs categorization so the rule reaches the rest
 * of the inbox at once.
 */
export function reviewRoutes(services: Pick<Services, "db" | "now" | "plan" | "categorizer">): Hono {
  const app = new Hono();

  app.get("/review", (c) => {
    const plan = services.plan.load();
    const planBucketIds = plan.ok ? new Set(plan.plan.buckets.map((b) => b.id)) : null;
    const transactions = withAccounts(listNeedingReview(services.db, planBucketIds), accountRefs(services.db));
    return c.json({ transactions, buckets: bucketIds(services.plan) });
  });

  app.get("/transactions", (c) => {
    const query = TransactionsQuery.safeParse(c.req.query());
    if (!query.success) return c.json({ error: "bad_request", message: issueMessage(query.error, "query") }, 400);
    const { month, accountId } = query.data;
    const filter = { ...(month === undefined ? {} : { month }), ...(accountId === undefined ? {} : { accountId }) };
    const accounts = accountRefs(services.db);
    const body: TransactionsResponse = { transactions: withAccounts(listTransactions(services.db, filter), accounts), accounts, buckets: bucketIds(services.plan) };
    return c.json(body);
  });

  app.post("/transactions/:id/bucket", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "bad_request", message: "id: expected a positive integer" }, 400);
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "bad_request", message: "body is not valid JSON" }, 400);
    }
    const body = BucketBody.safeParse(raw);
    if (!body.success) return c.json({ error: "bad_request", message: issueMessage(body.error, "body") }, 400);

    const plan = services.plan.load();
    if (!plan.ok) return planUnavailable(c, plan, "file transactions");
    const { bucket, saveRule, match } = body.data;
    if (!isKnownBucket(bucket, plan.plan)) return c.json({ error: "unknown_bucket", message: `bucket: "${bucket}" is not a plan bucket or a reserved id` }, 422);

    const transaction = getTransaction(services.db, id);
    if (!transaction) return c.json({ error: "unknown_transaction", message: `No transaction ${id}` }, 404);

    // The rule is written before the row is touched, so a refused save leaves the inbox as it was.
    let rule = null;
    if (saveRule) {
      const pattern = match ?? transaction.description.trim();
      if (!pattern) return c.json({ error: "bad_request", message: "match: the description is blank, give a match to save a rule" }, 400);
      rule = { match: pattern, bucket };
      try {
        services.categorizer.appendRule(rule);
      } catch (err) {
        if (err instanceof RulesFileError) return c.json({ error: "rules_invalid", message: err.message, path: err.path, issues: err.issues }, 409);
        throw err;
      }
    }
    setTransactionBucket(services.db, id, { bucketId: bucket, source: "manual" }, services.now());
    // Also derives the debt link for the row just filed, and applies a saved rule to the rest of the inbox.
    const categorized = services.categorizer.run();
    return c.json({ transaction: getTransaction(services.db, id), rule, categorized });
  });

  return app;
}
