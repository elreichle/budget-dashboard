import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { createServices } from "../services.js";
import { planPath } from "./load.js";

const examplePath = path.resolve(import.meta.dirname, "../../data/plan.example.json");

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-route-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function app() {
  const config = loadConfig({ DATA_DIR: dir });
  return createApp(config, createServices(config));
}

describe("GET /api/plan", () => {
  it("404s with plan_missing and a hint when there is no plan file", async () => {
    const res = await app().request("/api/plan");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toMatchObject({ error: "plan_missing", path: planPath(dir) });
    expect(body.hint).toContain("plan.example.json");
  });

  it("500s with a JSON body when the plan file cannot be read", async () => {
    fs.mkdirSync(planPath(dir)); // a directory where the file should be -> EISDIR
    const res = await app().request("/api/plan");
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toMatchObject({ error: "internal", message: expect.stringContaining("EISDIR") });
  });

  it("422s with issue paths when the plan does not validate", async () => {
    const bad = JSON.parse(fs.readFileSync(examplePath, "utf8"));
    bad.buckets[0].group = "wants";
    fs.writeFileSync(planPath(dir), JSON.stringify(bad));
    const res = await app().request("/api/plan");
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("plan_invalid");
    expect(body.issues.map((i: { path: string }) => i.path)).toEqual(["buckets.0.group"]);
  });

  it("returns the plan when it validates", async () => {
    fs.copyFileSync(examplePath, planPath(dir));
    const res = await app().request("/api/plan");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe(1);
    expect(body.buckets.map((b: { id: string }) => b.id)).toContain("rent");
  });

  it("picks up an edit to the plan file without a restart", async () => {
    fs.copyFileSync(examplePath, planPath(dir));
    const a = app();
    expect((await (await a.request("/api/plan")).json()).income.netMonthly).toBe(4000);
    const edited = JSON.parse(fs.readFileSync(examplePath, "utf8"));
    edited.income.netMonthly = 3000;
    fs.writeFileSync(planPath(dir), JSON.stringify(edited));
    expect((await (await a.request("/api/plan")).json()).income.netMonthly).toBe(3000);
  });
});
