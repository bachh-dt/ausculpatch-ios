/**
 * Rolling buffers for live streaming. Port of host/ausculpatch/live.py.
 *
 * Every channel shares one TimeBase, so t = 12.0 s is the same instant on every
 * trace. Timestamps are unwrapped on arrival by taking the shortest signed step
 * modulo 2^32 from the previous one.
 */
import * as P from '../protocol/protocol';
import { DecodedBatch, imuToEngineeringUnits } from '../protocol/decode';

export const HISTORY_S = 120;
export const DEFAULT_WINDOW_S = 10;
export const RATE_WINDOW_S = 1;

const WRAP = P.TIMESTAMP_WRAP_US;
const HALF = WRAP / 2;

const CAPACITY: Record<P.ChannelName, number> = {
  [P.CHANNEL_ACOUSTIC]: 4000 * HISTORY_S,
  [P.CHANNEL_ECG]: 1000 * HISTORY_S,
  [P.CHANNEL_IMU]: 1000 * HISTORY_S,
  [P.CHANNEL_TEMP]: 50 * HISTORY_S,
  [P.CHANNEL_BATT]: 100 * HISTORY_S,
};

export class TimeBase {
  private lastRaw: number | null = null;
  private lastUnwrapped = 0;
  private origin = 0;

  reset(): void {
    this.lastRaw = null;
    this.lastUnwrapped = 0;
    this.origin = 0;
  }
  get started(): boolean {
    return this.lastRaw !== null;
  }
  toSeconds(raw: ArrayLike<number>): Float64Array {
    const out = new Float64Array(raw.length);
    if (!raw.length) return out;
    if (this.lastRaw === null) {
      this.lastRaw = raw[0];
      this.lastUnwrapped = raw[0];
      this.origin = raw[0];
    }
    let prev = this.lastRaw;
    let acc = this.lastUnwrapped;
    for (let i = 0; i < raw.length; i++) {
      const d = raw[i] - prev + HALF;
      const step = (((d % WRAP) + WRAP) % WRAP) - HALF;
      acc += step;
      prev = raw[i];
      out[i] = (acc - this.origin) / 1e6;
    }
    this.lastRaw = prev;
    this.lastUnwrapped = acc;
    return out;
  }
}

export class ChannelBuffer {
  private t: Float64Array;
  private v: Float64Array;
  private head = 0;
  private count = 0;
  private arrivals: [number, number][] = [];
  totalSamples = 0;

  constructor(
    readonly name: string,
    readonly capacity: number,
    readonly width = 1,
    readonly clock: TimeBase = new TimeBase(),
  ) {
    this.t = new Float64Array(capacity);
    this.v = new Float64Array(capacity * width);
  }

  get length(): number {
    return this.count;
  }

  /** Append [raw_timestamp, value] pairs in acquisition order. */
  add<T>(samples: [number, T][], convert?: (v: T) => number | ArrayLike<number>): void {
    const n = samples.length;
    if (!n) return;
    const raw = new Float64Array(n);
    const values = new Float64Array(n * this.width);
    for (let r = 0; r < n; r++) {
      raw[r] = samples[r][0];
      const conv = convert ? convert(samples[r][1]) : (samples[r][1] as unknown as number | ArrayLike<number>);
      if (typeof conv === 'number') values[r * this.width] = conv;
      else for (let k = 0; k < Math.min(conv.length, this.width); k++) values[r * this.width + k] = conv[k];
    }
    this.write(this.clock.toSeconds(raw), values);
    const now = Date.now() / 1000;
    this.arrivals.push([now, n]);
    this.totalSamples += n;
    this.trimArrivals(now);
  }

  /** Append samples already in seconds on the shared axis (derived traces). */
  addSeconds(times: ArrayLike<number>, values: ArrayLike<number>): void {
    if (!times.length) return;
    this.write(times, values);
    this.totalSamples += times.length;
  }

  private write(times: ArrayLike<number>, values: ArrayLike<number>): void {
    const n = times.length;
    const w = this.width;
    const start = n >= this.capacity ? n - this.capacity : 0;
    for (let i = start; i < n; i++) {
      this.t[this.head] = times[i];
      for (let k = 0; k < w; k++) this.v[this.head * w + k] = values[i * w + k];
      this.head = (this.head + 1) % this.capacity;
    }
    this.count = Math.min(this.capacity, this.count + (n - start));
  }

  private trimArrivals(now: number): void {
    const cutoff = now - RATE_WINDOW_S;
    while (this.arrivals.length && this.arrivals[0][0] < cutoff) this.arrivals.shift();
  }

  /** Newest `count` samples (times, values of one series). */
  latest(count: number, series = 0): [Float64Array, Float64Array] {
    const n = Math.max(0, Math.min(count, this.count));
    const t = new Float64Array(n);
    const v = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const idx = (this.head - n + i + this.capacity) % this.capacity;
      t[i] = this.t[idx];
      v[i] = this.v[idx * this.width + series];
    }
    return [t, v];
  }

  get measuredRateHz(): number {
    this.trimArrivals(Date.now() / 1000);
    let s = 0;
    for (const [, n] of this.arrivals) s += n;
    return s / RATE_WINDOW_S;
  }

  /** Rate implied by the device's own timestamps. Use this for filters and estimators. */
  timestampRateHz(windowS = DEFAULT_WINDOW_S): number {
    const [t] = this.snapshot(windowS);
    if (t.length < 2) return 0;
    const span = t[t.length - 1] - t[0];
    return span > 0 ? (t.length - 1) / span : 0;
  }

  get latestTimeS(): number | null {
    return this.count ? this.t[(this.head - 1 + this.capacity) % this.capacity] : null;
  }
  get earliestTimeS(): number | null {
    if (!this.count) return null;
    return this.t[this.count < this.capacity ? 0 : this.head];
  }
  latestValue(series = 0): number | null {
    if (!this.count) return null;
    return this.v[((this.head - 1 + this.capacity) % this.capacity) * this.width + series];
  }

  /** Samples with tStart <= t <= tEnd. Times are non-decreasing within the ring. */
  snapshotRange(tStart: number, tEnd: number, series = 0): [Float64Array, Float64Array] {
    const n = this.count;
    const first = n < this.capacity ? 0 : this.head;
    const at = (i: number) => this.t[(first + i) % this.capacity];
    // Binary search on the logical (oldest-first) order.
    let lo = 0, hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (at(mid) < tStart) lo = mid + 1;
      else hi = mid;
    }
    let lo2 = lo, hi2 = n;
    while (lo2 < hi2) {
      const mid = (lo2 + hi2) >> 1;
      if (at(mid) <= tEnd) lo2 = mid + 1;
      else hi2 = mid;
    }
    const m = lo2 - lo;
    const t = new Float64Array(m);
    const v = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      const idx = (first + lo + i) % this.capacity;
      t[i] = this.t[idx];
      v[i] = this.v[idx * this.width + series];
    }
    return [t, v];
  }

  snapshot(windowS = DEFAULT_WINDOW_S, series = 0): [Float64Array, Float64Array] {
    const latest = this.latestTimeS;
    if (latest === null) return [new Float64Array(0), new Float64Array(0)];
    return this.snapshotRange(latest - windowS, latest, series);
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
    this.arrivals = [];
    this.totalSamples = 0;
  }
}

export class LiveBuffers {
  readonly clock = new TimeBase();
  readonly channels: Record<P.ChannelName, ChannelBuffer>;
  epochUs: number | null = null;
  generation = 0;

  constructor() {
    const mk = (name: P.ChannelName) =>
      new ChannelBuffer(name, CAPACITY[name], name === P.CHANNEL_IMU ? 6 : 1, this.clock);
    this.channels = {
      [P.CHANNEL_ACOUSTIC]: mk(P.CHANNEL_ACOUSTIC),
      [P.CHANNEL_ECG]: mk(P.CHANNEL_ECG),
      [P.CHANNEL_IMU]: mk(P.CHANNEL_IMU),
      [P.CHANNEL_TEMP]: mk(P.CHANNEL_TEMP),
      [P.CHANNEL_BATT]: mk(P.CHANNEL_BATT),
    } as Record<P.ChannelName, ChannelBuffer>;
  }

  addBatch(b: DecodedBatch): void {
    if (b.timesync) this.epochUs = b.timesync[1];
    this.channels[P.CHANNEL_ACOUSTIC].add(b.acoustic);
    this.channels[P.CHANNEL_ECG].add(b.ecg);
    this.channels[P.CHANNEL_TEMP].add(b.temp);
    this.channels[P.CHANNEL_BATT].add(b.batt, (c: number) => P.batteryCountsToVolts(c));
    this.channels[P.CHANNEL_IMU].add(b.imu, (v) => imuToEngineeringUnits(v));
  }

  latestTimeS(): number | null {
    let best: number | null = null;
    for (const b of Object.values(this.channels)) {
      const t = b.latestTimeS;
      if (t !== null && (best === null || t > best)) best = t;
    }
    return best;
  }

  measuredRates(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, b] of Object.entries(this.channels)) out[k] = b.measuredRateHz;
    return out;
  }

  clear(): void {
    for (const b of Object.values(this.channels)) b.clear();
    this.clock.reset();
    this.epochUs = null;
    this.generation += 1;
  }
}
