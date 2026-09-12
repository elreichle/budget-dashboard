import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { issueMessage } from "../http/errors.js";
import type { Services } from "../services.js";
import { hasAccountSlug, importCsv, UnknownAccountError } from "./import.js";

/** Uploads above this are refused up front (Content-Length, then the stream); a year of card activity is well under 1 MB. */
export const CSV_MAX_BYTES = 8 * 1024 * 1024;

/** A form with both an account picker and a name box submits the unused one blank: blank means absent. */
const blankAsAbsent = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const Form = z
  .object({
    preset: z.string().trim().min(1),
    accountId: z.preprocess(blankAsAbsent, z.coerce.number().int().positive().optional()),
    accountName: z.preprocess(blankAsAbsent, z.string().trim().min(1).max(80).refine(hasAccountSlug, { message: "needs at least one letter or digit" }).optional()),
  })
  .refine((f) => (f.accountId === undefined) !== (f.accountName === undefined), { message: "give exactly one of accountId or accountName" });

/**
 * `/api/import`: `GET /csv/presets` lists the presets `<DATA_DIR>/csv-presets.json` allows (every
 * template without the file) for the upload form; `POST /csv` (multipart: `file`, `preset`, and
 * `accountId` or `accountName`) imports a bank export with one of them. An invalid presets file is
 * a 422 on both.
 */
export function importRoutes(services: Pick<Services, "db" | "now" | "categorizer" | "milestones" | "csvPresets">): Hono {
  const app = new Hono();

  app.get("/csv/presets", (c) => {
    const presets = services.csvPresets();
    if (!presets.ok) return c.json({ error: presets.error, path: presets.path, issues: presets.issues }, 422);
    return c.json(presets.presets.map(({ name, label, institution }) => ({ name, label, institution })));
  });

  const tooLarge = bodyLimit({ maxSize: CSV_MAX_BYTES, onError: (c) => c.json({ error: "file_too_large", message: `upload: larger than ${CSV_MAX_BYTES} bytes` }, 413) });

  app.post("/csv", tooLarge, async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.parseBody();
    } catch {
      return c.json({ error: "bad_request", message: "expected a multipart form" }, 400);
    }
    const { file, ...fields } = body;
    if (!(file instanceof File)) return c.json({ error: "bad_request", message: "file: expected an uploaded file" }, 400);
    const form = Form.safeParse(fields);
    if (!form.success) return c.json({ error: "bad_request", message: issueMessage(form.error, "form") }, 400);
    const { preset: presetName, accountId, accountName } = form.data;
    const presets = services.csvPresets();
    if (!presets.ok) return c.json({ error: presets.error, path: presets.path, issues: presets.issues }, 422);
    const preset = presets.presets.find((p) => p.name === presetName);
    if (!preset) return c.json({ error: "bad_request", message: `preset: no preset named "${presetName}"` }, 400);
    const target = accountId !== undefined ? { accountId } : { accountName: accountName as string };

    let result;
    try {
      result = importCsv(services.db, { text: await file.text(), preset, target }, services.now, services.categorizer);
    } catch (err) {
      if (err instanceof UnknownAccountError) return c.json({ error: "unknown_account", message: err.message }, 404);
      throw err;
    }
    if (!result.failure) {
      // After the rows are committed, like a sync: they may close a month under plan.
      result.warnings.push(...services.milestones.run().warnings);
      return c.json(result);
    }
    const { code, message } = result.failure;
    if (code === "bad_file") return c.json({ error: "bad_file", message, run: result.run }, 422);
    return c.json({ error: "internal", message, run: result.run }, 500);
  });

  return app;
}
