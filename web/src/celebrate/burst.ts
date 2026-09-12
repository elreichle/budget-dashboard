/**
 * A short confetti burst drawn on a canvas with the plain 2D API, no dependency. Pieces launch
 * upward from the bottom centre, where the celebration toast sits, tumble under gravity and fade
 * out. Nothing is drawn for a viewer who prefers reduced motion.
 */

export interface Particle {
  x: number;
  y: number;
  /** px/s */
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  /** rad/s */
  spin: number;
  color: string;
}

export const BURST_MS = 1600;
/** px/s² */
const GRAVITY = 1200;
/** Share of velocity kept after one second of air resistance. */
const DRAG = 0.6;

const COLORS = [
  { token: "--accent", fallback: "#1f8a5b" },
  { token: "--warn", fallback: "#b7791f" },
  { token: "--info", fallback: "#2f6fdb" },
  { token: "--over", fallback: "#c43d4b" },
] as const;

/** The dashboard's own colours, read from the theme tokens so dark mode gets its variants. */
function themeColors(): string[] {
  const style = getComputedStyle(document.documentElement);
  return COLORS.map(({ token, fallback }) => style.getPropertyValue(token).trim() || fallback);
}

export function spawn(count: number, width: number, height: number, colors: readonly string[], random: () => number = Math.random): Particle[] {
  return Array.from({ length: count }, (_, i) => {
    // Mostly straight up, fanned out about 40° either side.
    const angle = -Math.PI / 2 + (random() - 0.5) * (Math.PI / 2.2);
    const speed = 700 + random() * 600;
    return {
      x: width / 2 + (random() - 0.5) * Math.min(width, 240),
      y: height - 48,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 6 + random() * 6,
      rotation: random() * Math.PI * 2,
      spin: (random() - 0.5) * 12,
      color: colors[i % colors.length] ?? COLORS[0].fallback,
    };
  });
}

/** Advances every piece by `dt` seconds. */
export function step(particles: readonly Particle[], dt: number): Particle[] {
  const keep = DRAG ** dt;
  return particles.map((p) => ({
    ...p,
    x: p.x + p.vx * dt,
    y: p.y + p.vy * dt,
    vx: p.vx * keep,
    vy: p.vy * keep + GRAVITY * dt,
    rotation: p.rotation + p.spin * dt,
  }));
}

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface BurstOptions {
  count?: number;
  durationMs?: number;
  random?: () => number;
  reducedMotion?: boolean;
}

/**
 * Plays one burst on `canvas`, sized to the viewport. Returns `stop`, which ends the burst,
 * clears the canvas and tells whether it was still playing. Under reduced motion, or without a
 * 2D context, nothing plays and `stop` answers false.
 */
export function burst(canvas: HTMLCanvasElement, { count = 120, durationMs = BURST_MS, random = Math.random, reducedMotion = prefersReducedMotion() }: BurstOptions = {}): () => boolean {
  const ctx = reducedMotion ? null : canvas.getContext("2d");
  if (!ctx) return () => false;

  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  let particles = spawn(count, width, height, themeColors(), random);
  let start: number | null = null;
  let last = 0;
  let playing = true;
  let frame = 0;

  const draw = (now: number) => {
    start ??= now;
    particles = step(particles, Math.min(0.05, Math.max(0, now - (last || now)) / 1000));
    last = now;
    ctx.clearRect(0, 0, width, height);
    const t = (now - start) / durationMs;
    if (t >= 1) {
      playing = false;
      return;
    }
    // Full strength for two thirds of the burst, then fade out.
    ctx.globalAlpha = Math.min(1, 3 * (1 - t));
    for (const p of particles) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
    frame = requestAnimationFrame(draw);
  };
  frame = requestAnimationFrame(draw);

  return () => {
    if (!playing) return false;
    playing = false;
    cancelAnimationFrame(frame);
    ctx.clearRect(0, 0, width, height);
    return true;
  };
}
