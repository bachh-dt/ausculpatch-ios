import { DutyStatus } from '../protocol/protocol';

export function duration(seconds: number): string {
  if (seconds >= 3600 && seconds % 3600 === 0) return `${seconds / 3600} h`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m >= 60) return `${Math.floor(m / 60)} h ${m % 60} min`;
  return m ? (s ? `${m} min ${s} s` : `${m} min`) : `${s} s`;
}

/** The patch's schedule state as a sentence, as in the desktop monitor. */
export function dutyInWords(d: DutyStatus): string {
  const taken = `${d.bursts} measurement${d.bursts === 1 ? '' : 's'} taken so far.`;
  if (d.state === 1) return `Measuring now. This burst ends in ${duration(d.secondsLeft)}. ${taken}`;
  if (d.state === 2) {
    return `Resting to save battery. Next measurement in ${duration(d.secondsLeft)}. ${taken} The patch stays connected, so the schedule can be changed now.`;
  }
  return 'Measuring continuously. Every heartbeat and breath is captured, which gives the most detail and the shortest battery life.';
}

export function bytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} kB`;
  return `${n} B`;
}

/** Rough charge from a single-cell Li-ion voltage under light load. */
export function batteryPercent(v: number | null): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  const pts: [number, number][] = [[3.3, 0], [3.6, 10], [3.7, 30], [3.8, 50], [3.95, 75], [4.1, 92], [4.2, 100]];
  if (v <= pts[0][0]) return 0;
  for (let i = 1; i < pts.length; i++) {
    if (v <= pts[i][0]) {
      const [v0, p0] = pts[i - 1];
      const [v1, p1] = pts[i];
      return Math.round(p0 + ((v - v0) / (v1 - v0)) * (p1 - p0));
    }
  }
  return 100;
}

export function greeting(d = new Date()): string {
  const h = d.getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function mmss(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}
