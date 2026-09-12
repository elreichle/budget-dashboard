import { Hono } from "hono";
import { z } from "zod";
import { issueMessage } from "../http/errors.js";
import type { SyncService } from "./service.js";

const SyncBody = z.object({ since: z.iso.date().optional() });

/** `/api/sync`: `POST /` runs a sync now, `GET /status` reports the last run. */
export function syncRoutes(sync: SyncService): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    // An empty body means "defaults"; anything else must be valid JSON matching SyncBody.
    const text = await c.req.text();
    let raw: unknown = {};
    if (text.trim()) {
      try {
        raw = JSON.parse(text);
      } catch {
        return c.json({ error: "bad_request", message: "body is not valid JSON" }, 400);
      }
    }
    const body = SyncBody.safeParse(raw);
    if (!body.success) return c.json({ error: "bad_request", message: issueMessage(body.error, "body") }, 400);

    const pending = sync.trigger(body.data.since ? { since: body.data.since } : {});
    if (!pending) return c.json({ error: "sync_in_progress", message: "A sync is already running." }, 409);
    const result = await pending;
    if (!result.failure) return c.json(result);
    // not_configured: the user has setup to do. Other connector codes: the source failed (502).
    // internal: our own code failed while applying the batch (500); the run row still records it.
    const { code, message } = result.failure;
    if (code === "not_configured") return c.json({ error: "not_configured", message, run: result.run }, 409);
    if (code === "internal") return c.json({ error: "internal", message, run: result.run }, 500);
    return c.json({ error: "sync_failed", message, run: result.run }, 502);
  });

  app.get("/status", (c) => c.json(sync.status()));

  return app;
}
