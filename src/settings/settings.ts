/**
 * App settings, kept in Documents/settings.json. Everything the Developer tab
 * can change lives here, so a filter tweak survives a restart.
 */
import { FilterSpec } from '../dsp/filters';

export type FallSensitivity = 'low' | 'normal' | 'high';
export type WindowS = 5 | 10 | 30;

export interface BandSetting {
  lowHz: number;
  highHz: number;
  order: number;
}

export interface Settings {
  windowS: WindowS;
  heartBand: BandSetting;
  ecgBand: BandSetting;
  /** Breathing band-pass low edge; 0 turns it into a low-pass at breathCutHz. */
  breathLowHz: number;
  breathCutHz: number;
  breathOrder: number;
  /** 'heart': the heart band as is, for headphones. 'wide': wider band plus harmonics the speaker can play. */
  listenBand: 'heart' | 'wide';
  /** IMU axis used for the seismocardiogram, or 'auto' for the one with the strongest beat. */
  scgAxis: 'auto' | 'x' | 'y' | 'z';
  listenVolume: number; // 0..1
  traceFps: 15 | 30 | 60;
  showRaw: boolean;
  fallAlerts: boolean;
  fallSensitivity: FallSensitivity;
  stepGoal: number;
  /** Seconds of poor signal before the reattach reminder opens. */
  reattachDelayS: number;
  /** Quality scores (0..1) below this count as poor. */
  qualityThreshold: number;
  reattachReminders: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  windowS: 10,
  heartBand: { lowHz: 25, highHz: 80, order: 4 },
  ecgBand: { lowHz: 1, highHz: 40, order: 2 },
  breathLowHz: 0.1,
  breathCutHz: 0.5,
  breathOrder: 2,
  listenBand: 'heart',
  scgAxis: 'auto',
  listenVolume: 0.8,
  traceFps: 30,
  showRaw: false,
  fallAlerts: true,
  fallSensitivity: 'normal',
  stepGoal: 8000,
  reattachDelayS: 10,
  qualityThreshold: 0.45,
  reattachReminders: true,
};

export const WIDE_LISTEN_BAND: BandSetting = { lowHz: 25, highHz: 400, order: 4 };

export function heartSpec(s: Settings): FilterSpec {
  return new FilterSpec('bandpass', s.heartBand.order, s.heartBand.lowHz, s.heartBand.highHz);
}
export function ecgSpec(s: Settings): FilterSpec {
  return new FilterSpec('bandpass', s.ecgBand.order, s.ecgBand.lowHz, s.ecgBand.highHz);
}
export function breathSpec(s: Settings): FilterSpec {
  if (s.breathLowHz > 0 && s.breathLowHz < s.breathCutHz) {
    return new FilterSpec('bandpass', s.breathOrder, s.breathLowHz, s.breathCutHz);
  }
  return new FilterSpec('lowpass', s.breathOrder, null, s.breathCutHz);
}
export function listenSpec(s: Settings): FilterSpec {
  const b = s.listenBand === 'wide' ? WIDE_LISTEN_BAND : s.heartBand;
  return new FilterSpec('bandpass', b.order, b.lowHz, b.highHz);
}

/** Merge stored JSON over the defaults, dropping anything malformed. */
export function mergeSettings(stored: unknown): Settings {
  const out: Settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  if (!stored || typeof stored !== 'object') return out;
  const src = stored as Record<string, unknown>;
  for (const key of Object.keys(out) as (keyof Settings)[]) {
    const v = src[key];
    const d = out[key];
    if (v === undefined || v === null) continue;
    if (typeof d === 'object') {
      const band = v as Partial<BandSetting>;
      if (
        typeof band.lowHz === 'number' &&
        typeof band.highHz === 'number' &&
        typeof band.order === 'number' &&
        band.lowHz > 0 &&
        band.highHz > band.lowHz
      ) {
        (out as unknown as Record<string, unknown>)[key] = { lowHz: band.lowHz, highHz: band.highHz, order: band.order };
      }
    } else if (typeof v === typeof d) {
      (out as unknown as Record<string, unknown>)[key] = v;
    }
  }
  if (![5, 10, 30].includes(out.windowS)) out.windowS = DEFAULT_SETTINGS.windowS;
  if (![15, 30, 60].includes(out.traceFps)) out.traceFps = DEFAULT_SETTINGS.traceFps;
  if (!['auto', 'x', 'y', 'z'].includes(out.scgAxis)) out.scgAxis = 'auto';
  if (!['heart', 'wide'].includes(out.listenBand)) out.listenBand = 'heart';
  if (!['low', 'normal', 'high'].includes(out.fallSensitivity)) out.fallSensitivity = 'normal';
  if (out.breathLowHz < 0 || out.breathLowHz >= out.breathCutHz) out.breathLowHz = 0;
  return out;
}

type Listener = () => void;

export interface SettingsStorage {
  load(): string | null;
  save(text: string): void;
}

export class SettingsStore {
  private value: Settings;
  private listeners = new Set<Listener>();

  constructor(private storage: SettingsStorage | null) {
    let parsed: unknown = null;
    try {
      const text = storage?.load();
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    this.value = mergeSettings(parsed);
  }

  get(): Settings {
    return this.value;
  }

  update(patch: Partial<Settings>): void {
    this.value = mergeSettings({ ...this.value, ...patch });
    try {
      this.storage?.save(JSON.stringify(this.value, null, 2));
    } catch {
      // A failed save only loses the change at the next launch.
    }
    for (const fn of this.listeners) fn();
  }

  reset(keys: (keyof Settings)[]): void {
    const patch: Partial<Settings> = {};
    for (const k of keys) (patch as Record<string, unknown>)[k] = JSON.parse(JSON.stringify(DEFAULT_SETTINGS[k]));
    this.update(patch);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
