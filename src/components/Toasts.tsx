import type { Toast } from '../lib/useToasts';

export function Toasts({ toasts }: { toasts: Toast[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed left-1/2 top-3 z-[60] flex -translate-x-1/2 flex-col gap-1.5 px-3">
      {toasts.map((t) => (
        <div key={t.id} className="rounded-full bg-slate-900/90 px-3 py-1.5 text-xs text-white shadow-lg">
          {t.message}
        </div>
      ))}
    </div>
  );
}
