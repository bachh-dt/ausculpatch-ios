/**
 * Turns a decoded patch download into history: heart rate and breathing rate
 * every 10 s, steps, and falls, all stamped with the patch's own clock. Runs
 * sample by sample inside the download decoder, so memory stays flat however
 * long the recording is.
 *
 * Samples without an absolute time (no time sync in that session) are skipped,
 * because they cannot be placed on the calendar.
 */
import * as P from '../protocol/protocol';
import { FlashSample } from '../protocol/flashlog';
import { imuToEngineeringUnits } from '../protocol/decode';
import { BlockMeanDecimator, StreamingFilter } from '../dsp/filters';
import { estimateHeartRate, estimateRateFromWave, RR_MAX_BPM, RR_MIN_BPM } from '../dsp/vitals';
import { ecgQuality, heartSoundQuality } from '../dsp/quality';
import { FallDetector, FallEvent, StepCounter } from '../dsp/motion';
import { MinuteAccumulator, MinuteRow } from '../history/aggregate';
import { breathSpec, ecgSpec, heartSpec, Settings } from '../settings/settings';

const EVAL_EVERY_S = 10;
const HR_WINDOW_S = 20;
const BR_WINDOW_S = 30;
const Q_WINDOW_S = 8;
const GAP_S = 1;

/** A bounded window of (t, value) pairs, trimmed from the front by time. */
class Window {
  t: number[] = [];
  v: number[] = [];
  private start = 0;
  constructor(private spanS: number) {}
  push(t: ArrayLike<number>, v: ArrayLike<number>): void {
    for (let i = 0; i < t.length; i++) {
      this.t.push(t[i]);
      this.v.push(v[i]);
    }
    const cut = this.t[this.t.length - 1] - this.spanS;
    while (this.start < this.t.length && this.t[this.start] < cut) this.start++;
    if (this.start > 50000) {
      this.t = this.t.slice(this.start);
      this.v = this.v.slice(this.start);
      this.start = 0;
    }
  }
  values(spanS = this.spanS): Float64Array {
    if (this.t.length === this.start) return new Float64Array(0);
    const cut = this.t[this.t.length - 1] - spanS;
    let i = this.start;
    while (i < this.t.length && this.t[i] < cut) i++;
    return Float64Array.from(this.v.slice(i));
  }
  clear(): void {
    this.t = [];
    this.v = [];
    this.start = 0;
  }
}

/** Collects one channel into ~1 s chunks and estimates its rate from the clock. */
class Chunker {
  t: number[] = [];
  v: number[][] = [];
  last: number | null = null;
  fs = 0;
  constructor(private width: number, private fallbackFs: number) {}
  push(t: number, values: number[]): boolean {
    const gap = this.last !== null && (t - this.last > GAP_S || t < this.last);
    this.last = t;
    this.t.push(t);
    this.v.push(values.slice(0, this.width));
    return gap;
  }
  ready(): boolean {
    return this.t.length > 1 && this.t[this.t.length - 1] - this.t[0] >= 1;
  }
  take(): [Float64Array, Float64Array[]] {
    const t = Float64Array.from(this.t);
    const cols = Array.from({ length: this.width }, (_, k) => Float64Array.from(this.v, (row) => row[k]));
    if (t.length > 1) {
      const span = t[t.length - 1] - t[0];
      const est = span > 0 ? (t.length - 1) / span : 0;
      this.fs = est > 0 ? est : this.fallbackFs;
    } else if (!this.fs) this.fs = this.fallbackFs;
    this.t = [];
    this.v = [];
    return [t, cols];
  }
}

export interface OfflineResult {
  rows: MinuteRow[];
  falls: (FallEvent & { epochMs: number })[];
  firstEpochMs: number | null;
  lastEpochMs: number | null;
  skipped: number;
}

export class OfflineAnalyzer {
  private acc = new MinuteAccumulator();
  private falls: (FallEvent & { epochMs: number })[] = [];
  private ecg: Chunker;
  private aco: Chunker;
  private imu: Chunker;

  private ecgFilter: StreamingFilter;
  private heartFilter: StreamingFilter;
  private breathFilter: StreamingFilter;
  private decimator = new BlockMeanDecimator(50);
  private steps = new StepCounter();
  private fallDetector: FallDetector;

  private ecgRaw = new Window(HR_WINDOW_S);
  private ecgFilt = new Window(Q_WINDOW_S);
  private acoRaw = new Window(Q_WINDOW_S);
  private heart = new Window(Q_WINDOW_S);
  private breath = new Window(BR_WINDOW_S);

  private nextEval: number | null = null;
  private first: number | null = null;
  private lastT: number | null = null;
  skipped = 0;

  constructor(settings: Settings, rates: Partial<Record<P.RateSensor, number>>) {
    this.ecg = new Chunker(1, rates.ECG ?? P.DEFAULT_RATES_HZ.ECG);
    this.aco = new Chunker(1, rates.ACO ?? P.DEFAULT_RATES_HZ.ACO);
    this.imu = new Chunker(3, rates.IMU ?? P.DEFAULT_RATES_HZ.IMU);
    this.ecgFilter = new StreamingFilter(ecgSpec(settings));
    this.heartFilter = new StreamingFilter(heartSpec(settings));
    this.breathFilter = new StreamingFilter(breathSpec(settings));
    this.fallDetector = new FallDetector(settings.fallSensitivity);
  }

  push(s: FlashSample): void {
    if (s.epochUs === null) {
      this.skipped++;
      return;
    }
    const t = s.epochUs / 1e6;
    if (this.first === null) this.first = t;
    this.lastT = t;
    if (s.channel === P.CHANNEL_ECG) {
      if (this.ecg.push(t, [s.values[0] * P.ECG_COUNTS_TO_MV])) this.resetEcg();
      if (this.ecg.ready()) this.flushEcg();
    } else if (s.channel === P.CHANNEL_ACOUSTIC) {
      if (this.aco.push(t, [s.values[0]])) this.resetAco();
      if (this.aco.ready()) this.flushAco();
    } else if (s.channel === P.CHANNEL_IMU) {
      const g = imuToEngineeringUnits(s.values);
      if (this.imu.push(t, [g[0], g[1], g[2]])) {
        this.steps.reset();
        this.fallDetector.reset();
      }
      if (this.imu.ready()) this.flushImu();
    }
    if (this.nextEval === null) this.nextEval = t + EVAL_EVERY_S;
    else if (t >= this.nextEval) {
      this.evaluate(t);
      this.nextEval = t + EVAL_EVERY_S;
    }
  }

  private resetEcg(): void {
    this.ecgFilter.reset();
    this.ecgRaw.clear();
    this.ecgFilt.clear();
  }
  private resetAco(): void {
    this.heartFilter.reset();
    this.breathFilter.reset();
    this.decimator.reset();
    this.acoRaw.clear();
    this.heart.clear();
    this.breath.clear();
  }

  private flushEcg(): void {
    const [t, [v]] = this.ecg.take();
    this.ecgRaw.push(t, v);
    this.ecgFilt.push(t, this.ecgFilter.process(v, this.ecg.fs));
  }

  private flushAco(): void {
    const [t, [v]] = this.aco.take();
    const fs = this.aco.fs;
    const h = this.heartFilter.process(v, fs);
    this.acoRaw.push(t, v);
    this.heart.push(t, h);
    const [et, env] = this.decimator.process(t, h.map(Math.abs), fs);
    if (et.length) this.breath.push(et, this.breathFilter.process(env, this.decimator.outputRate(fs)));
  }

  private flushImu(): void {
    const [t, [x, y, z]] = this.imu.take();
    const fs = this.imu.fs;
    const counted = this.steps.process(t, x, y, z, fs);
    for (const st of counted) this.acc.addSteps(st * 1000, 1);
    for (const f of this.fallDetector.process(t, x, y, z, fs)) this.falls.push({ ...f, epochMs: f.t * 1000 });
  }

  private evaluate(t: number): void {
    let hr: number | null = null;
    let br: number | null = null;
    const ecgFs = this.ecg.fs;
    if (ecgFs > 0) {
      const raw = this.ecgRaw.values();
      const q = ecgQuality(this.ecgRaw.values(Q_WINDOW_S), this.ecgFilt.values(), ecgFs);
      if (q.level === 'good' && raw.length) hr = estimateHeartRate(raw, ecgFs);
    }
    const acoFs = this.aco.fs;
    if (acoFs > 0) {
      const q = heartSoundQuality(this.acoRaw.values(), this.heart.values(), acoFs);
      if (q.level === 'good') {
        br = estimateRateFromWave(this.breath.values(), this.decimator.outputRate(acoFs), RR_MIN_BPM, RR_MAX_BPM, 12);
      }
    }
    if (hr !== null || br !== null) this.acc.addVitals(t * 1000, hr, br);
  }

  finish(): OfflineResult {
    if (this.ecg.t.length > 1) this.flushEcg();
    if (this.aco.t.length > 1) this.flushAco();
    if (this.imu.t.length > 1) this.flushImu();
    if (this.lastT !== null) this.evaluate(this.lastT);
    return {
      rows: this.acc.drain(),
      falls: this.falls,
      firstEpochMs: this.first === null ? null : this.first * 1000,
      lastEpochMs: this.lastT === null ? null : this.lastT * 1000,
      skipped: this.skipped,
    };
  }
}
