/**
 * Streaming display filters for the monitor. Port of host/ausculpatch/filters.py:
 * causal Butterworth filters whose state carries from block to block, so the
 * traces settle once instead of restarting a transient at every redraw.
 */
import { butterSos, FilterKind, Sos, sosfilt, sosfiltZi } from './signal';

export const GAP_RESET_S = 1.0;

export class FilterSpec {
  constructor(
    readonly kind: FilterKind,
    readonly order: number,
    readonly lowHz: number | null = null,
    readonly highHz: number | null = null,
  ) {}

  /** Second-order sections for fs, or null if unrealisable at that rate. */
  design(fs: number): Sos | null {
    if (fs <= 0) return null;
    const ceiling = 0.45 * fs;
    const high = this.highHz ? Math.min(this.highHz, ceiling) : null;
    const low = this.lowHz;
    if (this.kind === 'bandpass') {
      if (!low || !high || low >= high) return null;
      return butterSos(this.order, [low, high], 'bandpass', fs);
    }
    if (this.kind === 'highpass') {
      if (!low || low >= ceiling) return null;
      return butterSos(this.order, low, 'highpass', fs);
    }
    if (!high) return null;
    return butterSos(this.order, high, 'lowpass', fs);
  }

  describe(): string {
    if (this.kind === 'bandpass') return `${this.lowHz}-${this.highHz} Hz, order ${this.order}`;
    if (this.kind === 'highpass') return `high-pass ${this.lowHz} Hz, order ${this.order}`;
    return `low-pass ${this.highHz} Hz, order ${this.order}`;
  }
}

export const HEART_SOUND_FILTER = new FilterSpec('bandpass', 4, 20, 100);
export const ECG_FILTER = new FilterSpec('bandpass', 2, 0.1, 40);
export const BREATHING_FILTER = new FilterSpec('lowpass', 2, null, 0.5);

export class StreamingFilter {
  private fs: number | null = null;
  private sos: Sos | null = null;
  private zi: number[][] | null = null;

  constructor(readonly spec: FilterSpec) {}

  reset(): void {
    this.zi = null;
  }

  process(x: ArrayLike<number>, fs: number): Float64Array {
    if (x.length === 0) return new Float64Array(0);
    if (this.fs === null || Math.abs(fs - this.fs) > 0.01 * this.fs) {
      this.fs = fs;
      this.sos = this.spec.design(fs);
      this.zi = null;
    }
    if (!this.sos) return Float64Array.from(x);
    if (!this.zi) {
      // Start as if the input had sat at its first value forever, so an
      // electrode DC offset does not produce a step transient.
      this.zi = sosfiltZi(this.sos).map(([a, b]) => [a * x[0], b * x[0]]);
    }
    return sosfilt(this.sos, x, this.zi);
  }
}

/** Average fixed-size blocks across calls (used before the 0.5 Hz breathing low-pass). */
export class BlockMeanDecimator {
  factor = 1;
  private pendT: number[] = [];
  private pendX: number[] = [];

  constructor(readonly targetHz = 50) {}

  reset(): void {
    this.pendT = [];
    this.pendX = [];
  }

  outputRate(fs: number): number {
    return this.factor ? fs / this.factor : fs;
  }

  process(times: ArrayLike<number>, x: ArrayLike<number>, fs: number): [Float64Array, Float64Array] {
    const factor = fs > 0 ? Math.max(1, Math.round(fs / this.targetHz)) : 1;
    if (factor !== this.factor) {
      this.factor = factor;
      this.reset();
    }
    const t = this.pendT.concat(Array.from(times));
    const v = this.pendX.concat(Array.from(x));
    const blocks = Math.floor(v.length / factor);
    const used = blocks * factor;
    this.pendT = t.slice(used);
    this.pendX = v.slice(used);
    const ot = new Float64Array(blocks);
    const ox = new Float64Array(blocks);
    for (let b = 0; b < blocks; b++) {
      let st = 0, sx = 0;
      for (let k = 0; k < factor; k++) {
        st += t[b * factor + k];
        sx += v[b * factor + k];
      }
      ot[b] = st / factor;
      ox[b] = sx / factor;
    }
    return [ot, ox];
  }
}

export function hasGap(previousT: number | null, times: ArrayLike<number>): boolean {
  if (previousT === null || times.length === 0) return previousT === null;
  return times[0] - previousT > GAP_RESET_S || times[0] < previousT;
}
