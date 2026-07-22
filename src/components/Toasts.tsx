import type { Toast } from '../lib/useToasts';

export function Toasts({ toasts }: { toasts: Toast[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed inset-x-0 z-[60] flex flex-col items-center gap-1.5 px-3 [bottom:calc(env(safe-area-inset-bottom)+4.5rem)]">
      {toasts.map((t) => (
        <div key={t.id} className="rounded-full bg-slate-900/90 px-3 py-1.5 text-xs text-white shadow-lg">
          {t.message}
        </div>
      ))}
    </div>
  );
}
