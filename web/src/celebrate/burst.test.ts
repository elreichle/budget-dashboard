import { afterEach, describe, expect, it, vi } from "vitest";
import { BURST_MS, burst, spawn, step } from "./burst.js";

function fakeCanvas() {
  const ctx = { setTransform: vi.fn(), clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(), fillRect: vi.fn(), fillStyle: "", globalAlpha: 1 };
  const getContext = vi.fn(() => ctx);
  return { canvas: { width: 0, height: 0, getContext } as unknown as HTMLCanvasElement, ctx, getContext };
}

/** A hand-cranked animation clock: `frame(ms)` runs the waiting callback at that timestamp. */
function fakeFrames() {
  let waiting: FrameRequestCallback | null = null;
  vi.stubGlobal("requestAnimationFrame", vi.fn((cb: FrameRequestCallback) => ((waiting = cb), 1)));
  vi.stubGlobal("cancelAnimationFrame", vi.fn(() => (waiting = null)));
  return {
    frame(ms: number) {
      const cb = waiting;
      waiting = null;
      cb?.(ms);
    },
    waiting: () => waiting !== null,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("confetti burst", () => {
  it("launches pieces upward from the bottom centre and lets gravity bring them down", () => {
    const [piece] = spawn(1, 800, 600, ["#123456"], () => 0.5);
    expect(piece).toMatchObject({ x: 400, y: 552, color: "#123456", spin: 0 });
    expect(piece!.vx).toBeCloseTo(0);
    const soon = step([piece!], 0.05)[0]!;
    expect(soon.y).toBeLessThan(piece!.y);
    let later = [piece!];
    for (let i = 0; i < 40; i++) later = step(later, 0.05);
    expect(later[0]!.vy).toBeGreaterThan(0);
  });

  it("shares the colours out in turn", () => {
    expect(spawn(5, 800, 600, ["a", "b"]).map((p) => p.color)).toEqual(["a", "b", "a", "b", "a"]);
  });

  it("draws every frame until the burst is over, then clears the canvas and stops", () => {
    const frames = fakeFrames();
    const { canvas, ctx } = fakeCanvas();
    const stop = burst(canvas, { count: 10, reducedMotion: false });
    expect(canvas.width).toBe(window.innerWidth);
    frames.frame(0);
    frames.frame(16);
    expect(ctx.fillRect).toHaveBeenCalledTimes(20);
    frames.frame(BURST_MS);
    expect(ctx.fillRect).toHaveBeenCalledTimes(20);
    expect(ctx.clearRect).toHaveBeenCalledTimes(3);
    expect(frames.waiting()).toBe(false);
    expect(stop()).toBe(false);
  });

  it("stops early on request and clears what it drew", () => {
    const frames = fakeFrames();
    const { canvas, ctx } = fakeCanvas();
    const stop = burst(canvas, { count: 3, reducedMotion: false });
    frames.frame(0);
    expect(stop()).toBe(true);
    expect(frames.waiting()).toBe(false);
    expect(ctx.clearRect).toHaveBeenCalledTimes(2);
    expect(stop()).toBe(false);
  });

  it("draws nothing for a viewer who prefers reduced motion", () => {
    fakeFrames();
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)" })));
    const { canvas, getContext } = fakeCanvas();
    const stop = burst(canvas);
    expect(getContext).not.toHaveBeenCalled();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(stop()).toBe(false);
  });
});
