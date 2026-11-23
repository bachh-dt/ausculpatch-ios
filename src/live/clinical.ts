/**
 * The monitor's filtered traces and vital signs. Started as a port of
 * ClinicalTraces in host/ausculpatch/apps/clinical.py; the filters now come
 * from Settings and there is a fourth output for listening.
 *
 *   heart sound = acoustic counts -> heart band-pass (default 25-80 Hz, order 4)
 *   listen      = acoustic counts -> listening band-pass, handed to the audio player
 *   breathing   = |heart sound| -> averaged to ~50 Hz -> low-pass (default 0.5 Hz, order 2)
 *   ECG         = counts -> mV -> band-pass (default 1-40 Hz, order 2)
 */
import * as P from '../protocol/protocol';
import { BlockMeanDecimator, FilterSpec, hasGap, StreamingFilter } from '../dsp/filters';
import { estimateHeartRate, estimateRateFromWave, RR_MAX_BPM, RR_MIN_BPM } from '../dsp/vitals';
import { ChannelBuffer, LiveBuffers } from './buffers';
import { breathSpec, DEFAULT_SETTINGS, ecgSpec, heartSpec, listenSpec, Settings } from '../settings/settings';

export const VITALS_WINDOW_S = 20;
export const TRACE_HISTORY_S = 35;

export interface Vitals {
  heartRate: number | null;
  breathingRate: number | null;
  skinTempC: number | null;
  batteryV: number | null;
}

export type ListenSink = (values: Float64Array, fs: number) => void;

export class ClinicalPipeline {
  private heartFilter: StreamingFilter;
  private listenFilter: StreamingFilter;
  private breathFilter: StreamingFilter;
  private ecgFilter: StreamingFilter;
  readonly decimator = new BlockMeanDecimator(50);

  readonly heartOut = new ChannelBuffer('heart', 4000 * TRACE_HISTORY_S);
  readonly breathOut = new ChannelBuffer('breath', 200 * TRACE_HISTORY_S);
  readonly ecgOut = new ChannelBuffer('ecg', 1000 * TRACE_HISTORY_S);
  /** Unfiltered ECG in mV on the same time axis, for the quality check and the raw view. */
  readonly ecgRawMv = new ChannelBuffer('ecg_raw', 1000 * TRACE_HISTORY_S);

  listenSink: ListenSink | null = null;

  private generation = -1;
  private acoSeen = 0;
  private ecgSeen = 0;
  private acoLastT: number | null = null;
  private ecgLastT: number | null = null;

  constructor(
    private buffers: LiveBuffers,
    private configuredRates: () => Partial<Record<P.RateSensor, number>>,
    settings: Settings = DEFAULT_SETTINGS,
  ) {
    this.heartFilter = new StreamingFilter(heartSpec(settings));
    this.listenFilter = new StreamingFilter(listenSpec(settings));
    this.breathFilter = new StreamingFilter(breathSpec(settings));
    this.ecgFilter = new StreamingFilter(ecgSpec(settings));
  }

  /** Apply new filter settings. Only filters whose design changed restart. */
  configure(s: Settings): void {
    const same = (a: FilterSpec, b: FilterSpec) =>
      a.kind === b.kind && a.order === b.order && a.lowHz === b.lowHz && a.highHz === b.highHz;
    const swap = (f: StreamingFilter, spec: FilterSpec) => (same(f.spec, spec) ? f : new StreamingFilter(spec));
    const heart = swap(this.heartFilter, heartSpec(s));
    const breath = swap(this.breathFilter, breathSpec(s));
    const ecg = swap(this.ecgFilter, ecgSpec(s));
    if (heart !== this.heartFilter || breath !== this.breathFilter) {
      this.heartOut.clear();
      this.breathOut.clear();
      this.decimator.reset();
    }
    if (ecg !== this.ecgFilter) this.ecgOut.clear();
    this.heartFilter = heart;
    this.breathFilter = breath;
    this.ecgFilter = ecg;
    this.listenFilter = swap(this.listenFilter, listenSpec(s));
  }

  describeFilters(): { heart: string; ecg: string; breath: string } {
    return {
      heart: this.heartFilter.spec.describe(),
      ecg: this.ecgFilter.spec.describe(),
      breath: this.breathFilter.spec.describe(),
    };
  }

  private reset(): void {
    this.heartFilter.reset();
    this.listenFilter.reset();
    this.breathFilter.reset();
    this.ecgFilter.reset();
    this.decimator.reset();
    this.heartOut.clear();
    this.breathOut.clear();
    this.ecgOut.clear();
    this.ecgRawMv.clear();
    this.acoSeen = this.ecgSeen = 0;
    this.acoLastT = this.ecgLastT = null;
  }

  private takeNew(buffer: ChannelBuffer, seen: number): [Float64Array, Float64Array, number] {
    const total = buffer.totalSamples;
    const n = Math.min(Math.max(0, total - seen), buffer.length);
    const [t, v] = buffer.latest(n);
    return [t, v, total];
  }

  rate(sensor: P.RateSensor): number {
    const buffer = sensor === 'ACO' ? this.buffers.channels[P.CHANNEL_ACOUSTIC] : this.buffers.channels[P.CHANNEL_ECG];
    return buffer.timestampRateHz(5) || this.configuredRates()[sensor] || 0;
  }

  /** Pull new raw samples through the filters. Call once per frame. */
  update(): void {
    if (this.buffers.generation !== this.generation) {
      this.generation = this.buffers.generation;
      this.reset();
    }

    const aco = this.buffers.channels[P.CHANNEL_ACOUSTIC];
    const [at, av, aTotal] = this.takeNew(aco, this.acoSeen);
    this.acoSeen = aTotal;
    if (at.length) {
      if (hasGap(this.acoLastT, at)) {
        this.heartFilter.reset();
        this.listenFilter.reset();
        this.breathFilter.reset();
        this.decimator.reset();
      }
      this.acoLastT = at[at.length - 1];
      const fs = this.rate('ACO');
      const heart = this.heartFilter.process(av, fs);
      this.heartOut.addSeconds(at, heart);
      if (this.listenSink) this.listenSink(this.listenFilter.process(av, fs), fs);
      const [et, env] = this.decimator.process(at, heart.map(Math.abs), fs);
      if (et.length) {
        this.breathOut.addSeconds(et, this.breathFilter.process(env, this.decimator.outputRate(fs)));
      }
    }

    const ecg = this.buffers.channels[P.CHANNEL_ECG];
    const [mt, mv, mTotal] = this.takeNew(ecg, this.ecgSeen);
    this.ecgSeen = mTotal;
    if (mt.length) {
      if (hasGap(this.ecgLastT, mt)) this.ecgFilter.reset();
      this.ecgLastT = mt[mt.length - 1];
      const mV = mv.map((c) => c * P.ECG_COUNTS_TO_MV);
      this.ecgRawMv.addSeconds(mt, mV);
      this.ecgOut.addSeconds(mt, this.ecgFilter.process(mV, this.rate('ECG')));
    }
  }

  /** Estimation uses the rate the timestamps imply, not the requested rate. */
  vitals(): Vitals {
    const rates = this.configuredRates();
    const ecgBuf = this.buffers.channels[P.CHANNEL_ECG];
    const acoBuf = this.buffers.channels[P.CHANNEL_ACOUSTIC];
    const ecgFs = ecgBuf.timestampRateHz(VITALS_WINDOW_S) || rates.ECG || 0;
    const acoFs = acoBuf.timestampRateHz(VITALS_WINDOW_S) || rates.ACO || 0;

    const [, ecgValues] = ecgBuf.snapshot(VITALS_WINDOW_S);
    const heartRate = ecgValues.length ? estimateHeartRate(ecgValues, ecgFs) : null;

    const [, breath] = this.breathOut.snapshot(30);
    const breathFs = acoFs ? this.decimator.outputRate(acoFs) : 0;
    const breathingRate = estimateRateFromWave(breath, breathFs, RR_MIN_BPM, RR_MAX_BPM, 12);

    return {
      heartRate,
      breathingRate,
      skinTempC: this.buffers.channels[P.CHANNEL_TEMP].latestValue(),
      batteryV: this.buffers.channels[P.CHANNEL_BATT].latestValue(),
    };
  }
}
