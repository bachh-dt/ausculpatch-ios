/**
 * Steps and falls from the patch's accelerometer (BMI270, in g).
 *
 * Steps: the acceleration magnitude is band-passed to 0.7-3 Hz, which keeps the
 * walking bounce and removes gravity and breathing. Each local peak above a
 * threshold is a candidate step. Candidates only count once four arrive at a
 * walking cadence, which stops reaching or turning over in bed from adding up.
 *
 * Falls: a hard impact, then for the next five seconds the patch lies still at
 * a clearly different angle from before the impact. Lying down normally has no
 * impact; a jump or a stumble that is caught has no lasting change of angle.
 */
import { FilterSpec, StreamingFilter } from './filters';
import type { FallSensitivity } from '../settings/settings';

export const STEP_BAND = new FilterSpec('bandpass', 2, 0.7, 3);
export const STEP_THRESHOLD_G = 0.05;
export const STEP_MIN_INTERVAL_S = 0.27;
export const STEP_MAX_INTERVAL_S = 2.0;
export const STEPS_TO_START = 4;

export class StepCounter {
  private filter = new StreamingFilter(STEP_BAND);
  private y1 = 0;
  private y2 = 0;
  private t1 = 0;
  private primed = 0;
  private lastPeak: number | null = null;
  private pending: number[] = [];
  private walking = false;
  total = 0;

  reset(): void {
    this.filter.reset();
    this.primed = 0;
    this.lastPeak = null;
    this.pending = [];
    this.walking = false;
  }

  /** Feed samples; returns the times of steps counted in this call. */
  process(t: ArrayLike<number>, ax: ArrayLike<number>, ay: ArrayLike<number>, az: ArrayLike<number>, fs: number): number[] {
    const n = t.length;
    if (!n || fs <= 0) return [];
    const mag = new Float64Array(n);
    for (let i = 0; i < n; i++) mag[i] = Math.sqrt(ax[i] * ax[i] + ay[i] * ay[i] + az[i] * az[i]);
    const y = this.filter.process(mag, fs);
    const counted: number[] = [];
    for (let i = 0; i < n; i++) {
      // Let the filter settle for a second after a reset.
      if (this.primed < fs) {
        this.primed++;
        this.y2 = this.y1;
        this.y1 = y[i];
        this.t1 = t[i];
        continue;
      }
      if (this.y1 > this.y2 && this.y1 >= y[i] && this.y1 > STEP_THRESHOLD_G) this.onPeak(this.t1, counted);
      this.y2 = this.y1;
      this.y1 = y[i];
      this.t1 = t[i];
    }
    this.total += counted.length;
    return counted;
  }

  private onPeak(tp: number, counted: number[]): void {
    if (this.lastPeak !== null && tp - this.lastPeak < STEP_MIN_INTERVAL_S) return;
    const gap = this.lastPeak === null ? Infinity : tp - this.lastPeak;
    this.lastPeak = tp;
    if (gap > STEP_MAX_INTERVAL_S) {
      this.walking = false;
      this.pending = [tp];
      return;
    }
    if (this.walking) {
      counted.push(tp);
      return;
    }
    this.pending.push(tp);
    if (this.pending.length >= STEPS_TO_START) {
      counted.push(...this.pending);
      this.pending = [];
      this.walking = true;
    }
  }
}

export interface FallEvent {
  t: number;
  impactG: number;
  angleDeg: number;
  stillnessG: number;
}

export const FALL_PROFILES: Record<FallSensitivity, { impactG: number; angleDeg: number; stillG: number }> = {
  low: { impactG: 3.0, angleDeg: 50, stillG: 0.1 },
  normal: { impactG: 2.5, angleDeg: 45, stillG: 0.12 },
  high: { impactG: 2.0, angleDeg: 35, stillG: 0.15 },
};
const PRE_S: [number, number] = [-3, -1];
const POST_S: [number, number] = [1, 6];
const REFRACTORY_S = 30;
const HISTORY_S = 12;
const SLOW_HZ = 50;

export class FallDetector {
  private slow: { t: number; x: number; y: number; z: number; m: number }[] = [];
  private acc = { n: 0, x: 0, y: 0, z: 0, t0: 0 };
  private candidate: { t: number; peak: number } | null = null;
  private lastFall = -Infinity;

  constructor(public sensitivity: FallSensitivity = 'normal') {}

  reset(): void {
    this.slow = [];
    this.acc = { n: 0, x: 0, y: 0, z: 0, t0: 0 };
    this.candidate = null;
  }

  process(t: ArrayLike<number>, ax: ArrayLike<number>, ay: ArrayLike<number>, az: ArrayLike<number>, fs: number): FallEvent[] {
    const out: FallEvent[] = [];
    if (fs <= 0) return out;
    const p = FALL_PROFILES[this.sensitivity];
    const block = Math.max(1, Math.round(fs / SLOW_HZ));
    for (let i = 0; i < t.length; i++) {
      const m = Math.sqrt(ax[i] * ax[i] + ay[i] * ay[i] + az[i] * az[i]);
      if (m >= p.impactG && t[i] - this.lastFall > REFRACTORY_S) {
        if (!this.candidate) this.candidate = { t: t[i], peak: m };
        else if (t[i] - this.candidate.t < 0.5) this.candidate.peak = Math.max(this.candidate.peak, m);
      }
      if (this.acc.n === 0) this.acc.t0 = t[i];
      this.acc.n++;
      this.acc.x += ax[i];
      this.acc.y += ay[i];
      this.acc.z += az[i];
      if (this.acc.n >= block) {
        const k = this.acc.n;
        const x = this.acc.x / k, y = this.acc.y / k, z = this.acc.z / k;
        this.slow.push({ t: this.acc.t0, x, y, z, m: Math.sqrt(x * x + y * y + z * z) });
        this.acc = { n: 0, x: 0, y: 0, z: 0, t0: 0 };
        while (this.slow.length && this.slow[0].t < t[i] - HISTORY_S) this.slow.shift();
      }
      if (this.candidate && t[i] >= this.candidate.t + POST_S[1]) {
        const ev = this.judge(this.candidate, p);
        this.candidate = null;
        if (ev) {
          this.lastFall = ev.t;
          out.push(ev);
        }
      }
    }
    return out;
  }

  private judge(c: { t: number; peak: number }, p: { angleDeg: number; stillG: number }): FallEvent | null {
    const window = (a: number, b: number) => this.slow.filter((s) => s.t >= c.t + a && s.t <= c.t + b);
    const pre = window(PRE_S[0], PRE_S[1]);
    const post = window(POST_S[0], POST_S[1]);
    if (pre.length < 10 || post.length < 10) return null;
    const meanVec = (w: typeof pre) => {
      let x = 0, y = 0, z = 0;
      for (const s of w) {
        x += s.x;
        y += s.y;
        z += s.z;
      }
      return [x / w.length, y / w.length, z / w.length];
    };
    const a = meanVec(pre);
    const b = meanVec(post);
    const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const na = Math.hypot(a[0], a[1], a[2]);
    const nb = Math.hypot(b[0], b[1], b[2]);
    if (na < 0.3 || nb < 0.3) return null;
    const angle = (Math.acos(Math.max(-1, Math.min(1, dot / (na * nb)))) * 180) / Math.PI;
    let mm = 0;
    for (const s of post) mm += s.m;
    mm /= post.length;
    let v = 0;
    for (const s of post) v += (s.m - mm) ** 2;
    const still = Math.sqrt(v / post.length);
    if (angle < p.angleDeg || still > p.stillG) return null;
    return { t: c.t, impactG: c.peak, angleDeg: angle, stillnessG: still };
  }
}
