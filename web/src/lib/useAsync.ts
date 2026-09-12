import { useCallback, useEffect, useState } from "react";

export type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; error: Error }
  | { status: "ok"; data: T };

function sameDeps(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
}

/**
 * Runs `load` on mount and whenever `deps` change; `load` may close over nothing but `deps`.
 * A result from a superseded run is dropped. When `deps` change the state is `loading` at once,
 * so data for the old inputs is never shown as current. `reload` runs it again with the same
 * inputs and keeps the previous data on screen until the new result lands.
 */
export function useAsync<T>(load: () => Promise<T>, deps: readonly unknown[] = []): AsyncState<T> & { reload: () => void } {
  const [result, setResult] = useState<{ deps: readonly unknown[]; state: AsyncState<T> }>({ deps, state: { status: "loading" } });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    load().then(
      (data) => live && setResult({ deps, state: { status: "ok", data } }),
      (err: unknown) => live && setResult({ deps, state: { status: "error", error: err instanceof Error ? err : new Error(String(err)) } }),
    );
    return () => {
      live = false;
    };
    // `load` and `deps` are the render's own values; the spread lists are what triggers a run.
  }, [tick, ...deps]);

  const state: AsyncState<T> = sameDeps(result.deps, deps) ? result.state : { status: "loading" };
  return { ...state, reload };
}
