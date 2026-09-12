import path from "node:path";
import { z } from "zod";
import { readJsonFile } from "../jsonFile.js";
import type { NamedCsvPreset } from "./csv.js";
import { CSV_TEMPLATES } from "./csvTemplates.js";

/**
 * `<DATA_DIR>/csv-presets.json`: the presets the import form offers. It lives in the gitignored
 * data dir because the banks someone uses are personal. Each entry starts from a template in
 * csvTemplates.ts and may override any field, so an export that differs from its template (or a
 * bank with no template, starting from `generic`) is fixed in this file rather than in the code.
 * Without the file every template is offered under its own name. Re-read on every call.
 */
export const CSV_PRESETS_FILENAME = "csv-presets.json";

/** Preset names also key accounts created from an import (`<preset>:<slug>`), so they stay simple. */
const PRESET_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;

const Columns = z.array(z.string().trim().min(1)).min(1);

const Entry = z.strictObject({
  template: z.string().refine((t) => Object.hasOwn(CSV_TEMPLATES, t), { message: `unknown template; use one of ${Object.keys(CSV_TEMPLATES).join(", ")}` }),
  label: z.string().trim().min(1).optional(),
  institution: z.string().trim().min(1).optional(),
  accountType: z.enum(["checking", "credit", "unknown"]).optional(),
  date: Columns.optional(),
  description: Columns.optional(),
  amount: z
    .discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("signed"), columns: Columns, spendingPositive: z.boolean() }),
      z.strictObject({ kind: z.literal("split"), debit: Columns, credit: Columns }),
    ])
    .optional(),
  pending: z.strictObject({ columns: Columns, value: z.string().trim().min(1) }).optional(),
});

const PresetsFile = z.strictObject({
  version: z.literal(1),
  presets: z.record(z.string(), Entry).superRefine((presets, ctx) => {
    const names = Object.keys(presets);
    if (names.length === 0) ctx.addIssue({ code: "custom", message: "list at least one preset" });
    for (const name of names) {
      if (!PRESET_NAME.test(name)) ctx.addIssue({ code: "custom", path: [name], message: `preset name "${name}": use lower-case letters, digits and dashes` });
    }
  }),
});

export interface CsvPresetsIssue {
  path: string;
  message: string;
}

export type CsvPresetsResult =
  /** `source` says whether the presets came from the file or, with no file, from every template. */
  | { ok: true; presets: NamedCsvPreset[]; source: "file" | "templates" }
  /** The file exists but is not valid JSON or does not match the schema. */
  | { ok: false; error: "csv_presets_invalid"; path: string; issues: CsvPresetsIssue[] };

export function csvPresetsPath(dataDir: string): string {
  return path.join(dataDir, CSV_PRESETS_FILENAME);
}

/** Every template as a preset of the same name, in table order. */
export function templatePresets(): NamedCsvPreset[] {
  return Object.entries(CSV_TEMPLATES).map(([name, template]) => ({ name, ...template }));
}

export function loadCsvPresets(dataDir: string): CsvPresetsResult {
  const file = csvPresetsPath(dataDir);
  const read = readJsonFile(file, PresetsFile);
  if (!read.ok) {
    if (read.error === "missing") return { ok: true, presets: templatePresets(), source: "templates" };
    return { ok: false, error: "csv_presets_invalid", path: file, issues: read.issues };
  }
  const presets = Object.entries(read.value.presets).map(([name, entry]) => resolvePreset(name, entry));
  return { ok: true, presets, source: "file" };
}

/** The entry's template with every field the entry sets replaced. */
function resolvePreset(name: string, entry: z.infer<typeof Entry>): NamedCsvPreset {
  const template = CSV_TEMPLATES[entry.template];
  if (!template) throw new Error(`csv-presets: template "${entry.template}" passed validation but does not exist`);
  const pending = entry.pending ?? template.pending;
  return {
    name,
    label: entry.label ?? template.label,
    institution: entry.institution ?? template.institution,
    accountType: entry.accountType ?? template.accountType,
    date: entry.date ?? template.date,
    description: entry.description ?? template.description,
    amount: entry.amount ?? template.amount,
    ...(pending ? { pending } : {}),
  };
}
