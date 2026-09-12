import { Hono } from "hono";
import { localDate, localMonth } from "../clock.js";
import { listAccounts, listTransactionMonths, listTransactions } from "../db/index.js";
import { planUnavailable } from "../http/errors.js";
import type { Services } from "../services.js";
import { isMonth } from "./month.js";
import { summarizeMonth } from "./summary.js";

/**
 * `GET /months` lists every `YYYY-MM` with a transaction, newest first, plus the current month.
 * `GET /months/:month` is the month summary (see `summarizeMonth`); "today" is the server clock's
 * calendar day in the machine's zone (`TZ`), so a past month is fully elapsed and a future one has not started.
 */
export function monthRoutes(services: Pick<Services, "db" | "now" | "plan">): Hono {
  const app = new Hono();

  app.get("/months", (c) => c.json({ months: listTransactionMonths(services.db), current: localMonth(services.now()) }));

  app.get("/months/:month", (c) => {
    const month = c.req.param("month");
    if (!isMonth(month)) return c.json({ error: "bad_request", message: "month: expected a calendar month YYYY-MM" }, 400);
    const plan = services.plan.load();
    if (!plan.ok) return planUnavailable(c, plan, "summarize a month");
    const summary = summarizeMonth({
      plan: plan.plan,
      transactions: listTransactions(services.db, { month }),
      accounts: listAccounts(services.db),
      month,
      today: localDate(services.now()),
    });
    return c.json(summary);
  });

  return app;
}
