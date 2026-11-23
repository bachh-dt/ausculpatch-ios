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

/** Why the last impact was or was not called a fall (shown under Developer > Motion). */
export interface FallCheck extends FallEvent {
  fall: boolean;
  freeFall: boolean;
  reason: string;
}

/**
 * Thresholds per sensitivity. The BMI270 range on the patch may be as low as
 * +/-2 g per axis, so a real impact can read under 2.5 g; normal starts at 1.8 g.
 * A brief free fall (|a| well under 1 g) just before the impact lowers the
 * impact needed by 20%.
 */
export const FALL_PROFILES: Record<FallSensitivity, { impactG: number; angleDeg: number; stillG: number }> = {
  low: { impactG: 2.2, angleDeg: 45, stillG: 0.2 },
  normal: { impactG: 1.8, angleDeg: 35, stillG: 0.3 },
  high: { impactG: 1.5, angleDeg: 30, stillG: 0.45 },
};
/** Beyond this change of angle the patch is lying on its side or back; movement afterwards does not cancel the fall. */
export const CLEAR_ANGLE_DEG = 60;
const FREE_FALL_G = 0.55;
const FREE_FALL_MIN_S = 0.06;
const PRE_S: [number, number] = [-3, -1];
const POST_S: [number, number] = [1, 6];
const REFRACTORY_S = 30;
const HISTORY_S = 12;
const SLOW_HZ = 50;

export class FallDetector {
  private slow: { t: number; x: number; y: number; z: number; m: number }[] = [];
  private acc = { n: 0, x: 0, y: 0, z: 0, t0: 0 };
  private candidate: { t: number; peak: number; freeFall: boolean } | null = null;
  private lastFall = -Infinity;
  private freeFallStart: number | null = null;
  private lastFreeFallEnd = -Infinity;
  /** Largest |a| in the last few seconds, for the Motion readout. */
  recentPeakG = 0;
  private recentPeakT = -Infinity;
  lastCheck: FallCheck | null = null;

  constructor(public sensitivity: FallSensitivity = 'normal') {}

  reset(): void {
    this.slow = [];
    this.acc = { n: 0, x: 0, y: 0, z: 0, t0: 0 };
    this.candidate = null;
    this.freeFallStart = null;
  }

  process(t: ArrayLike<number>, ax: ArrayLike<number>, ay: ArrayLike<number>, az: ArrayLike<number>, fs: number): FallEvent[] {
    const out: FallEvent[] = [];
    if (fs <= 0) return out;
    const p = FALL_PROFILES[this.sensitivity];
    const block = Math.max(1, Math.round(fs / SLOW_HZ));
    for (let i = 0; i < t.length; i++) {
      const m = Math.sqrt(ax[i] * ax[i] + ay[i] * ay[i] + az[i] * az[i]);
      if (m > this.recentPeakG || t[i] - this.recentPeakT > 5) {
        this.recentPeakG = m;
        this.recentPeakT = t[i];
      }
      // Free fall: the patch briefly weighs much less than 1 g.
      if (m < FREE_FALL_G) {
        if (this.freeFallStart === null) this.freeFallStart = t[i];
      } else if (this.freeFallStart !== null) {
        if (t[i] - this.freeFallStart >= FREE_FALL_MIN_S) this.lastFreeFallEnd = t[i];
        this.freeFallStart = null;
      }
      const freeFall = t[i] - this.lastFreeFallEnd < 1;
      const needed = freeFall ? 0.8 * p.impactG : p.impactG;
      if (m >= needed && t[i] - this.lastFall > REFRACTORY_S) {
        if (!this.candidate) this.candidate = { t: t[i], peak: m, freeFall };
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
        const check = this.judge(this.candidate, p);
        this.candidate = null;
        if (check) {
          this.lastCheck = check;
          if (check.fall) {
            this.lastFall = check.t;
            out.push({ t: check.t, impactG: check.impactG, angleDeg: check.angleDeg, stillnessG: check.stillnessG });
          }
        }
      }
    }
    return out;
  }

  private judge(c: { t: number; peak: number; freeFall: boolean }, p: { angleDeg: number; stillG: number }): FallCheck | null {
    const window = (a: number, b: number) => this.slow.filter((s) => s.t >= c.t + a && s.t <= c.t + b);
    const pre = window(PRE_S[0], PRE_S[1]);
    const post = window(POST_S[0], POST_S[1]);
    const base = { t: c.t, impactG: c.peak, freeFall: c.freeFall, angleDeg: 0, stillnessG: 0 };
    if (pre.length < 10 || post.length < 10) return { ...base, fall: false, reason: 'not enough data around the impact' };
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
    if (na < 0.3 || nb < 0.3) return { ...base, fall: false, reason: 'no steady gravity reading' };
    const angle = (Math.acos(Math.max(-1, Math.min(1, dot / (na * nb)))) * 180) / Math.PI;
    let mm = 0;
    for (const s of post) mm += s.m;
    mm /= post.length;
    let v = 0;
    for (const s of post) v += (s.m - mm) ** 2;
    const still = Math.sqrt(v / post.length);
    const r = { ...base, angleDeg: angle, stillnessG: still };
    if (angle < p.angleDeg) return { ...r, fall: false, reason: `body angle changed only ${Math.round(angle)}°` };
    if (still > p.stillG && angle < CLEAR_ANGLE_DEG) return { ...r, fall: false, reason: 'kept moving afterwards' };
    return { ...r, fall: true, reason: c.freeFall ? 'free fall, impact, new position' : 'impact, new position' };
  }
}
