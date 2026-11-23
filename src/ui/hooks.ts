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

import { engine, EngineState } from '../live/engine';
import { history, settings } from '../app/services';
import { Settings } from '../settings/settings';
import { recordings } from '../storage/recordings';

export function useEngine(): EngineState {
  return useSyncExternalStore(
    (fn) => engine.subscribe(fn),
    () => engine.state,
  );
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (fn) => settings.subscribe(fn),
    () => settings.get(),
  );
}

/** Changes whenever history is written, so charts can recompute. */
export function useHistoryVersion(): number {
  return useSyncExternalStore(
    (fn) => history.subscribe(fn),
    () => history.version,
  );
}

let recordingsVersion = 0;
recordings.subscribe(() => recordingsVersion++);
export function useRecordingsVersion(): number {
  return useSyncExternalStore(
    (fn) => recordings.subscribe(fn),
    () => recordingsVersion,
  );
}
