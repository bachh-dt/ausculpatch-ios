import { analyzeCardiac, filtfilt } from '../src/dsp/cardiac';
import { butterSos } from '../src/dsp/signal';
import { DEFAULT_SETTINGS } from '../src/settings/settings';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32 - 0.5;
  };
}

const RR = 0.8; // 75 bpm
const R0 = 0.3;
const S1 = 0.06, S2 = 0.36, AO = 0.08, AC = 0.37;

function series(seconds: number, fs: number, f: (phase: number) => number, noise: number, seed: number) {
  const n = Math.round(seconds * fs);
  const r = rng(seed);
  const t = new Float64Array(n), v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    t[i] = i / fs;
    const ph = (((t[i] - R0) % RR) + RR) % RR; // time since the last R
    v[i] = f(ph) + noise * r();
  }
  return { t, v, fs };
}

const g = (x: number, c: number, w: number) => Math.exp(-(((x - c) / w) ** 2));

function make(seconds = 30) {
  const ecg = series(seconds, 250, (p) => g(p, 0, 0.01) + g(p, RR, 0.01) + 0.25 * g(p, 0.25, 0.04), 0.02, 1);
  const pcg = series(
    seconds,
    2000,
    (p) => 20000 * g(p, S1, 0.015) * Math.sin(2 * Math.PI * 50 * (p - S1)) + 14000 * g(p, S2, 0.012) * Math.sin(2 * Math.PI * 60 * (p - S2)),
    600,
    2,
  );
  const z = series(seconds, 500, (p) => -1 + 0.01 * g(p, AO, 0.015) + 0.006 * g(p, AC, 0.015), 0.002, 3);
  const x = series(seconds, 500, () => 0, 0.002, 4);
  const y = series(seconds, 500, () => 0, 0.002, 5);
  return { ecg, pcg, scg: { t: z.t, x: x.v, y: y.v, z: z.v, fs: 500 } };
}

test('filtfilt has no phase delay', () => {
  const fs = 500;
  const x = Float64Array.from({ length: 2000 }, (_, i) => g(i / fs, 2, 0.02));
  const y = filtfilt(butterSos(2, [1, 30], 'bandpass', fs), x, fs);
  let k = 0;
  for (let i = 0; i < y.length; i++) if (y[i] > y[k]) k = i;
  expect(Math.abs(k / fs - 2)).toBeLessThan(0.003);
});

test('recovers R-S1, R-S2, R-AO and AO-AC from synthetic beats', () => {
  const d = make();
  const res = analyzeCardiac({
    ecg: d.ecg,
    pcg: d.pcg,
    scg: d.scg,
    ecgBand: DEFAULT_SETTINGS.ecgBand,
    pcgBand: DEFAULT_SETTINGS.heartBand,
    axis: 'auto',
  });
  expect(res.beatsFound).toBeGreaterThanOrEqual(36);
  expect(res.rrMs).toBeCloseTo(800, -1);
  expect(res.hrv?.meanHr).toBeCloseTo(75, 0);
  expect(res.scgAxis).toBe('z');
  const iv = res.intervals;
  expect(Math.abs((iv.rS1?.ms ?? 0) - 60)).toBeLessThan(8);
  expect(Math.abs((iv.rS2?.ms ?? 0) - 360)).toBeLessThan(8);
  expect(Math.abs((iv.rAO?.ms ?? 0) - 80)).toBeLessThan(8);
  expect(Math.abs((iv.aoAC?.ms ?? 0) - 290)).toBeLessThan(12);
  expect(iv.pepLvet).toBeCloseTo(80 / 290, 1);
  expect(res.ensemble?.marks.s1).not.toBeNull();
  expect(res.overlay?.r.length).toBeGreaterThanOrEqual(5);
});

test('too little ECG gives a note, not numbers', () => {
  const d = make(3);
  const res = analyzeCardiac({ ecg: d.ecg, pcg: null, scg: null, ecgBand: DEFAULT_SETTINGS.ecgBand, pcgBand: DEFAULT_SETTINGS.heartBand, axis: 'auto' });
  expect(res.intervals.rS1).toBeNull();
  expect(res.notes.length).toBeGreaterThan(0);
});
