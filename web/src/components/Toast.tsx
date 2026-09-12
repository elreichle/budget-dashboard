import { useEffect, useRef } from "react";

/**
 * A short notice pinned to the bottom of the screen. The live region is always mounted so a
 * screen reader announces each message; a message dismisses itself after `timeoutMs`.
 */
export function Toast({ message, onDismiss, timeoutMs = 6000 }: { message: string | null; onDismiss: () => void; timeoutMs?: number }) {
  const dismiss = useRef(onDismiss);
  useEffect(() => {
    dismiss.current = onDismiss;
  });
  useEffect(() => {
    if (message === null) return;
    const timer = setTimeout(() => dismiss.current(), timeoutMs);
    return () => clearTimeout(timer);
  }, [message, timeoutMs]);

  return (
    <div className="toast-region" role="status">
      {message !== null && (
        <div className="toast">
          <span>{message}</span>
          <button type="button" className="toast-dismiss" aria-label="Dismiss" onClick={onDismiss}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
