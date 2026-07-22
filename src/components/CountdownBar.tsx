import { useEffect, useRef, useState } from 'react';

/** Countdown chip, display-only against deadlineAt (server-authoritative
 *  timer; this never gates any action, it only renders). Hidden when
 *  deadlineAt is null. Driven by requestAnimationFrame per
 *  design-server-loop.md §8. */
export function CountdownBar({ deadlineAt }: { deadlineAt: number | null }) {
  const [remainingMs, setRemainingMs] = useState(0);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (deadlineAt == null) {
      setRemainingMs(0);
      return;
    }
    const tick = () => {
      setRemainingMs(Math.max(0, deadlineAt - Date.now()));
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
    };
  }, [deadlineAt]);

  if (deadlineAt == null) return null;

  const seconds = Math.ceil(remainingMs / 1000);

  return (
    <span
      className={[
        'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums',
        seconds <= 5 ? 'bg-red-600 text-white' : 'bg-black/30 text-emerald-50',
      ].join(' ')}
    >
      {seconds}s
    </span>
  );
}
