import { useCallback, useRef, useState } from 'react';

export interface Toast {
  id: number;
  message: string;
}

/** Small transient toast queue. push() auto-dismisses after `ttlMs`. */
export function useToasts(ttlMs = 3000) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const push = useCallback(
    (message: string) => {
      const id = nextId.current++;
      setToasts((t) => [...t, { id, message }]);
      setTimeout(() => {
        setToasts((t) => t.filter((x) => x.id !== id));
      }, ttlMs);
    },
    [ttlMs],
  );

  return { toasts, push };
}
