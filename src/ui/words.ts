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
