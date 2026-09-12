#!/usr/bin/env node
// PII guard: fails when personal data or secrets are tracked or staged in this repo.
//
// Dependency-free so the pre-commit hook stays fast. Scans the content of every git-tracked
// file (working tree) plus the index copy of every file whose index differs from the tree, or
// only the index with `--staged`. Also rejects any tracked/staged path that .gitignore says
// should never be committed (data/ other than .gitkeep and *.example.json, .env, *.db, *.csv…)
// even when it was force-added. Also fails when the email git will record as author or
// committer is not a GitHub noreply address or a placeholder: commit metadata is published with
// every push and cannot be fixed without rewriting history.
//
// Optional denylist: data/pii-denylist.txt (gitignored, shared by all worktrees of the clone),
// one term per line, case-insensitive, `#` comments allowed. Put real names, merchants,
// institutions and street names there. Every run reports how many terms loaded.
//
// `--history [rev…]` scans what a push publishes instead: every file version reachable from the
// revs (default: every ref), every path those commits touched, every commit message, and every
// author and committer email. A file deleted later or a personal email on an old commit is still
// published; the pre-push hook runs it on the commits being pushed.
//
// Exit codes: 0 clean, 1 findings, 2 could not run (not a git repo, git missing).

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

const SELF = "scripts/pii-guard.mjs";
const DENYLIST_FILE = "data/pii-denylist.txt";

/** Paths under data/ that may be tracked. Everything else in data/ is personal. */
export const ALLOWED_DATA_PATH = /^data\/(?:\.gitkeep|[^/]+\.example\.json)$/;
const ENV_FILE = /^(?:.*\/)?\.env(?:\..*)?$/;
const ENV_EXAMPLE = /^(?:.*\/)?\.env\.example$/;

/** Domains and local-parts that are documentation placeholders, never a person. */
const PLACEHOLDER_EMAIL_DOMAIN = /(?:^|\.)example\.(?:com|org|net)$|\.(?:test|example|invalid|localhost)$|^localhost$/i;
const PLACEHOLDER_EMAIL_LOCAL = /^(?:git|noreply|no-reply)$/i;
/** GitHub's address that stands in for a real one: `<id>+<login>@users.noreply.github.com`. */
const GITHUB_NOREPLY_DOMAIN = /^users\.noreply\.github\.com$/i;

/** Home directory names that stand for nobody in particular: container users and doc placeholders. */
const PLACEHOLDER_HOME_USER = /^(?:user|username|you|me|name|node|runner|app|dev|example|someone|ubuntu|root|pi)$/i;

/** Lines that legitimately carry long digit-ish runs: lockfile integrity hashes. */
const LOCKFILE_HASH_LINE = /"integrity":\s*"sha\d+-/;

const RULES = [
  {
    id: "card-fragment",
    // "...1234", "…1234", "xxxx1234", "****1234": the last-4 of a card or account.
    re: /(?:\.{3}|…|[xX*]{4,})\d{4}\b/g,
  },
  {
    id: "digit-run",
    // 12+ consecutive digits not part of a decimal fraction: account, card or routing-ish.
    re: /(?<![\d.])\d{12,}(?!\d)/g,
  },
  {
    id: "grouped-card",
    // 4-4-4-4 groups separated by spaces or dashes; a run starting with a year is a year list.
    re: /\b\d{4}(?:[ -]\d{4}){3}\b/g,
    ignore: (m) => /^(?:19|20)\d{2}\b/.test(m),
  },
  {
    id: "email",
    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
    ignore: (m) => isPublicEmail(m),
  },
  {
    id: "url-with-credentials",
    // https://user:secret@host/... — the shape of a SimpleFIN access URL.
    re: /https?:\/\/[^\s/:@"'<>]+:[^\s/@"'<>]+@[^\s"'<>]+/gi,
  },
  {
    id: "simplefin-claim-url",
    re: /simplefin\.org\/simplefin\/claim\/[A-Za-z0-9_-]+/gi,
  },
  {
    id: "simplefin-setup-token",
    // A setup token is the base64 of a claim URL, so it always starts with base64("https://").
    re: /\baHR0cHM6Ly[A-Za-z0-9+/=]{16,}/g,
  },
  {
    id: "bearer-token",
    re: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g,
  },
  {
    id: "home-path",
    // An absolute home directory carries the machine's user name: /home/kim, /Users/kim, C:\Users\kim.
    re: /(?:(?<![\w.~-])\/(?:home|Users)\/|\b[A-Za-z]:\\{1,2}Users\\{1,2})[A-Za-z0-9._-]+/g,
    ignore: (m) => PLACEHOLDER_HOME_USER.test(m.split(/[\\/]+/).pop()),
  },
];

/** Addresses fine to publish: documentation placeholders, no-reply local parts and GitHub noreply addresses. */
export function isPublicEmail(address) {
  const at = address.lastIndexOf("@");
  if (at === -1) return false;
  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  return PLACEHOLDER_EMAIL_DOMAIN.test(domain) || GITHUB_NOREPLY_DOMAIN.test(domain) || PLACEHOLDER_EMAIL_LOCAL.test(local);
}

/** Mask a hit so the report never echoes the secret in full. */
export function mask(s) {
  if (s.length <= 4) return "*".repeat(s.length);
  return s.slice(0, 2) + "*".repeat(Math.min(s.length - 2, 12));
}

/** Path-level rule independent of .gitignore: returns a finding or null. */
export function checkPath(file) {
  if (file.startsWith("data/") && !ALLOWED_DATA_PATH.test(file)) {
    return { file, line: 0, rule: "data-path", match: "only data/.gitkeep and data/*.example.json may be tracked" };
  }
  if (ENV_FILE.test(file) && !ENV_EXAMPLE.test(file)) {
    return { file, line: 0, rule: "env-file", match: "only .env.example may be tracked" };
  }
  return null;
}

/** Read the optional denylist: one term per line, `#` comments, blanks ignored. */
export function loadDenylist(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

/** Decode a buffer as text, honouring UTF-16 BOMs; returns null for binary content. */
export function decodeText(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return buf.subarray(2).swap16().toString("utf16le");
  }
  if (buf.subarray(0, 8000).includes(0)) return null;
  return buf.toString("utf8");
}

/** Content-level rules over one text. `denylist` terms match case-insensitively as substrings. */
export function scanText(text, { file = "<text>", denylist = [] } = {}) {
  const findings = [];
  const terms = denylist.map((t) => t.toLowerCase());
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    if (LOCKFILE_HASH_LINE.test(line)) continue;
    for (const rule of RULES) {
      for (const m of line.matchAll(rule.re)) {
        if (rule.ignore?.(m[0])) continue;
        findings.push({ file, line: lineNo, rule: rule.id, match: mask(m[0]) });
      }
    }
    if (terms.length) {
      const lower = line.toLowerCase();
      for (let t = 0; t < terms.length; t++) {
        if (lower.includes(terms[t])) {
          findings.push({ file, line: lineNo, rule: "denylist", match: mask(denylist[t]) });
        }
      }
    }
  }
  return findings;
}

function git(args, cwd, input) {
  return execFileSync("git", args, {
    cwd,
    input,
    maxBuffer: 256 * 1024 * 1024,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
}

const zList = (buf) => buf.toString("utf8").split("\0").filter(Boolean);
const REGULAR_FILE_MODE = /^100/; // 100644 / 100755; skips symlinks (120000) and gitlinks (160000)

/** Tracked regular files from the index: `git ls-files -s -z` → "<mode> <sha> <stage>\t<path>". */
function trackedRegularFiles(root) {
  return zList(git(["ls-files", "-s", "-z"], root))
    .map((entry) => {
      const [meta, file] = entry.split("\t");
      return REGULAR_FILE_MODE.test(meta) ? file : null;
    })
    .filter(Boolean);
}

/** Staged regular files: `git diff --cached --raw -z` → ":<src> <dst> <sha> <sha> <status>\0<path>[\0<newpath>]". */
function stagedRegularFiles(root) {
  const parts = zList(git(["diff", "--cached", "--raw", "-z", "--diff-filter=ACMR"], root));
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const [, dstMode, , , status] = parts[i].split(" ");
    const isRename = status?.startsWith("R") || status?.startsWith("C");
    const file = isRename ? parts[i + 2] : parts[i + 1];
    i += isRename ? 2 : 1;
    if (REGULAR_FILE_MODE.test(dstMode)) files.push(file);
  }
  return files;
}

/** Paths .gitignore says must never be committed, even if force-added. */
function ignoredPaths(root, files) {
  if (files.length === 0) return [];
  const res = spawnSync("git", ["check-ignore", "--no-index", "-z", "--stdin"], {
    cwd: root,
    input: files.join("\0") + "\0",
    maxBuffer: 64 * 1024 * 1024,
  });
  // Exit 1 means "nothing ignored"; anything above is a real error.
  if (res.status !== 0 && res.status !== 1) throw new Error(`git check-ignore failed: ${res.stderr}`);
  return zList(res.stdout);
}

/** Read objects in one `git cat-file --batch` round trip. Returns Map<spec, Buffer>, skipping missing ones. */
function catBlobs(root, specs) {
  const out = new Map();
  if (specs.length === 0) return out;
  const buf = git(["cat-file", "--batch"], root, specs.map((s) => `${s}\n`).join(""));
  let pos = 0;
  for (const spec of specs) {
    const nl = buf.indexOf(0x0a, pos);
    const header = buf.subarray(pos, nl).toString("utf8");
    pos = nl + 1;
    if (header.endsWith(" missing")) continue;
    const size = Number(header.split(" ").at(-1));
    out.set(spec, buf.subarray(pos, pos + size));
    pos += size + 1; // trailing newline after each blob
  }
  return out;
}

/** Index copies of `files`. Returns Map<path, Buffer>. */
function indexBlobs(root, files) {
  const out = new Map();
  for (const [spec, buf] of catBlobs(root, files.map((f) => `:${f}`))) out.set(spec.slice(1), buf);
  return out;
}

/** The denylist lives beside the main worktree's .git so every linked worktree shares it. */
function denylistPath(root) {
  const common = git(["rev-parse", "--path-format=absolute", "--git-common-dir"], root).toString("utf8").trim();
  return path.join(path.dirname(common), DENYLIST_FILE);
}

/** Path rules and .gitignore for a list of paths: personal files that must never be committed. */
function pathFindings(root, files) {
  const findings = files.map((file) => checkPath(file)).filter(Boolean);
  for (const file of ignoredPaths(root, files)) {
    findings.push({ file, line: 0, rule: "gitignored-path", match: "matches .gitignore; must not be committed" });
  }
  return findings;
}

/**
 * Scan the repository at `cwd`. Default: tracked files (working tree) plus index copies that
 * differ from the tree. `staged: true`: only the index copies of staged files (pre-commit).
 */
export function scanRepo({ cwd = process.cwd(), staged = false } = {}) {
  const root = git(["rev-parse", "--show-toplevel"], cwd).toString("utf8").trim();
  const denylist = loadDenylist(denylistPath(root));
  const stagedFiles = stagedRegularFiles(root);
  const trackedFiles = staged ? [] : trackedRegularFiles(root);
  const indexFiles = staged ? stagedFiles : zList(git(["diff", "--name-only", "-z"], root));

  const findings = [];
  const scanBuffer = (file, buf) => {
    if (file === SELF) return;
    const text = decodeText(buf);
    if (text !== null) findings.push(...scanText(text, { file, denylist }));
  };

  findings.push(...pathFindings(root, [...new Set([...trackedFiles, ...stagedFiles])]));
  for (const file of trackedFiles) {
    const abs = path.join(root, file);
    let stat;
    try {
      stat = lstatSync(abs);
    } catch {
      continue; // deleted in the working tree
    }
    if (stat.isFile()) scanBuffer(file, readFileSync(abs));
  }
  for (const [file, buf] of indexBlobs(root, indexFiles)) scanBuffer(file, buf);
  findings.push(...identityFindings(root));
  return { findings, denylistTerms: denylist.length };
}

/**
 * Scan what a push publishes: every blob reachable from `revs` (default every ref; reported under
 * the first path it was committed as), every path those commits touched, every commit message, and
 * every author and committer email. Public addresses in a message, such as a noreply co-author trailer, are blanked
 * before the denylist runs so their domain is not a hit.
 */
export function scanHistory({ cwd = process.cwd(), revs = ["--all"] } = {}) {
  const root = git(["rev-parse", "--show-toplevel"], cwd).toString("utf8").trim();
  const denylist = loadDenylist(denylistPath(root));
  const findings = [];

  // `rev-list --objects` prints "<sha> <path>" for trees and blobs, at the first path each was seen.
  const firstPath = new Map();
  for (const line of git(["rev-list", "--objects", ...revs], root).toString("utf8").split("\n")) {
    const space = line.indexOf(" ");
    if (space > 0 && !firstPath.has(line.slice(0, space))) firstPath.set(line.slice(0, space), line.slice(space + 1));
  }
  const objects = [...firstPath.keys()];
  const blobs = objects.length === 0 ? [] : git(["cat-file", "--batch-check"], root, objects.join("\n") + "\n")
    .toString("utf8")
    .split("\n")
    .map((line) => line.split(" "))
    .filter(([, type]) => type === "blob")
    .map(([sha]) => sha);
  for (const [sha, buf] of catBlobs(root, blobs)) {
    const file = firstPath.get(sha);
    if (file === SELF) continue;
    const text = decodeText(buf);
    if (text !== null) findings.push(...scanText(text, { file: `${file}@${sha.slice(0, 7)}`, denylist }));
  }

  const everPaths = git(["-c", "core.quotePath=false", "log", "--format=", "--name-only", ...revs], root).toString("utf8").split("\n");
  findings.push(...pathFindings(root, [...new Set(everPaths.filter(Boolean))]));

  const emailRule = RULES.find((rule) => rule.id === "email");
  const personalEmails = new Map(); // "<role>\0<email>" -> number of commits
  const fields = git(["log", "--format=%h%x00%ae%x00%ce%x00%B%x00", ...revs], root).toString("utf8").split("\0");
  for (let i = 0; i + 3 < fields.length; i += 4) {
    const commit = fields[i].trim();
    const message = fields[i + 3].replace(emailRule.re, (m) => (isPublicEmail(m) ? "<public email>" : m));
    findings.push(...scanText(message, { file: `commit ${commit} message`, denylist }));
    for (const [role, email] of [["author", fields[i + 1]], ["committer", fields[i + 2]]]) {
      if (!email || isPublicEmail(email)) continue;
      const key = `${role}\0${email}`;
      personalEmails.set(key, (personalEmails.get(key) ?? 0) + 1);
    }
  }
  for (const [key, count] of personalEmails) {
    const [role, email] = key.split("\0");
    findings.push({ file: "commit metadata", line: 0, rule: "commit-identity", match: `${role} ${mask(email)} on ${count} commit(s); only a fresh history removes it` });
  }
  return { findings, denylistTerms: denylist.length };
}

/**
 * The author and committer emails git would record for the next commit, when they are not fine to
 * publish. If git cannot determine an identity it refuses to commit, so there is nothing to check.
 */
export function identityFindings(root) {
  const findings = [];
  for (const [variable, role] of [["GIT_AUTHOR_IDENT", "author"], ["GIT_COMMITTER_IDENT", "committer"]]) {
    const res = spawnSync("git", ["var", variable], { cwd: root, encoding: "utf8" });
    if (res.status !== 0) continue;
    const email = /<([^>]*)>/.exec(res.stdout)?.[1]?.trim() ?? "";
    if (email && !isPublicEmail(email)) {
      findings.push({ file: "git config user.email", line: 0, rule: "commit-identity", match: `${role} ${mask(email)}; use a GitHub noreply address` });
    }
  }
  return findings;
}

export function formatFinding(f) {
  const where = f.line ? `${f.file}:${f.line}` : f.file;
  return `${where}: ${f.rule} — ${f.match}`;
}

function main(argv) {
  const staged = argv.includes("--staged");
  const history = argv.includes("--history");
  let result;
  try {
    const revs = argv.filter((arg) => !arg.startsWith("--"));
    result = history ? scanHistory(revs.length ? { revs } : {}) : scanRepo({ staged });
  } catch (err) {
    console.error(`pii-guard: could not scan repository: ${err.message}`);
    return 2;
  }
  const { findings, denylistTerms } = result;
  const denylistNote = denylistTerms ? `denylist: ${denylistTerms} terms` : `denylist: none (${DENYLIST_FILE} missing)`;
  if (findings.length === 0) {
    console.log(`pii-guard: clean${staged ? " (staged)" : history ? " (history)" : ""}; ${denylistNote}`);
    return 0;
  }
  console.error(`pii-guard: ${findings.length} finding(s); ${denylistNote}. Personal data or secrets must stay in data/ or .env.`);
  for (const f of findings) console.error("  " + formatFinding(f));
  console.error(`Real names or merchants? Add them to ${DENYLIST_FILE} (gitignored) so the guard knows them.`);
  return 1;
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === import.meta.filename;
  } catch {
    return false;
  }
}

if (isMainModule()) process.exit(main(process.argv.slice(2)));

// Exposed for the CLI integration test.
export function runCli(args, cwd) {
  return spawnSync(process.execPath, [import.meta.filename, ...args], { cwd, encoding: "utf8" });
}
