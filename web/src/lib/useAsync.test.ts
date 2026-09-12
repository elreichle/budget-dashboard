import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useAsync } from "./useAsync.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("useAsync", () => {
  it("goes from loading to ok", async () => {
    const d = deferred<string>();
    const { result } = renderHook(() => useAsync(() => d.promise));
    expect(result.current.status).toBe("loading");
    await act(async () => d.resolve("hello"));
    expect(result.current).toMatchObject({ status: "ok", data: "hello" });
  });

  it("reports a rejection as an error", async () => {
    const { result } = renderHook(() => useAsync(() => Promise.reject(new Error("nope"))));
    await act(async () => {});
    expect(result.current.status).toBe("error");
    if (result.current.status === "error") expect(result.current.error.message).toBe("nope");
  });

  it("is loading again as soon as deps change, and drops the superseded result", async () => {
    const pending = new Map([
      ["a", deferred<string>()],
      ["b", deferred<string>()],
    ]);
    const { result, rerender } = renderHook(({ key }) => useAsync(() => pending.get(key)!.promise, [key]), { initialProps: { key: "a" } });
    await act(async () => pending.get("a")!.resolve("data for a"));
    expect(result.current).toMatchObject({ status: "ok", data: "data for a" });

    rerender({ key: "b" });
    expect(result.current.status).toBe("loading");

    rerender({ key: "a" });
    await act(async () => pending.get("b")!.resolve("data for b"));
    expect(result.current).not.toMatchObject({ data: "data for b" });
  });

  it("keeps the previous data on screen during a reload", async () => {
    let n = 0;
    const next = deferred<number>();
    const { result } = renderHook(() => useAsync(() => (n++ === 0 ? Promise.resolve(1) : next.promise)));
    await act(async () => {});
    expect(result.current).toMatchObject({ status: "ok", data: 1 });
    act(() => result.current.reload());
    expect(result.current).toMatchObject({ status: "ok", data: 1 });
    await act(async () => next.resolve(2));
    expect(result.current).toMatchObject({ status: "ok", data: 2 });
  });
});
