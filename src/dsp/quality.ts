/**
 * Signal quality for the reattach reminder. Each check answers "could a person
 * read a heartbeat from this?" with a score from 0 to 1.
 *
 * ECG: a flat or railed signal means an electrode is off. Otherwise the R peaks
 * should look alike (template correlation) and come at regular intervals.
 *
 * Heart sound: a clipped or flat signal means the sensor is not on the skin.
 * Otherwise most of the energy should sit in the heart band rather than in
 * broadband rubbing noise, and the envelope should repeat at the heart period.
 * When the ECG is good, S1 should follow each R peak, which is the strongest
 * single test.
 */
import * as P from '../protocol/protocol';
import { butterSos, findPeaks, median, sosfilt } from './signal';

export type QualityLevel = 'good' | 'poor' | 'none' | 'unknown';

export interface Quality {
  score: number;
  level: QualityLevel;
  reason: string;
}

export interface EcgQuality extends Quality {
  /** R-peak times in seconds from the start of the window. */
  beats: number[];
}

export const UNKNOWN: Quality = { score: 0, level: 'unknown', reason: 'waiting for signal' };
export const MIN_WINDOW_S = 4;

const FULL_SCALE_COUNTS = 2 ** 23;
export const ECG_FULL_SCALE_MV = FULL_SCALE_COUNTS * P.ECG_COUNTS_TO_MV;
export const ACO_FULL_SCALE = FULL_SCALE_COUNTS;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ramp = (x: number, lo: number, hi: number) => clamp01((x - lo) / (hi - lo));

function variance(x: ArrayLike<number>): number {
  if (x.length < 2) return 0;
  let m = 0;
  for (let i = 0; i < x.length; i++) m += x[i];
  m /= x.length;
  let s = 0;
  for (let i = 0; i < x.length; i++) s += (x[i] - m) ** 2;
  return s / x.length;
}

function fractionNear(x: ArrayLike<number>, limit: number): number {
  if (!x.length) return 0;
  let n = 0;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) >= limit) n++;
  return n / x.length;
}

function percentile(x: ArrayLike<number>, q: number): number {
  const a = Float64Array.from(x).sort();
  if (!a.length) return 0;
  return a[Math.min(a.length - 1, Math.max(0, Math.round(q * (a.length - 1))))];
}

function pearson(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma, db = b[i] - mb;
    sab += da * db;
    saa += da * da;
    sbb += db * db;
  }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
}

export function levelFor(score: number, threshold: number): QualityLevel {
  return score >= threshold ? 'good' : 'poor';
}

/**
 * @param rawMv     unfiltered ECG in mV (to spot a railed or flat input)
 * @param filtered  the band-passed ECG the trace shows
 */
export function ecgQuality(rawMv: ArrayLike<number>, filtered: ArrayLike<number>, fs: number, threshold = 0.45): EcgQuality {
  const none = (reason: string): EcgQuality => ({ score: 0, level: 'none', reason, beats: [] });
  if (fs <= 0 || filtered.length < fs * MIN_WINDOW_S) return { ...UNKNOWN, beats: [] };

  if (fractionNear(rawMv, 0.98 * ECG_FULL_SCALE_MV) > 0.02) return none('electrode off (input at full scale)');
  const sd = Math.sqrt(variance(filtered));
  if (sd < 0.005) return none('no contact (flat signal)');

  // R peaks point whichever way the electrodes happen to face.
  const hiQ = percentile(filtered, 0.995);
  const loQ = -percentile(filtered, 0.005);
  const sign = hiQ >= loQ ? 1 : -1;
  const x = Float64Array.from(filtered, (v) => v * sign);
  const peakHeight = 0.5 * Math.max(hiQ, loQ);
  const peaks = findPeaks(x, peakHeight, Math.max(1, Math.floor(0.33 * fs)));
  if (peaks.length < 3) return { score: 0.1, level: 'poor', reason: 'no clear heartbeats', beats: peaks.map((p) => p / fs) };

  // Template correlation over -100..+150 ms around each R peak.
  const before = Math.round(0.1 * fs);
  const after = Math.round(0.15 * fs);
  const len = before + after;
  const segs: Float64Array[] = [];
  for (const p of peaks) {
    if (p - before < 0 || p + after > x.length) continue;
    segs.push(x.subarray(p - before, p + after) as Float64Array);
  }
  let corr = 0;
  if (segs.length >= 2) {
    const tmpl = new Float64Array(len);
    for (const s of segs) for (let i = 0; i < len; i++) tmpl[i] += s[i] / segs.length;
    for (const s of segs) corr += pearson(s, tmpl);
    corr /= segs.length;
  }

  const intervals: number[] = [];
  for (let i = 1; i < peaks.length; i++) intervals.push(peaks[i] - peaks[i - 1]);
  const med = median(intervals);
  const spread = med > 0 ? median(intervals.map((v) => Math.abs(v - med))) / med : 1;

  const score = clamp01(0.7 * ramp(corr, 0.5, 0.9) + 0.3 * (1 - ramp(spread, 0.08, 0.3)));
  const level = levelFor(score, threshold);
  const reason =
    level === 'good' ? 'clear heartbeats' : corr < 0.7 ? 'beats look different from each other (noise or movement)' : 'irregular beat timing';
  return { score, level, reason, beats: peaks.map((p) => p / fs) };
}

/** Block-mean |x| down to about `targetHz`. Returns [envelope, its rate]. */
function envelope(x: ArrayLike<number>, fs: number, targetHz = 50): [Float64Array, number] {
  const block = Math.max(1, Math.floor(fs / targetHz));
  const n = Math.floor(x.length / block);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < block; k++) s += Math.abs(x[i * block + k]);
    out[i] = s / block;
  }
  return [out, fs / block];
}

/** Largest normalised autocorrelation for periods between 0.33 s and 1.5 s (40 to 180 bpm). */
export function periodicity(env: ArrayLike<number>, fs: number): number {
  const n = env.length;
  let m = 0;
  for (let i = 0; i < n; i++) m += env[i];
  m /= n || 1;
  const d = Float64Array.from(env, (v) => v - m);
  let r0 = 0;
  for (let i = 0; i < n; i++) r0 += d[i] * d[i];
  if (r0 <= 0) return 0;
  const lo = Math.floor(0.33 * fs);
  const hi = Math.min(n - 1, Math.ceil(1.5 * fs));
  let best = 0;
  for (let lag = lo; lag <= hi; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += d[i] * d[i + lag];
    const r = s / r0 / ((n - lag) / n);
    if (r > best) best = r;
  }
  return best;
}

/**
 * @param raw       unfiltered acoustic counts
 * @param filtered  the heart-band signal the trace shows
 * @param beats     R-peak times (s from window start) when the ECG is good
 */
export function heartSoundQuality(
  raw: ArrayLike<number>,
  filtered: ArrayLike<number>,
  fs: number,
  beats: number[] = [],
  threshold = 0.45,
): Quality {
  if (fs <= 0 || filtered.length < fs * MIN_WINDOW_S) return UNKNOWN;
  if (fractionNear(raw, 0.98 * ACO_FULL_SCALE) > 0.01) return { score: 0, level: 'none', reason: 'sensor saturated (pressed or knocked)' };
  const vf = variance(filtered);
  if (vf <= 1e-9) return { score: 0, level: 'none', reason: 'no contact (flat signal)' };

  // Share of the above-15 Hz energy that sits in the heart band.
  let ratio = 0;
  if (fs > 40) {
    const hp = butterSos(2, 15, 'highpass', fs);
    const m = median(raw);
    const h = sosfilt(hp, Float64Array.from(raw, (v) => v - m));
    const skip = Math.min(h.length - 1, Math.floor(0.5 * fs)); // settle the filter
    const vh = variance(h.subarray(skip));
    ratio = vh > 0 ? vf / vh : 0;
  }

  const [env, envFs] = envelope(filtered, fs);
  const per = periodicity(env, envFs);

  // S1 locked to R: envelope just after each R peak versus the envelope overall.
  let lock = 0;
  if (beats.length >= 3) {
    let overall = 0;
    for (let i = 0; i < env.length; i++) overall += env[i];
    overall /= env.length || 1;
    let inWin = 0, count = 0;
    for (const b of beats) {
      const i0 = Math.round(b * envFs);
      const i1 = Math.round((b + 0.15) * envFs);
      for (let i = i0; i <= i1 && i < env.length; i++) {
        inWin += env[i];
        count++;
      }
    }
    const r = count && overall > 0 ? inWin / count / overall : 0;
    lock = ramp(r, 1.1, 1.8);
  }

  const score = clamp01(0.4 * ramp(ratio, 0.1, 0.35) + 0.6 * Math.max(ramp(per, 0.15, 0.5), lock));
  const level = levelFor(score, threshold);
  const reason =
    level === 'good' ? 'clear heart sounds' : ratio < 0.2 ? 'mostly rubbing or movement noise' : 'no regular heartbeat in the sound';
  return { score, level, reason };
}

/**
 * Holds a "poor" verdict for `delayS` before acting on it, and clears at once
 * when quality recovers, so moving for a moment does not open the reminder.
 */
export class PoorContactTimer {
  private since: number | null = null;

  update(poor: boolean, nowS: number): boolean {
    if (!poor) {
      this.since = null;
      return false;
    }
    if (this.since === null) this.since = nowS;
    return nowS - this.since >= this.delayS;
  }

  constructor(public delayS: number) {}

  reset(): void {
    this.since = null;
  }
}
