import fs from "node:fs";
import path from "node:path";
import type { ZodType } from "zod";
import { issueList, type Issue } from "./http/errors.js";

export type JsonFileResult<T> =
  | { ok: true; value: T }
  /** No file at the path. */
  | { ok: false; error: "missing" }
  /** Not JSON. `message` is the parser's; `issues` holds it as one root issue, `Invalid JSON: <message>`. */
  | { ok: false; error: "invalid_json"; message: string; issues: Issue[] }
  /** JSON that the schema rejects. */
  | { ok: false; error: "invalid"; issues: Issue[] };

/** Reads `file` and validates it with `schema`. Filesystem errors other than a missing file (EACCES, EISDIR) propagate. */
export function readJsonFile<T>(file: string, schema: ZodType<T>): JsonFileResult<T> {
  const raw = readTextFile(file);
  return raw === undefined ? { ok: false, error: "missing" } : parseJsonText(raw, schema);
}

/** File text, or undefined when there is no such file. Other errors propagate. */
export function readTextFile(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (err) {
    if (typeof err === "object" && err !== null && (err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

/** `readJsonFile` for text the caller already read (to cache on it, say). */
export function parseJsonText<T>(raw: string, schema: ZodType<T>): Exclude<JsonFileResult<T>, { error: "missing" }> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: "invalid_json", message, issues: [{ path: "", message: `Invalid JSON: ${message}` }] };
  }
  const parsed = schema.safeParse(json);
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, error: "invalid", issues: issueList(parsed.error) };
}

/**
 * Replaces `file` with `value` as indented JSON, creating its directory if needed. Written to a
 * sibling temp file and renamed, so a crash mid-write cannot leave a truncated file behind. With
 * `mode`, the file ends up with exactly that mode, even if it already existed with another.
 */
export function writeJsonFileAtomic(file: string, value: unknown, options: { mode?: number } = {}): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", options.mode === undefined ? {} : { mode: options.mode });
    if (options.mode !== undefined) fs.chmodSync(tmp, options.mode); // writeFileSync's mode is masked by umask and ignored for existing files
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}
