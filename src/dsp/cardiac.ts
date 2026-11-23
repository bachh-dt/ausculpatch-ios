/**
 * Cardiac timing from three views of the same heartbeat:
 *
 *   ECG                  electrical: the R peak starts each beat
 *   heart sound (PCG)    acoustic: S1 when the mitral and tricuspid valves close,
 *                        S2 when the aortic and pulmonary valves close
 *   seismocardiogram     mechanical: chest-wall vibration from the IMU. Its
 *   (SCG)                largest early peak is near aortic valve opening (AO),
 *                        and a later one near aortic valve closure (AC)
 *
 * All three are filtered forwards and backwards (zero phase), so the filters
 * do not shift the timings. Beats are cut around each R peak and averaged
 * (ensemble average), which brings the small SCG and PCG features out of the
 * noise. From the average:
 *
 *   R-S1    electromechanical activation time (EMAT)
 *   R-S2    electromechanical systole (a QS2 proxy)
 *   S1-S2   mechanical systole
 *   R-AO    pre-ejection period proxy (PEP; R stands in for Q)
 *   AO-AC   left-ventricular ejection time proxy (LVET)
 *   PEP/LVET, a contractility index
 *
 * plus heart-rate variability from the R-R intervals. These are research
 * measures from a wearable, not a diagnosis.
 */
import { butterSos, findPeaks, median, Sos, sosfilt, sosfiltZi } from './signal';
import type { BandSetting } from '../settings/settings';

export const SCG_BAND: BandSetting = { lowHz: 1, highHz: 30, order: 2 };
export const ENSEMBLE_RANGE_S: [number, number] = [-0.2, 0.8];
const GRID_STEP_S = 0.002;
const ENVELOPE_S = 0.02;
export const MIN_BEATS = 6;

export interface Series {
  t: Float64Array;
  v: Float64Array;
  fs: number;
}

export interface ImuSeries {
  t: Float64Array;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  fs: number;
}

export type Axis = 'x' | 'y' | 'z';

export interface CardiacInput {
  ecg: Series; // unfiltered, mV
  pcg: Series | null; // unfiltered counts
  scg: ImuSeries | null; // g
  ecgBand: BandSetting;
  pcgBand: BandSetting;
  axis: 'auto' | Axis;
  displayS?: number;
}

export interface Interval {
  ms: number;
  /** Interquartile range over single beats, when it could be measured beat by beat. */
  iqrMs: number | null;
}

export interface CardiacResult {
  beatsFound: number;
  beatsUsed: number;
  rrMs: number | null;
  hrv: { meanHr: number; sdnnMs: number; rmssdMs: number; pnn50: number } | null;
  intervals: {
    rS1: Interval | null;
    rS2: Interval | null;
    s1s2: Interval | null;
    rAO: Interval | null;
    aoAC: Interval | null;
    pepLvet: number | null;
    qs2Fraction: number | null;
  };
  ensemble: {
    t: Float64Array; // seconds from R
    ecg: Float64Array; // each scaled to peak 1
    pcg: Float64Array; // envelope
    scg: Float64Array | null;
    marks: { s1: number | null; s2: number | null; ao: number | null; ac: number | null };
  } | null;
  overlay: {
    t: Float64Array; // seconds, relative to the end of the window (-displayS..0)
    ecg: Float64Array;
    pcg: Float64Array;
    scg: Float64Array | null;
    r: number[];
    s1: number[];
    s2: number[];
  } | null;
  scgAxis: Axis | null;
  notes: string[];
}

// ---------------------------------------------------------------- helpers --

/** Forward-backward SOS filtering with odd-reflection padding, like scipy's sosfiltfilt. */
export function filtfilt(sos: Sos, x: ArrayLike<number>, padLen: number): Float64Array {
  const n = x.length;
  if (n === 0) return new Float64Array(0);
  const pad = Math.max(0, Math.min(n - 1, Math.round(padLen)));
  const ext = new Float64Array(n + 2 * pad);
  for (let i = 0; i < pad; i++) ext[i] = 2 * x[0] - x[pad - i];
  for (let i = 0; i < n; i++) ext[pad + i] = x[i];
  for (let i = 0; i < pad; i++) ext[pad + n + i] = 2 * x[n - 1] - x[n - 2 - i];
  const zi = sosfiltZi(sos);
  const fwd = sosfilt(sos, ext, zi.map(([a, b]) => [a * ext[0], b * ext[0]]));
  fwd.reverse();
  const back = sosfilt(sos, fwd, zi.map(([a, b]) => [a * fwd[0], b * fwd[0]]));
  back.reverse();
  return back.slice(pad, pad + n);
}

function bandpass(x: ArrayLike<number>, fs: number, band: BandSetting): Float64Array {
  const hi = Math.min(band.highHz, 0.45 * fs);
  if (fs <= 0 || band.lowHz <= 0 || band.lowHz >= hi) return Float64Array.from(x);
  const m = median(x);
  const centred = Float64Array.from(x, (v) => v - m);
  return filtfilt(butterSos(band.order, [band.lowHz, hi], 'bandpass', fs), centred, Math.min(centred.length - 1, 3 * fs / band.lowHz / 3));
}

/** Centred moving average of |x| over `widthS`. */
function envelope(x: Float64Array, fs: number, widthS = ENVELOPE_S): Float64Array {
  const w = Math.max(1, Math.round(widthS * fs));
  const half = Math.floor(w / 2);
  const out = new Float64Array(x.length);
  let sum = 0;
  const abs = (i: number) => (i >= 0 && i < x.length ? Math.abs(x[i]) : 0);
  for (let i = -half; i < w - half; i++) sum += abs(i);
  for (let i = 0; i < x.length; i++) {
    out[i] = sum / w;
    sum += abs(i + w - half) - abs(i - half);
  }
  return out;
}

/** Linear interpolation of (t, v) at time `q`; NaN outside the data. */
function interpAt(t: Float64Array, v: Float64Array, q: number, hint = { i: 0 }): number {
  const n = t.length;
  if (!n || q < t[0] || q > t[n - 1]) return NaN;
  let i = hint.i;
  if (i >= n - 1 || t[i] > q) {
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (t[mid] <= q) lo = mid;
      else hi = mid;
    }
    i = lo;
  } else {
    while (i < n - 2 && t[i + 1] <= q) i++;
  }
  hint.i = i;
  const span = t[i + 1] - t[i];
  const f = span > 0 ? (q - t[i]) / span : 0;
  return v[i] * (1 - f) + v[i + 1] * f;
}

function ensembleOf(t: Float64Array, v: Float64Array, beats: number[], grid: Float64Array): Float64Array | null {
  const sum = new Float64Array(grid.length);
  let used = 0;
  for (const r of beats) {
    const row = new Float64Array(grid.length);
    const hint = { i: 0 };
    let ok = true;
    for (let k = 0; k < grid.length; k++) {
      const val = interpAt(t, v, r + grid[k], hint);
      if (val !== val) {
        ok = false;
        break;
      }
      row[k] = val;
    }
    if (!ok) continue;
    for (let k = 0; k < grid.length; k++) sum[k] += row[k];
    used++;
  }
  if (!used) return null;
  for (let k = 0; k < grid.length; k++) sum[k] /= used;
  return sum;
}

function scaleToPeak(x: Float64Array): Float64Array {
  let m = 0;
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
  return m > 0 ? Float64Array.from(x, (v) => v / m) : x;
}

/** Index of the largest value (or |value|) of x on grid points within [a, b] s. */
function argmaxIn(grid: Float64Array, x: Float64Array, a: number, b: number, useAbs = false): number | null {
  let best = -Infinity, bi: number | null = null;
  for (let k = 0; k < grid.length; k++) {
    if (grid[k] < a || grid[k] > b) continue;
    const v = useAbs ? Math.abs(x[k]) : x[k];
    if (v > best) {
      best = v;
      bi = k;
    }
  }
  return bi;
}

/** A peak only counts if it stands well above the signal's typical level. */
function prominent(x: Float64Array, k: number | null, factor = 2): boolean {
  if (k === null) return false;
  const typical = median(Float64Array.from(x, Math.abs));
  return Math.abs(x[k]) > factor * typical;
}

function quartiles(xs: number[]): [number, number, number] {
  const a = [...xs].sort((p, q) => p - q);
  const at = (q: number) => a[Math.min(a.length - 1, Math.max(0, Math.round(q * (a.length - 1))))];
  return [at(0.25), at(0.5), at(0.75)];
}

/** R peaks (indices) in a band-passed ECG, whichever way the QRS points. */
export function rPeaks(ecg: Float64Array, fs: number): number[] {
  if (ecg.length < fs * 2) return [];
  const sorted = Float64Array.from(ecg).sort();
  const hiQ = sorted[Math.floor(0.995 * (sorted.length - 1))];
  const loQ = -sorted[Math.floor(0.005 * (sorted.length - 1))];
  const sign = hiQ >= loQ ? 1 : -1;
  const x = Float64Array.from(ecg, (v) => v * sign);
  return findPeaks(x, 0.5 * Math.max(hiQ, loQ), Math.max(1, Math.floor(0.33 * fs)));
}

function decimateForDisplay(t: Float64Array, v: Float64Array, t0: number, t1: number, points: number): [Float64Array, Float64Array] {
  const out_t: number[] = [];
  const out_v: number[] = [];
  const bin = (t1 - t0) / points;
  let k = 0;
  while (k < t.length && t[k] < t0) k++;
  for (let b = 0; b < points; b++) {
    const end = t0 + (b + 1) * bin;
    let best = 0, bt = NaN, found = false;
    while (k < t.length && t[k] < end) {
      if (!found || Math.abs(v[k]) > Math.abs(best)) {
        best = v[k];
        bt = t[k];
        found = true;
      }
      k++;
    }
    if (found) {
      out_t.push(bt);
      out_v.push(best);
    }
  }
  return [Float64Array.from(out_t), Float64Array.from(out_v)];
}

// ------------------------------------------------------------------ main --

export function analyzeCardiac(input: CardiacInput): CardiacResult {
  const notes: string[] = [];
  const empty: CardiacResult = {
    beatsFound: 0,
    beatsUsed: 0,
    rrMs: null,
    hrv: null,
    intervals: { rS1: null, rS2: null, s1s2: null, rAO: null, aoAC: null, pepLvet: null, qs2Fraction: null },
    ensemble: null,
    overlay: null,
    scgAxis: null,
    notes,
  };
  const { ecg } = input;
  if (ecg.fs <= 0 || ecg.v.length < ecg.fs * 5) {
    notes.push('Waiting for at least 5 s of ECG.');
    return empty;
  }

  // ECG and R peaks.
  const ecgF = bandpass(ecg.v, ecg.fs, input.ecgBand);
  const peaks = rPeaks(ecgF, ecg.fs);
  const r = peaks.map((i) => ecg.t[i]);
  const rr = r.slice(1).map((v, i) => v - r[i]);
  const result: CardiacResult = { ...empty, beatsFound: r.length };
  if (rr.length < MIN_BEATS - 1) {
    notes.push(`Found ${r.length} heartbeats in the ECG; needs ${MIN_BEATS}. Check the ECG contact.`);
    return result;
  }
  const rrMed = median(rr);
  result.rrMs = rrMed * 1000;

  // Heart-rate variability on successive normal intervals.
  const normal = rr.filter((v) => Math.abs(v - rrMed) < 0.25 * rrMed);
  if (normal.length >= 8) {
    const ms = normal.map((v) => v * 1000);
    const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
    const sdnn = Math.sqrt(ms.reduce((a, b) => a + (b - mean) ** 2, 0) / (ms.length - 1));
    const diffs = ms.slice(1).map((v, i) => v - ms[i]);
    const rmssd = Math.sqrt(diffs.reduce((a, b) => a + b * b, 0) / diffs.length);
    const pnn50 = diffs.filter((d) => Math.abs(d) > 50).length / diffs.length;
    result.hrv = { meanHr: 60000 / mean, sdnnMs: sdnn, rmssdMs: rmssd, pnn50 };
  } else {
    notes.push('Heart-rate variability needs at least 9 regular beats.');
  }

  // Beats to average: complete windows with a regular interval before them.
  const beats = r.filter((t, i) => i > 0 && Math.abs(rr[i - 1] - rrMed) < 0.25 * rrMed);
  const n = Math.round((ENSEMBLE_RANGE_S[1] - ENSEMBLE_RANGE_S[0]) / GRID_STEP_S) + 1;
  const grid = Float64Array.from({ length: n }, (_, k) => ENSEMBLE_RANGE_S[0] + k * GRID_STEP_S);
  const ensEcg = ensembleOf(ecg.t, ecgF, beats, grid);
  result.beatsUsed = beats.length;
  if (!ensEcg) return result;

  // Heart sound: band-pass, then envelope.
  let pcgF: Float64Array | null = null;
  let pcgEnv: Float64Array | null = null;
  let ensPcg: Float64Array | null = null;
  if (input.pcg && input.pcg.fs > 0 && input.pcg.v.length > input.pcg.fs * 5) {
    pcgF = bandpass(input.pcg.v, input.pcg.fs, input.pcgBand);
    pcgEnv = envelope(pcgF, input.pcg.fs);
    ensPcg = ensembleOf(input.pcg.t, pcgEnv, beats, grid);
  } else notes.push('No heart sound in this window.');

  // Seismocardiogram: pick the axis with the strongest beat-locked wave.
  let ensScg: Float64Array | null = null;
  let scgF: Float64Array | null = null;
  let scgT: Float64Array | null = null;
  if (input.scg && input.scg.fs >= 50 && input.scg.t.length > input.scg.fs * 5) {
    const axes: Axis[] = input.axis === 'auto' ? ['x', 'y', 'z'] : [input.axis];
    let best = -1;
    for (const a of axes) {
      const f = bandpass(input.scg[a], input.scg.fs, SCG_BAND);
      const e = ensembleOf(input.scg.t, f, beats, grid);
      if (!e) continue;
      let lo = Infinity, hi = -Infinity;
      for (let k = 0; k < grid.length; k++) {
        if (grid[k] < 0 || grid[k] > 0.6) continue;
        lo = Math.min(lo, e[k]);
        hi = Math.max(hi, e[k]);
      }
      if (hi - lo > best) {
        best = hi - lo;
        ensScg = e;
        scgF = f;
        result.scgAxis = a;
      }
    }
    scgT = input.scg.t;
    if (input.scg.fs < 100) notes.push('The IMU runs below 100 Hz; SCG timings are coarse. Raise it under Developer > Sampling.');
  } else notes.push('No motion data for the seismocardiogram (needs the IMU at 50 Hz or more).');

  // Markers on the averaged beat.
  const at = (k: number | null) => (k === null ? null : grid[k]);
  let s1: number | null = null, s2: number | null = null, ao: number | null = null, ac: number | null = null;
  if (ensPcg) {
    const k1 = argmaxIn(grid, ensPcg, 0.02, 0.2);
    if (prominent(ensPcg, k1)) s1 = at(k1);
    const from = Math.max((s1 ?? 0.05) + 0.15, 0.22);
    const to = Math.min(0.6, 0.65 * rrMed);
    const k2 = from < to ? argmaxIn(grid, ensPcg, from, to) : null;
    if (prominent(ensPcg, k2, 1.6)) s2 = at(k2);
    if (s1 === null) notes.push('S1 is not clear in the averaged heart sound.');
    if (s2 === null) notes.push('S2 is not clear in the averaged heart sound.');
  }
  if (ensScg) {
    const kAo = s1 !== null ? argmaxIn(grid, ensScg, s1 - 0.04, s1 + 0.08, true) : argmaxIn(grid, ensScg, 0.03, 0.18, true);
    if (prominent(ensScg, kAo)) ao = at(kAo);
    const kAc = s2 !== null ? argmaxIn(grid, ensScg, s2 - 0.05, s2 + 0.05, true) : argmaxIn(grid, ensScg, Math.max(0.25, (ao ?? 0.1) + 0.18), Math.min(0.6, 0.65 * rrMed), true);
    if (prominent(ensScg, kAc, 1.5)) ac = at(kAc);
  }

  // Beat-by-beat S1 and S2 latencies, for their spread.
  const perBeat = (lo: (b: number) => number, hi: (b: number) => number): number[] => {
    if (!pcgEnv || !input.pcg) return [];
    const out: number[] = [];
    const t = input.pcg.t;
    for (const b of beats) {
      let best = -Infinity, bt = NaN;
      let i = 0, j = t.length;
      while (i < j) {
        const mid = (i + j) >> 1;
        if (t[mid] < b + lo(b)) i = mid + 1;
        else j = mid;
      }
      for (; i < t.length && t[i] <= b + hi(b); i++) {
        if (pcgEnv[i] > best) {
          best = pcgEnv[i];
          bt = t[i] - b;
        }
      }
      if (bt === bt) out.push(bt);
    }
    return out;
  };
  const iqr = (xs: number[]) => {
    if (xs.length < 4) return null;
    const [q1, , q3] = quartiles(xs);
    return (q3 - q1) * 1000;
  };
  const s1Beats = s1 !== null ? perBeat(() => s1! - 0.04, () => s1! + 0.04) : [];
  const s2Beats = s2 !== null ? perBeat(() => s2! - 0.05, () => s2! + 0.05) : [];

  const iv = (a: number | null, b: number | null, spread: number | null = null): Interval | null =>
    a !== null && b !== null && b > a ? { ms: (b - a) * 1000, iqrMs: spread } : null;
  const rS1 = iv(0, s1, iqr(s1Beats));
  const rS2 = iv(0, s2, iqr(s2Beats));
  const rAO = iv(0, ao);
  const aoAC = iv(ao, ac);
  result.intervals = {
    rS1,
    rS2,
    s1s2: iv(s1, s2),
    rAO,
    aoAC,
    pepLvet: rAO && aoAC ? rAO.ms / aoAC.ms : null,
    qs2Fraction: rS2 ? rS2.ms / (rrMed * 1000) : null,
  };
  result.ensemble = {
    t: grid,
    ecg: scaleToPeak(ensEcg),
    pcg: ensPcg ? scaleToPeak(ensPcg) : new Float64Array(grid.length),
    scg: ensScg ? scaleToPeak(ensScg) : null,
    marks: { s1, s2, ao, ac },
  };

  // The last few seconds, overlaid on one time axis.
  const displayS = input.displayS ?? 5;
  const tEnd = ecg.t[ecg.t.length - 1];
  const t0 = tEnd - displayS;
  const POINTS = 500;
  const [et, ev] = decimateForDisplay(ecg.t, ecgF, t0, tEnd, POINTS);
  const rel = (x: Float64Array) => Float64Array.from(x, (v) => v - tEnd);
  let pv: Float64Array = new Float64Array(0), pt: Float64Array = new Float64Array(0);
  if (pcgF && input.pcg) [pt, pv] = decimateForDisplay(input.pcg.t, pcgF, t0, tEnd, POINTS);
  let sv: Float64Array | null = null, st: Float64Array = new Float64Array(0);
  if (scgF && scgT) [st, sv] = decimateForDisplay(scgT, scgF, t0, tEnd, POINTS);
  // Resample PCG and SCG onto the ECG display times so the three arrays share one axis.
  const onto = (t: Float64Array, v: Float64Array) => {
    const hint = { i: 0 };
    return Float64Array.from(et, (q) => {
      const y = interpAt(t, v, q, hint);
      return y === y ? y : 0;
    });
  };
  const recentR = r.filter((x) => x >= t0);
  result.overlay = {
    t: rel(et),
    ecg: scaleToPeak(ev),
    pcg: pt.length ? scaleToPeak(onto(pt, pv)) : new Float64Array(et.length),
    scg: sv && st.length ? scaleToPeak(onto(st, sv)) : null,
    r: recentR.map((x) => x - tEnd),
    s1: s1 !== null ? recentR.map((x) => x + s1! - tEnd).filter((x) => x <= 0) : [],
    s2: s2 !== null ? recentR.map((x) => x + s2! - tEnd).filter((x) => x <= 0) : [],
  };
  return result;
}

/** Approximate adult reference ranges at rest, for orientation only. */
export const REFERENCE = {
  rS1: 'about 40-100 ms',
  rS2: 'about 350-450 ms, shorter at higher heart rates',
  s1s2: 'about 280-360 ms at rest',
  rAO: 'about 70-120 ms',
  aoAC: 'about 250-330 ms',
  pepLvet: 'about 0.30-0.40',
  sdnn: 'depends on age and recording length',
  rmssd: 'depends on age; higher at rest',
};
