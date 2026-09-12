#!/usr/bin/env node
// `npm run prepare`: point core.hooksPath at .githooks so the PII guard runs before every commit and push.
// Only touches the repository whose top level is this package (never an enclosing repo, never
// a repo-less extraction such as a Docker build), and never overrides a hooksPath someone set.
import { spawnSync } from "node:child_process";
import path from "node:path";

const pkgDir = path.dirname(path.dirname(import.meta.filename));
const git = (...args) => spawnSync("git", args, { cwd: pkgDir, encoding: "utf8" });

const top = git("rev-parse", "--show-toplevel");
if (top.status !== 0 || path.resolve(top.stdout.trim()) !== path.resolve(pkgDir)) {
  console.log("install-hooks: not the top level of a git repository; skipping hook setup.");
  process.exit(0);
}
const current = git("config", "--local", "core.hooksPath").stdout.trim();
if (current && current !== ".githooks") {
  console.warn(`install-hooks: core.hooksPath is already "${current}"; leaving it alone. Run the guard from your own hook: node scripts/pii-guard.mjs --staged`);
  process.exit(0);
}
const set = git("config", "--local", "core.hooksPath", ".githooks");
if (set.status !== 0) {
  console.error(`install-hooks: could not set core.hooksPath: ${set.stderr.trim()}`);
  process.exit(1);
}
console.log("install-hooks: core.hooksPath = .githooks (pre-commit and pre-push run the PII guard).");
