import { Hono } from "hono";
import { z } from "zod";
import { getAccount, latestSnapshot, listAccounts, setAccountLinks, setAccountRole, type Account, type AccountRole, type Db } from "../db/index.js";
import { issueMessage, planUnavailable } from "../http/errors.js";
import type { CategorizeOutcome } from "../rules/service.js";
import type { Services } from "../services.js";

export const ACCOUNT_ROLES = ["checking", "savings", "card", "ignore"] as const satisfies readonly AccountRole[];

const PatchBody = z
  .strictObject({
    role: z.enum(ACCOUNT_ROLES).nullable().optional(),
    linkedDebtId: z.string().min(1).nullable().optional(),
    linkedGoalIds: z.array(z.string().min(1)).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "give at least one of role, linkedDebtId, linkedGoalIds" });
export type AccountPatch = z.infer<typeof PatchBody>;

/** An account as the accounts screen shows it: with its latest balance reading. */
export interface AccountView extends Account {
  balance: { amount: number; at: string } | null;
}

/** A plan debt or savings goal an account can be linked to. */
export interface PlanLink {
  id: string;
  name: string;
}

/** `GET /accounts`. `debts` and `goals` are empty while the plan does not load (`planOk: false`). */
export interface AccountsResponse {
  accounts: AccountView[];
  debts: PlanLink[];
  goals: PlanLink[];
  currency: string;
  planOk: boolean;
}

export interface AccountUpdateResponse {
  account: AccountView;
  categorized: CategorizeOutcome;
}

function view(db: Db, account: Account): AccountView {
  const latest = latestSnapshot(db, account.id);
  return { ...account, balance: latest ? { amount: latest.balance, at: latest.at } : null };
}

/**
 * `GET /accounts` lists every account with its latest balance and the plan's debts and goals.
 * `PATCH /accounts/:id` sets the role and links. A debt link belongs to a card and goal links to
 * a savings account: giving one that does not fit the resulting role is a 422, and a role change
 * clears links the new role cannot have. Every change re-runs categorization, which derives
 * card payments' debt ids from the role and link.
 */
export function accountRoutes(services: Pick<Services, "db" | "plan" | "categorizer">): Hono {
  const app = new Hono();

  app.get("/accounts", (c) => {
    const plan = services.plan.load();
    const body: AccountsResponse = {
      accounts: listAccounts(services.db).map((a) => view(services.db, a)),
      debts: plan.ok ? plan.plan.debts.map(({ id, name }) => ({ id, name })) : [],
      goals: plan.ok ? plan.plan.savingsGoals.map(({ id, name }) => ({ id, name })) : [],
      currency: plan.ok ? plan.plan.currency : "USD",
      planOk: plan.ok,
    };
    return c.json(body);
  });

  app.patch("/accounts/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "bad_request", message: "id: expected a positive integer" }, 400);
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "bad_request", message: "body is not valid JSON" }, 400);
    }
    const body = PatchBody.safeParse(raw);
    if (!body.success) return c.json({ error: "bad_request", message: issueMessage(body.error, "body") }, 400);

    const account = getAccount(services.db, id);
    if (!account) return c.json({ error: "unknown_account", message: `No account ${id}` }, 404);

    const patch = body.data;
    const role = patch.role !== undefined ? patch.role : account.role;
    const debtGiven = patch.linkedDebtId !== undefined && patch.linkedDebtId !== null;
    const goalsGiven = patch.linkedGoalIds !== undefined && patch.linkedGoalIds.length > 0;
    if (debtGiven && role !== "card") return c.json({ error: "link_role_mismatch", message: "linkedDebtId: only a card account pays down a debt" }, 422);
    if (goalsGiven && role !== "savings") return c.json({ error: "link_role_mismatch", message: "linkedGoalIds: only a savings account funds goals" }, 422);

    if (debtGiven || goalsGiven) {
      const plan = services.plan.load();
      if (!plan.ok) return planUnavailable(c, plan, "link plan debts or goals");
      if (debtGiven && !plan.plan.debts.some((d) => d.id === patch.linkedDebtId)) {
        return c.json({ error: "unknown_debt", message: `linkedDebtId: "${patch.linkedDebtId}" is not a debt in the plan` }, 422);
      }
      const goalIds = new Set(plan.plan.savingsGoals.map((g) => g.id));
      const unknownGoal = patch.linkedGoalIds?.find((g) => !goalIds.has(g));
      if (unknownGoal !== undefined) return c.json({ error: "unknown_goal", message: `linkedGoalIds: "${unknownGoal}" is not a savings goal in the plan` }, 422);
    }

    const linkedDebtId = role === "card" ? (patch.linkedDebtId !== undefined ? patch.linkedDebtId : account.linkedDebtId) : null;
    const linkedGoalIds = role === "savings" ? [...new Set(patch.linkedGoalIds ?? account.linkedGoalIds)] : [];
    services.db.transaction(() => {
      setAccountRole(services.db, id, role);
      setAccountLinks(services.db, id, { linkedDebtId, linkedGoalIds });
    })();
    const categorized = services.categorizer.run();
    const updated = getAccount(services.db, id) as Account;
    const response: AccountUpdateResponse = { account: view(services.db, updated), categorized };
    return c.json(response);
  });

  return app;
}
