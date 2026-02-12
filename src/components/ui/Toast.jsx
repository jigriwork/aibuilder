import { useEffect } from "react";

export default function Toast({ open, message, onDone, tone = "brand", duration = 2200 }) {
  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(() => onDone?.(), duration);
    return () => clearTimeout(timer);
  }, [open, onDone, duration]);

  if (!open || !message) return null;

  return (
    <div className={`ui-toast ui-toast--${tone}`} role="status" aria-live="polite">
      {message}
    </div>
  );
}
