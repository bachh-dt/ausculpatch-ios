/**
 * Heart-rate and breathing-rate estimation. Port of host/ausculpatch/vitals.py.
 * Every estimator returns null rather than a number it cannot back up.
 */
import { butterSos, detrend, findPeaks, hanning, mean, median, powerSpectrum, Sos, sosfilt, std } from './signal';

export const HR_MIN_BPM = 30;
export const HR_MAX_BPM = 220;
export const RR_MIN_BPM = 4;
export const RR_MAX_BPM = 45;
export const ECG_BAND_HZ: [number, number] = [0.5, 40];
export const MAX_INTERVAL_SPREAD = 0.12;

export function designBandpass(band: [number, number], fs: number, order = 2): Sos | null {
  const nyq = fs / 2;
  const low = band[0];
  const high = Math.min(band[1], nyq * 0.95);
  if (low >= high || low <= 0) return null;
  return butterSos(order, [low, high], 'bandpass', fs);
}

function rateFromIntervals(intervals: number[], fs: number): number | null {
  if (!intervals.length) return null;
  const med = median(intervals);
  if (med <= 0) return null;
  const spread = median(intervals.map((v) => Math.abs(v - med))) / med;
  if (spread > MAX_INTERVAL_SPREAD) return null;
  return (60 * fs) / med;
}

/** Heart rate in bpm from raw ECG counts, or null. */
export function estimateHeartRate(ecg: ArrayLike<number>, fs: number): number | null {
  if (fs <= 0 || ecg.length < Math.floor(fs * 2)) return null;
  const m = median(ecg);
  const data = Float64Array.from(ecg as ArrayLike<number>, (v) => v - m);
  const sos = designBandpass(ECG_BAND_HZ, fs);
  const filtered = sos ? sosfilt(sos, data) : data;
  const minDistance = Math.max(Math.floor((fs * 60) / HR_MAX_BPM), 1);
  const threshold = mean(filtered) + 1.5 * std(filtered);
  const peaks = findPeaks(filtered, threshold, minDistance);
  if (peaks.length < 3) return null;
  const intervals: number[] = [];
  for (let i = 1; i < peaks.length; i++) intervals.push(peaks[i] - peaks[i - 1]);
  const bpm = rateFromIntervals(intervals, fs);
  if (bpm === null) return null;
  return bpm >= HR_MIN_BPM && bpm <= HR_MAX_BPM ? bpm : null;
}

/** Dominant rate of a slow, already-filtered wave (the breathing trace), spectrally. */
export function estimateRateFromWave(
  samples: ArrayLike<number>,
  fs: number,
  minBpm: number,
  maxBpm: number,
  minSeconds = 10,
): number | null {
  if (fs <= 0 || samples.length < Math.floor(fs * minSeconds)) return null;
  const data = detrend(samples);
  if (!data.some((v) => v !== 0)) return null;

  const nfft = Math.max(8192, 1 << Math.ceil(Math.log2(data.length * 4)));
  const w = hanning(data.length);
  const windowed = data.map((v, i) => v * w[i]);
  const spectrum = powerSpectrum(windowed, nfft);

  const lo = minBpm / 60;
  const hi = maxBpm / 60;
  const bandPower: number[] = [];
  const bandFreqs: number[] = [];
  for (let k = 0; k < spectrum.length; k++) {
    const f = (k * fs) / nfft;
    if (f >= lo && f <= hi) {
      bandPower.push(spectrum[k]);
      bandFreqs.push(f);
    }
  }
  if (!bandPower.length) return null;
  let peak = 0;
  for (let k = 1; k < bandPower.length; k++) if (bandPower[k] > bandPower[peak]) peak = k;
  if (bandPower[peak] < 6 * median(bandPower)) return null;
  const peakHz = bandFreqs[peak];
  if ((peakHz * data.length) / fs < 3) return null;
  const rate = 60 * peakHz;
  return rate >= minBpm && rate <= maxBpm ? rate : null;
}
