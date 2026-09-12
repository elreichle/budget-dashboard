// The Docker build context must never carry personal data: data/ and .env stay on the host and
// reach the container only as a mounted volume and environment variables.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.dirname(import.meta.dirname);
const read = (file) => readFileSync(path.join(root, file), "utf8");

/** `.dockerignore` patterns in order; `!` re-includes. A pattern also covers everything below a matched directory. */
function parseIgnore(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const negate = l.startsWith("!");
      const glob = (negate ? l.slice(1) : l).replace(/^\/+|\/+$/g, "");
      const source = glob
        .split(/(\*\*\/?|\*|\?)/)
        .map((part) => (part.startsWith("**") ? ".*" : part === "*" ? "[^/]*" : part === "?" ? "[^/]" : part.replace(/[.+^${}()|[\]\\]/g, "\\$&")))
        .join("");
      return { negate, re: new RegExp(`^${source}(/.*)?$`) };
    });
}

function isIgnored(patterns, file) {
  let ignored = false;
  for (const { negate, re } of patterns) if (re.test(file)) ignored = !negate;
  return ignored;
}

describe(".dockerignore", () => {
  const patterns = parseIgnore(read(".dockerignore"));

  it("keeps the data directory and env files out of the build context", () => {
    for (const file of ["data", "data/plan.json", "data/rules.json", "data/secrets.json", "data/budget.db", ".env", ".env.local"]) {
      expect(isIgnored(patterns, file), file).toBe(true);
    }
  });

  it("keeps the sources the build needs", () => {
    for (const file of ["package.json", "package-lock.json", "server/index.ts", "web/src/main.tsx", "scripts/install-hooks.mjs", "vite.config.ts"]) {
      expect(isIgnored(patterns, file), file).toBe(false);
    }
  });

  it("the matcher honours directories, globs and negation", () => {
    const p = parseIgnore("data\n*.db\n!keep.db\n**/secret-*");
    expect(isIgnored(p, "data/x/y.json")).toBe(true);
    expect(isIgnored(p, "database.ts")).toBe(false);
    expect(isIgnored(p, "a.db")).toBe(true);
    expect(isIgnored(p, "keep.db")).toBe(false);
    expect(isIgnored(p, "deep/dir/secret-1")).toBe(true);
  });
});

describe("container files", () => {
  it("the runtime image reads data from /data and never copies it in", () => {
    const dockerfile = read("Dockerfile");
    expect(dockerfile).toMatch(/^ENV .*DATA_DIR=\/data/m);
    expect(dockerfile).toMatch(/^EXPOSE \d+/m);
    expect(dockerfile).not.toMatch(/^COPY .*\bdata\b/m);
  });

  it("the runtime image listens on every interface so the published port reaches Node", () => {
    expect(read("Dockerfile")).toMatch(/^ENV .*\bHOST=0\.0\.0\.0\b/m);
  });

  it("the compose example mounts ./data at /data", () => {
    expect(read("docker-compose.example.yml")).toMatch(/-\s*\.\/data:\/data\b/);
  });
});
