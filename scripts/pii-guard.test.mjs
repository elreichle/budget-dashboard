// Fixture strings are assembled at runtime so this tracked file never contains a literal hit.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkPath, decodeText, loadDenylist, runCli, scanText } from "./pii-guard.mjs";

const rules = (text, opts) => scanText(text, opts).map((f) => f.rule);

describe("pii-guard content rules", () => {
  it("trips on card/account fragments and long digit runs", () => {
    expect(rules("Card ending ..." + "4242")).toContain("card-fragment");
    expect(rules("Acct …" + "9876")).toContain("card-fragment");
    expect(rules("xxxx" + "1234 on file")).toContain("card-fragment");
    expect(rules("acct " + "4242".repeat(4))).toContain("digit-run");
    expect(rules("card " + ["4242", "4242", "4242", "4242"].join(" "))).toContain("grouped-card");
    expect(rules("card " + ["4242", "4242", "4242", "4242"].join("-"))).toContain("grouped-card");
  });

  it("trips on emails but not documentation placeholders", () => {
    expect(rules(["alice.b", "somebank.com"].join("@"))).toContain("email");
    expect(rules("mail you@example.com or admin@app.test")).toEqual([]);
    expect(rules("git+ssh://git@github.com/x/y.git")).toEqual([]);
    expect(rules("12345+pat@users.noreply.github.com")).toEqual([]);
  });

  it("trips on SimpleFIN access URLs, claim URLs, setup tokens and bearer tokens", () => {
    expect(rules("https://" + ["abc:s3cret", "bridge.simplefin.org/simplefin"].join("@"))).toContain("url-with-credentials");
    expect(rules("https://bridge.simplefin.org/simplefin/" + "claim/" + "ABCDEF123")).toContain("simplefin-claim-url");
    expect(rules("token=" + "aHR0" + "cHM6Ly" + "9icmlkZ2Uuc2ltcGxlZmluLm9yZw")).toContain("simplefin-setup-token");
    expect(rules("Authorization: " + "Bearer " + "x".repeat(32))).toContain("bearer-token");
    expect(rules("Authorization: `Bearer ${token}`")).toEqual([]);
    expect(rules("http://localhost:8420/api/health")).toEqual([]);
  });

  it("matches denylist terms case-insensitively and masks them in the report", () => {
    const found = scanText("Paid at ZORBLAX MARKET", { denylist: ["zorblax market"] });
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("denylist");
    expect(found[0].match).not.toContain("zorblax");
    expect(rules("nothing here", { denylist: ["zorblax market"] })).toEqual([]);
  });

  it("stays quiet on ordinary code, money, dates and lockfile hashes", () => {
    const clean = [
      '{ "planned": 1200, "balance": 8000.55, "apr": 0.25 }',
      "2026-01-15T12:00:00.000Z month 2026-01 port 8420",
      "const ratio = 0.333333333333333;",
      "version 1.2.3 build 20260115",
      '    "integrity": "sha512-' + "1".repeat(20) + 'abc==",',
    ].join("\n");
    expect(scanText(clean)).toEqual([]);
  });

  it("does not mistake year lists or repeated amounts for a card number", () => {
    expect(rules("years 2020 2021 2022 2023 shown")).toEqual([]);
    expect(rules("2020-2021-2022-2023")).toEqual([]);
    expect(rules("card " + ["4242", "4242", "4242", "4242"].join(" "))).toContain("grouped-card");
  });

  it("trips on absolute home directories but not placeholders, variables or URL paths", () => {
    expect(rules("saved to /home/" + "kim/projects/notes.txt")).toContain("home-path");
    expect(rules("open /Users/" + "kim/Desktop")).toContain("home-path");
    expect(rules("C:\\Users\\" + "kim\\Documents")).toContain("home-path");
    expect(rules("WORKDIR /home/node/app, /home/user/project, ~/projects, $HOME/.config")).toEqual([]);
    expect(rules("see https://example.com/home/about")).toEqual([]);
  });

  it("decodes UTF-16 text instead of skipping it as binary", () => {
    const email = ["carol", "somebank.com"].join("@");
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(email, "utf16le")]);
    const be = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(email, "utf16le").swap16()]);
    expect(decodeText(le)).toBe(email);
    expect(decodeText(be)).toBe(email);
    expect(decodeText(Buffer.from([0x50, 0x4b, 0x00, 0x01]))).toBeNull();
    expect(scanText(decodeText(le)).map((f) => f.rule)).toEqual(["email"]);
  });

  it("reports the file and line of each hit", () => {
    const text = "fine\n" + ["bob", "bank.example.co"].join("@") + "\nfine";
    const [f] = scanText(text, { file: "notes.md" });
    expect(f).toMatchObject({ file: "notes.md", line: 2, rule: "email" });
  });
});

describe("pii-guard path rules", () => {
  it("allows only .gitkeep and *.example.json under data/, and only .env.example", () => {
    expect(checkPath("data/.gitkeep")).toBeNull();
    expect(checkPath("data/plan.example.json")).toBeNull();
    expect(checkPath("data/plan.json")?.rule).toBe("data-path");
    expect(checkPath("data/budget.db")?.rule).toBe("data-path");
    expect(checkPath("data/nested/x.example.json")?.rule).toBe("data-path");
    expect(checkPath(".env.example")).toBeNull();
    expect(checkPath(".env")?.rule).toBe("env-file");
    expect(checkPath(".env.local")?.rule).toBe("env-file");
    expect(checkPath("server/app.ts")).toBeNull();
  });

  it("reads a denylist file, skipping comments and blanks", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "pii-guard-"));
    const file = path.join(dir, "denylist.txt");
    writeFileSync(file, "# comment\n\nZorblax Market\n  Quux Bank  \n");
    expect(loadDenylist(file)).toEqual(["Zorblax Market", "Quux Bank"]);
    expect(loadDenylist(path.join(dir, "missing.txt"))).toEqual([]);
  });
});

describe("pii-guard CLI against a temp repository", () => {
  const makeRepo = () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "pii-guard-repo-"));
    const g = (...args) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
    g("init", "-q");
    g("config", "user.email", "dev@example.com");
    g("config", "user.name", "Dev");
    writeFileSync(path.join(dir, "README.md"), "# demo\nPlanned 1200 per month.\n");
    g("add", "README.md");
    g("commit", "-q", "-m", "init");
    return { dir, g };
  };

  it("exits 0 on a clean repo and 1 when personal data is staged", () => {
    const { dir, g } = makeRepo();
    const clean = runCli([], dir);
    expect(clean.status).toBe(0);
    expect(clean.stdout).toContain("denylist: none");

    mkdirSync(path.join(dir, "data"));
    writeFileSync(path.join(dir, "data", "secrets.json"), "{}\n");
    writeFileSync(path.join(dir, "notes.md"), "contact " + ["bob", "somebank.com"].join("@") + "\n");
    g("add", "data/secrets.json", "notes.md");

    const staged = runCli(["--staged"], dir);
    expect(staged.status).toBe(1);
    expect(staged.stderr).toContain("data/secrets.json: data-path");
    expect(staged.stderr).toContain("notes.md:1: email");
    expect(staged.stderr).not.toContain("somebank");

    const full = runCli([], dir);
    expect(full.status).toBe(1);
  });

  it("uses the repo's denylist", () => {
    const { dir, g } = makeRepo();
    mkdirSync(path.join(dir, "data"));
    writeFileSync(path.join(dir, "data", "pii-denylist.txt"), "Zorblax\n");
    writeFileSync(path.join(dir, ".gitignore"), "data/*\n");
    writeFileSync(path.join(dir, "notes.md"), "Lunch at ZORBLAX\n");
    g("add", ".gitignore", "notes.md");
    const res = runCli(["--staged"], dir);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("denylist: 1 terms");
    expect(res.stderr).toContain("notes.md:1: denylist");
  });

  it("flags force-added files that .gitignore forbids, even binaries", () => {
    const { dir, g } = makeRepo();
    writeFileSync(path.join(dir, ".gitignore"), "*.csv\n*.db\n");
    writeFileSync(path.join(dir, "export.csv"), "date,amount\n2026-01-02,12.50\n");
    writeFileSync(path.join(dir, "budget.db"), Buffer.from([0x53, 0x51, 0x4c, 0x00, 0x01]));
    g("add", ".gitignore");
    g("add", "-f", "export.csv", "budget.db");
    const res = runCli(["--staged"], dir);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("export.csv: gitignored-path");
    expect(res.stderr).toContain("budget.db: gitignored-path");
    g("commit", "-q", "-m", "oops");
    expect(runCli([], dir).status).toBe(1);
  });

  it("flags a personal commit email, masked, and accepts a GitHub noreply one", () => {
    const { dir, g } = makeRepo();
    g("config", "user.email", ["pat.q", "somebank.com"].join("@"));
    const personal = runCli(["--staged"], dir);
    expect(personal.status).toBe(1);
    expect(personal.stderr).toContain("git config user.email: commit-identity — author");
    expect(personal.stderr).toContain("git config user.email: commit-identity — committer");
    expect(personal.stderr).not.toContain("somebank");
    expect(runCli([], dir).status).toBe(1);

    g("config", "user.email", "12345+pat@users.noreply.github.com");
    expect(runCli(["--staged"], dir).status).toBe(0);
    expect(runCli([], dir).status).toBe(0);
  });

  it("skips symlinks and scans a staged file whose index copy differs from the tree", () => {
    const { dir, g } = makeRepo();
    mkdirSync(path.join(dir, "sub"));
    symlinkSync("sub", path.join(dir, "link"));
    g("add", "link");
    writeFileSync(path.join(dir, "notes.md"), "contact " + ["dan", "somebank.com"].join("@") + "\n");
    g("add", "notes.md");
    writeFileSync(path.join(dir, "notes.md"), "clean now\n");
    const res = runCli([], dir);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("notes.md:1: email");
  });

  it("--history finds personal data a later commit removed: file versions, messages and identities", () => {
    const { dir, g } = makeRepo();
    const personal = ["erin", "somebank.com"].join("@");
    writeFileSync(path.join(dir, "notes.md"), `contact ${personal}\n`);
    g("add", "notes.md");
    g("commit", "-q", "-m", "add notes");
    g("rm", "-q", "notes.md");
    g("-c", `user.email=${personal}`, "commit", "-q", "-m", `remove notes\n\nasked by ${personal}`);
    expect(runCli([], dir).status).toBe(0);

    const res = runCli(["--history"], dir);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/notes\.md@[0-9a-f]{7}:1: email/);
    expect(res.stderr).toMatch(/commit [0-9a-f]+ message:3: email/);
    expect(res.stderr).toContain("commit metadata: commit-identity — author");
    expect(res.stderr).toContain("commit metadata: commit-identity — committer");
    expect(res.stderr).not.toContain("somebank");

    g("checkout", "-q", "--orphan", "fresh");
    g("commit", "-q", "-m", "fresh start");
    expect(runCli(["--history", "fresh"], dir).status).toBe(0);
    expect(runCli(["--history"], dir).status).toBe(1);
  });

  it("--history flags paths committed in the past and passes a clean history with a noreply co-author", () => {
    const { dir, g } = makeRepo();
    mkdirSync(path.join(dir, "data"));
    writeFileSync(path.join(dir, "data", "pii-denylist.txt"), "Zorblax\n");
    writeFileSync(path.join(dir, ".gitignore"), "data/*\n*.csv\n");
    g("add", ".gitignore");
    g("commit", "-q", "-m", "ignore data\n\nCo-Authored-By: Helper <noreply@zorblax.com>");
    const clean = runCli(["--history"], dir);
    expect(clean.status).toBe(0);
    expect(clean.stdout).toContain("pii-guard: clean (history); denylist: 1 terms");

    writeFileSync(path.join(dir, "export.csv"), "date,amount\n");
    g("add", "-f", "export.csv");
    g("commit", "-q", "-m", "oops");
    g("rm", "-q", "export.csv");
    g("commit", "-q", "-m", "remove export");
    const res = runCli(["--history"], dir);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("export.csv: gitignored-path");
    expect(res.stderr).not.toMatch(/: denylist —/);
  });
});
