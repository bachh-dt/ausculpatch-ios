import { useEffect, useState, useSyncExternalStore } from 'react';
import { session, SessionState } from '../ble/session';

export function useSession(): SessionState {
  return useSyncExternalStore(
    (fn) => session.subscribe(fn),
    () => session.state,
  );
}

/** Re-render every `ms` milliseconds while `active`. */
export function useTicker(ms: number, active = true): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), ms);
    return () => clearInterval(id);
  }, [ms, active]);
  return tick;
}
