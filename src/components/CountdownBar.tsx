import { useEffect, useRef, useState } from 'react';

/** Display-only countdown against deadlineAt (server-authoritative timer;
 *  this never gates any action, it only renders). Hidden when deadlineAt is
 *  null. Driven by requestAnimationFrame per design-server-loop.md §8. */
export function CountdownBar({ deadlineAt, totalSeconds }: { deadlineAt: number | null; totalSeconds: number }) {
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

  const totalMs = totalSeconds * 1000;
  const pct = totalMs > 0 ? Math.min(100, (remainingMs / totalMs) * 100) : 0;
  const seconds = Math.ceil(remainingMs / 1000);

  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/10">
        <div
          className={['h-full rounded-full transition-[width]', pct < 25 ? 'bg-red-500' : 'bg-amber-500'].join(' ')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-5 text-right text-xs tabular-nums opacity-70">{seconds}</span>
    </div>
  );
}
