import path from "node:path";
import { z } from "zod";
import { firstIssue } from "./http/errors.js";
import { readJsonFile, writeJsonFileAtomic } from "./jsonFile.js";

export const SECRETS_FILENAME = "secrets.json";

/**
 * `<DATA_DIR>/secrets.json`: every credential the server holds. Gitignored with the rest of
 * data/. Never log a value from here; the SimpleFIN access URL embeds a password.
 */
const SecretsSchema = z.looseObject({
  simplefin: z.object({ accessUrl: z.url() }).optional(),
});
export type Secrets = z.infer<typeof SecretsSchema>;

export function secretsPath(dataDir: string): string {
  return path.join(dataDir, SECRETS_FILENAME);
}

/** Parsed secrets, or `{}` when the file does not exist. A corrupt file is an error, not "no secrets". */
export function readSecrets(dataDir: string): Secrets {
  const file = secretsPath(dataDir);
  const read = readJsonFile(file, SecretsSchema);
  if (read.ok) return read.value;
  switch (read.error) {
    case "missing":
      return {};
    case "invalid_json":
      throw new Error(`${file} is not valid JSON: ${read.message}`);
    case "invalid":
      throw new Error(`${file} does not match the secrets schema at ${firstIssue(read.issues)}`);
  }
}

/** Replaces the whole file atomically (temp file + rename), mode 0600, creating the data dir if needed. */
export function writeSecrets(dataDir: string, secrets: Secrets): void {
  writeJsonFileAtomic(secretsPath(dataDir), secrets, { mode: 0o600 });
}
