import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, dismissMilestone, fileTransaction, getPlan, getSyncStatus, importCsv, updateAccount } from "./api.js";

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(body === null ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api client", () => {
  it("returns the parsed JSON body on success", async () => {
    vi.stubGlobal("fetch", respond(200, { running: false, last: null }));
    await expect(getSyncStatus()).resolves.toEqual({ running: false, last: null });
    expect(fetch).toHaveBeenCalledWith("/api/sync/status", expect.objectContaining({ headers: expect.objectContaining({ accept: "application/json" }) }));
  });

  it("turns an error response into an ApiError with the server's code", async () => {
    vi.stubGlobal("fetch", respond(409, { error: "not_configured", message: "Paste a setup token first." }));
    const err = await getSyncStatus().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: "not_configured", message: "Paste a setup token first." });
  });

  it("falls back to the HTTP status when the error body is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("gateway down", { status: 502, statusText: "Bad Gateway" })));
    const err = await getSyncStatus().catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 502, code: "http_error", message: "502 Bad Gateway", body: "gateway down" });
  });

  it("posts JSON bodies", async () => {
    vi.stubGlobal("fetch", respond(200, { transaction: { id: 7, bucketId: "meals" }, rule: { match: "GROCER", bucket: "meals" }, categorized: {} }));
    const result = await fileTransaction(7, { bucket: "meals", saveRule: true });
    expect(result.transaction.bucketId).toBe("meals");
    expect(result.rule).toEqual({ match: "GROCER", bucket: "meals" });
    expect(fetch).toHaveBeenCalledWith(
      "/api/transactions/7/bucket",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ bucket: "meals", saveRule: true }), headers: expect.objectContaining({ "content-type": "application/json" }) }),
    );
  });

  it("dismisses a milestone as JSON, which the route requires", async () => {
    vi.stubGlobal("fetch", respond(200, { milestone: { id: 4, dismissed: true } }));
    await dismissMilestone(4);
    expect(fetch).toHaveBeenCalledWith(
      "/api/milestones/4/dismiss",
      expect.objectContaining({ method: "POST", body: "{}", headers: expect.objectContaining({ "content-type": "application/json" }) }),
    );
  });

  describe("getPlan", () => {
    it("reports a missing plan as a state, not an error", async () => {
      vi.stubGlobal("fetch", respond(404, { error: "plan_missing", path: "/srv/data/plan.json", hint: "Copy plan.example.json there." }));
      await expect(getPlan()).resolves.toEqual({ ok: false, error: "plan_missing", path: "/srv/data/plan.json", hint: "Copy plan.example.json there." });
    });

    it("reports an invalid plan with its issues", async () => {
      vi.stubGlobal("fetch", respond(422, { error: "plan_invalid", path: "/srv/data/plan.json", issues: [{ path: "buckets", message: "expected array" }] }));
      const state = await getPlan();
      expect(state.ok).toBe(false);
      if (!state.ok && state.error === "plan_invalid") expect(state.issues).toHaveLength(1);
    });

    it("still throws for other failures", async () => {
      vi.stubGlobal("fetch", respond(500, { error: "internal", message: "boom" }));
      await expect(getPlan()).rejects.toMatchObject({ code: "internal" });
    });
  });
  it("sends account changes as a JSON PATCH", async () => {
    vi.stubGlobal("fetch", respond(200, { account: { id: 3, role: "card" }, categorized: {} }));
    await updateAccount(3, { role: "card", linkedDebtId: "card-a" });
    expect(fetch).toHaveBeenCalledWith(
      "/api/accounts/3",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ role: "card", linkedDebtId: "card-a" }), headers: expect.objectContaining({ "content-type": "application/json" }) }),
    );
  });

  it("uploads a CSV as multipart form data without a JSON content type", async () => {
    vi.stubGlobal("fetch", respond(200, { inserted: 1 }));
    const file = new File(["Date,Description,Amount\n"], "export.csv", { type: "text/csv" });
    await importCsv({ file, preset: "generic", target: { accountName: "Credit Union" } });
    const [path, init] = vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(path).toBe("/api/import/csv");
    expect(init.method).toBe("POST");
    expect(init.headers["content-type"]).toBeUndefined();
    const body = init.body as FormData;
    expect(body.get("preset")).toBe("generic");
    expect(body.get("accountName")).toBe("Credit Union");
    expect(body.has("accountId")).toBe(false);
    expect((body.get("file") as File).name).toBe("export.csv");
  });
});
