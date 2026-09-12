import { Hono } from "hono";
import { z } from "zod";
import { issueMessage } from "../http/errors.js";
import type { Services } from "../services.js";
import { ConnectorError } from "./types.js";

const ClaimBody = z.object({ token: z.string().trim().min(1, "paste a setup token") });

export interface SimpleFinStatus {
  configured: boolean;
}

/**
 * `/api/connectors`: `GET /simplefin` says whether SimpleFIN holds credentials;
 * `POST /simplefin/claim` (`{ token }`) exchanges a setup token for access. Neither the token
 * nor the access URL is ever part of a response.
 */
export function connectorRoutes(services: Pick<Services, "sync" | "claimSimpleFin">): Hono {
  const app = new Hono();

  app.get("/simplefin", (c) => c.json({ configured: services.sync.configured() } satisfies SimpleFinStatus));

  app.post("/simplefin/claim", async (c) => {
    // A cross-site page can POST text/plain (or untyped) bodies without a preflight, and c.req.json()
    // parses them anyway. Requiring JSON forces the preflight, which this server never grants.
    if (!/^application\/json\b/i.test(c.req.header("content-type") ?? "")) {
      return c.json({ error: "unsupported_media_type", message: "send the token as application/json" }, 415);
    }
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "bad_request", message: "body is not valid JSON" }, 400);
    }
    const body = ClaimBody.safeParse(raw);
    if (!body.success) return c.json({ error: "bad_request", message: issueMessage(body.error, "token") }, 400);

    try {
      await services.claimSimpleFin(body.data.token);
    } catch (err) {
      if (!(err instanceof ConnectorError)) throw err;
      // bad_setup_token: not a token at all. claim_failed: SimpleFIN refused it (spent or expired).
      if (err.code === "bad_setup_token") return c.json({ error: err.code, message: err.message }, 400);
      if (err.code === "claim_failed") return c.json({ error: err.code, message: err.message }, 422);
      if (err.code === "secrets_unreadable") return c.json({ error: err.code, message: err.message }, 500);
      return c.json({ error: "claim_error", message: err.message }, 502);
    }
    return c.json({ configured: services.sync.configured() } satisfies SimpleFinStatus);
  });

  return app;
}
