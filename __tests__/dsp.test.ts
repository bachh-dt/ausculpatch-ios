import { StreamingFilter } from '../src/dsp/filters';
import { ecgQuality, heartSoundQuality, PoorContactTimer } from '../src/dsp/quality';
import { FallDetector, StepCounter } from '../src/dsp/motion';
import { breathSpec, DEFAULT_SETTINGS, ecgSpec, heartSpec, mergeSettings } from '../src/settings/settings';

// Deterministic noise so the tests never flake.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
function gauss(r: () => number) {
  const u = Math.max(1e-12, r());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

const ECG_FS = 250;
const ACO_FS = 2000;

/** ECG-like trace in mV: P, QRS, T at `bpm`. */
function ecg(seconds: number, bpm: number, noiseMv: number, seed = 1): Float64Array {
  const r = rng(seed);
  const n = seconds * ECG_FS;
  const out = new Float64Array(n);
  const period = 60 / bpm;
  for (let i = 0; i < n; i++) {
    const ph = ((i / ECG_FS) % period) / period;
    const g = (c: number, w: number, a: number) => a * Math.exp(-(((ph - c) / w) ** 2));
    out[i] = g(0.12, 0.03, 0.1) + g(0.2, 0.008, -0.1) + g(0.22, 0.01, 1.0) + g(0.245, 0.01, -0.25) + g(0.48, 0.05, 0.25) + noiseMv * gauss(r);
  }
  return out;
}

/** Heart-sound-like bursts (S1, S2) in counts. */
function pcg(seconds: number, bpm: number, noise: number, seed = 2): Float64Array {
  const r = rng(seed);
  const n = seconds * ACO_FS;
  const out = new Float64Array(n);
  const period = 60 / bpm;
  for (let i = 0; i < n; i++) {
    const t = i / ACO_FS;
    const ph = t % period;
    let v = 0;
    for (const [c, a, f] of [[0.05, 20000, 50], [0.35, 12000, 60]]) {
      const d = ph - c;
      if (Math.abs(d) < 0.06) v += a * Math.exp(-((d / 0.02) ** 2)) * Math.sin(2 * Math.PI * f * d);
    }
    out[i] = v + noise * gauss(r);
  }
  return out;
}

function filt(x: Float64Array, spec = heartSpec(DEFAULT_SETTINGS), fs = ACO_FS) {
  return new StreamingFilter(spec).process(x, fs);
}

describe('settings', () => {
  test('defaults match the requested filters', () => {
    expect(DEFAULT_SETTINGS.heartBand).toEqual({ lowHz: 25, highHz: 80, order: 4 });
    expect(DEFAULT_SETTINGS.ecgBand).toEqual({ lowHz: 1, highHz: 40, order: 2 });
    expect(DEFAULT_SETTINGS.breathCutHz).toBe(0.5);
    expect(DEFAULT_SETTINGS.breathLowHz).toBe(0.1);
    expect(breathSpec(DEFAULT_SETTINGS).kind).toBe('bandpass');
    expect(breathSpec({ ...DEFAULT_SETTINGS, breathLowHz: 0 }).kind).toBe('lowpass');
    expect(DEFAULT_SETTINGS.breathOrder).toBe(2);
  });
  test('merge keeps good values and drops bad ones', () => {
    const s = mergeSettings({ windowS: 30, heartBand: { lowHz: 90, highHz: 20, order: 4 }, stepGoal: 'x', traceFps: 7 });
    expect(s.windowS).toBe(30);
    expect(s.heartBand).toEqual(DEFAULT_SETTINGS.heartBand);
    expect(s.stepGoal).toBe(DEFAULT_SETTINGS.stepGoal);
    expect(s.traceFps).toBe(30);
  });
});

describe('ECG quality', () => {
  const spec = ecgSpec(DEFAULT_SETTINGS);
  const run = (raw: Float64Array) => ecgQuality(raw, filt(raw, spec, ECG_FS).subarray(ECG_FS), ECG_FS);

  test('clean ECG is good and finds every beat', () => {
    const q = run(ecg(10, 72, 0.01));
    expect(q.level).toBe('good');
    expect(q.beats.length).toBeGreaterThanOrEqual(9);
  });
  test('flat line means no contact', () => {
    expect(run(new Float64Array(10 * ECG_FS)).level).toBe('none');
  });
  test('noise alone is poor', () => {
    const r = rng(5);
    const noise = Float64Array.from({ length: 10 * ECG_FS }, () => 0.3 * gauss(r));
    expect(run(noise).level).toBe('poor');
  });
  test('too little data is unknown', () => {
    expect(run(ecg(3, 72, 0.01)).level).toBe('unknown');
  });
});

describe('heart sound quality', () => {
  test('clear heart sounds are good', () => {
    const raw = pcg(10, 70, 300);
    const q = heartSoundQuality(raw, filt(raw), ACO_FS);
    expect(q.level).toBe('good');
  });
  test('broadband rubbing noise is poor', () => {
    const r = rng(9);
    const raw = Float64Array.from({ length: 10 * ACO_FS }, () => 8000 * gauss(r));
    expect(heartSoundQuality(raw, filt(raw), ACO_FS).level).toBe('poor');
  });
  test('a clipped sensor has no usable signal', () => {
    const raw = new Float64Array(10 * ACO_FS).fill(2 ** 23);
    expect(heartSoundQuality(raw, filt(raw), ACO_FS).level).toBe('none');
  });
});

describe('poor contact timer', () => {
  test('waits for the delay and clears at once', () => {
    const t = new PoorContactTimer(10);
    expect(t.update(true, 0)).toBe(false);
    expect(t.update(true, 9)).toBe(false);
    expect(t.update(true, 10)).toBe(true);
    expect(t.update(false, 11)).toBe(false);
    expect(t.update(true, 12)).toBe(false);
  });
});

const IMU_FS = 100;

function imu(seconds: number, f: (t: number) => [number, number, number], seed = 3) {
  const r = rng(seed);
  const n = seconds * IMU_FS;
  const t = new Float64Array(n), x = new Float64Array(n), y = new Float64Array(n), z = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    t[i] = i / IMU_FS;
    const [a, b, c] = f(t[i]);
    x[i] = a + 0.01 * gauss(r);
    y[i] = b + 0.01 * gauss(r);
    z[i] = c + 0.01 * gauss(r);
  }
  return { t, x, y, z };
}

describe('step counter', () => {
  test('counts walking at 1.8 steps per second', () => {
    const d = imu(61, (t) => [0, -1 - 0.2 * Math.sin(2 * Math.PI * 1.8 * t), 0.05 * Math.sin(2 * Math.PI * 0.9 * t)]);
    const sc = new StepCounter();
    // Feed in BLE-sized chunks to exercise the streaming state.
    for (let i = 0; i < d.t.length; i += 37) {
      const j = Math.min(d.t.length, i + 37);
      sc.process(d.t.subarray(i, j), d.x.subarray(i, j), d.y.subarray(i, j), d.z.subarray(i, j), IMU_FS);
    }
    expect(sc.total).toBeGreaterThan(100);
    expect(sc.total).toBeLessThan(112);
  });
  test('sitting still counts nothing', () => {
    const d = imu(60, () => [0, -1, 0]);
    const sc = new StepCounter();
    sc.process(d.t, d.x, d.y, d.z, IMU_FS);
    expect(sc.total).toBe(0);
  });
  test('two isolated bumps do not count', () => {
    const d = imu(20, (t) => [0, -1 - (Math.abs(t - 5) < 0.1 || Math.abs(t - 12) < 0.1 ? 0.4 : 0), 0]);
    const sc = new StepCounter();
    sc.process(d.t, d.x, d.y, d.z, IMU_FS);
    expect(sc.total).toBe(0);
  });
});

describe('fall detector', () => {
  const impact = (t: number, at: number) => (Math.abs(t - at) < 0.03 ? 3.5 : 0);

  test('impact then lying still at a new angle is a fall', () => {
    const d = imu(20, (t) => (t < 8 ? [0, -1 - impact(t, 8), 0] : [0, -impact(t, 8), 1]));
    const fd = new FallDetector('normal');
    const ev = fd.process(d.t, d.x, d.y, d.z, IMU_FS);
    expect(ev).toHaveLength(1);
    expect(ev[0].angleDeg).toBeGreaterThan(80);
  });
  test('a jump that lands upright is not a fall', () => {
    const d = imu(20, (t) => [0, -1 - impact(t, 8), 0]);
    expect(new FallDetector('normal').process(d.t, d.x, d.y, d.z, IMU_FS)).toHaveLength(0);
  });
  test('lying down gently is not a fall', () => {
    const d = imu(20, (t) => {
      const k = Math.min(1, Math.max(0, (t - 8) / 2));
      return [0, -Math.cos((k * Math.PI) / 2), Math.sin((k * Math.PI) / 2)];
    });
    expect(new FallDetector('normal').process(d.t, d.x, d.y, d.z, IMU_FS)).toHaveLength(0);
  });
  test('low sensitivity ignores a 1.6 g impact that high sensitivity catches', () => {
    const hit = (t: number) => (Math.abs(t - 8) < 0.03 ? 0.6 : 0); // 1 g of gravity + 0.6 g = 1.6 g
    const d = imu(20, (t) => (t < 8 ? [0, -1 - hit(t), 0] : [0, 0, 1 + hit(t)]));
    expect(new FallDetector('low').process(d.t, d.x, d.y, d.z, IMU_FS)).toHaveLength(0);
    expect(new FallDetector('high').process(d.t, d.x, d.y, d.z, IMU_FS)).toHaveLength(1);
  });
  test('normal catches a 2 g impact onto the back even if the person moves afterwards', () => {
    const d = imu(20, (t) => (t < 8 ? [0, -1 - (Math.abs(t - 8) < 0.03 ? 1 : 0), 0] : [0.3 * Math.sin(6 * t), 0, 1]));
    const fd = new FallDetector('normal');
    expect(fd.process(d.t, d.x, d.y, d.z, IMU_FS)).toHaveLength(1);
    expect(fd.lastCheck?.fall).toBe(true);
  });
  test('a free fall lowers the impact needed', () => {
    const at = (t: number): [number, number, number] => {
      if (t > 7.8 && t < 7.97) return [0, -0.2, 0]; // falling
      if (Math.abs(t - 8) < 0.03) return [0, -1.5, 0]; // 1.5 g, under the normal 1.8 g
      return t < 8 ? [0, -1, 0] : [0, 0, 1];
    };
    const d = imu(20, at);
    const fd = new FallDetector('normal');
    expect(fd.process(d.t, d.x, d.y, d.z, IMU_FS)).toHaveLength(1);
    expect(fd.lastCheck?.freeFall).toBe(true);
  });
  test('sitting down hard but upright is not a fall, and says why', () => {
    const d = imu(20, (t) => [0, -1 - (Math.abs(t - 8) < 0.03 ? 1.2 : 0), 0]);
    const fd = new FallDetector('high');
    expect(fd.process(d.t, d.x, d.y, d.z, IMU_FS)).toHaveLength(0);
    expect(fd.lastCheck?.reason).toMatch(/angle/);
  });
});
