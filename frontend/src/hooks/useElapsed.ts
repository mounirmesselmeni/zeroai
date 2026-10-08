import { useEffect, useState } from 'react';

/** Milliseconds since `startedAt`, re-rendering every 100 ms while `running`. */
export function useElapsed(startedAt: number | null, running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [running, startedAt]);
  return startedAt === null ? 0 : Math.max(0, now - startedAt);
}
