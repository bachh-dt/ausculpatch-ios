/**
 * The monitor's filtered traces and vital signs. Port of ClinicalTraces and
 * MainWindow._refresh_vitals in host/ausculpatch/apps/clinical.py.
 *
 *   heart sound = acoustic counts -> 20-100 Hz band-pass, order 4
 *   breathing   = |heart sound| -> averaged to ~50 Hz -> 0.5 Hz low-pass, order 2
 *   ECG         = counts x (2 x 2.42 V / 12) / 2^24 -> 0.1-40 Hz band-pass, order 2
 */
import * as P from '../protocol/protocol';
import { BlockMeanDecimator, BREATHING_FILTER, ECG_FILTER, HEART_SOUND_FILTER, hasGap, StreamingFilter } from '../dsp/filters';
import { estimateHeartRate, estimateRateFromWave, RR_MAX_BPM, RR_MIN_BPM } from '../dsp/vitals';
import { ChannelBuffer, LiveBuffers } from './buffers';

export const VITALS_WINDOW_S = 20;
export const TRACE_HISTORY_S = 30;

export interface Vitals {
  heartRate: number | null;
  breathingRate: number | null;
  skinTempC: number | null;
  batteryV: number | null;
}

export class ClinicalPipeline {
  private heartFilter = new StreamingFilter(HEART_SOUND_FILTER);
  private breathFilter = new StreamingFilter(BREATHING_FILTER);
  private ecgFilter = new StreamingFilter(ECG_FILTER);
  readonly decimator = new BlockMeanDecimator(50);

  readonly heartOut = new ChannelBuffer('heart', 4000 * TRACE_HISTORY_S);
  readonly breathOut = new ChannelBuffer('breath', 200 * TRACE_HISTORY_S);
  readonly ecgOut = new ChannelBuffer('ecg', 1000 * TRACE_HISTORY_S);

  private generation = -1;
  private acoSeen = 0;
  private ecgSeen = 0;
  private acoLastT: number | null = null;
  private ecgLastT: number | null = null;

  constructor(
    private buffers: LiveBuffers,
    private configuredRates: () => Partial<Record<P.RateSensor, number>>,
  ) {}

  private reset(): void {
    this.heartFilter.reset();
    this.breathFilter.reset();
    this.ecgFilter.reset();
    this.decimator.reset();
    this.heartOut.clear();
    this.breathOut.clear();
    this.ecgOut.clear();
    this.acoSeen = this.ecgSeen = 0;
    this.acoLastT = this.ecgLastT = null;
  }

  private takeNew(buffer: ChannelBuffer, seen: number): [Float64Array, Float64Array, number] {
    const total = buffer.totalSamples;
    const n = Math.min(Math.max(0, total - seen), buffer.length);
    const [t, v] = buffer.latest(n);
    return [t, v, total];
  }

  private rate(buffer: ChannelBuffer, sensor: P.RateSensor): number {
    return buffer.timestampRateHz(5) || this.configuredRates()[sensor] || 0;
  }

  /** Pull new raw samples through the filters. Call at the redraw rate. */
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
        this.breathFilter.reset();
        this.decimator.reset();
      }
      this.acoLastT = at[at.length - 1];
      const fs = this.rate(aco, 'ACO');
      const heart = this.heartFilter.process(av, fs);
      this.heartOut.addSeconds(at, heart);
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
      this.ecgOut.addSeconds(mt, this.ecgFilter.process(mV, this.rate(ecg, 'ECG')));
    }
  }

  /** The four numbers. Estimation uses the rate the timestamps imply, not the requested rate. */
  vitals(): Vitals {
    const rates = this.configuredRates();
    const ecgBuf = this.buffers.channels[P.CHANNEL_ECG];
    const acoBuf = this.buffers.channels[P.CHANNEL_ACOUSTIC];
    const ecgFs = ecgBuf.timestampRateHz(VITALS_WINDOW_S) || rates.ECG || 0;
    const acoFs = acoBuf.timestampRateHz(VITALS_WINDOW_S) || rates.ACO || 0;

    const [, ecgValues] = ecgBuf.snapshot(VITALS_WINDOW_S);
    const heartRate = ecgValues.length ? estimateHeartRate(ecgValues, ecgFs) : null;

    const [, breath] = this.breathOut.snapshot(TRACE_HISTORY_S);
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
