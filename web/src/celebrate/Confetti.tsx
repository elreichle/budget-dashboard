import { useEffect, useRef } from "react";
import { burst } from "./burst.js";
import { claimCelebration, releaseCelebration } from "./session.js";

/** A full-screen, click-through canvas that plays one burst per milestone id, once per browser session. */
export function Confetti({ milestoneId }: { milestoneId: number | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (milestoneId === null || !canvas.current || !claimCelebration(milestoneId)) return;
    const stop = burst(canvas.current);
    // A burst cut short (unmounted, or StrictMode's rehearsal run) was never really seen.
    return () => {
      if (stop()) releaseCelebration(milestoneId);
    };
  }, [milestoneId]);
  return <canvas ref={canvas} className="confetti" aria-hidden="true" />;
}
