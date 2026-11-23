import * as P from '../src/protocol/protocol';
import { FlashSample } from '../src/protocol/flashlog';
import { OfflineAnalyzer } from '../src/analysis/offline';
import { DEFAULT_SETTINGS } from '../src/settings/settings';

/** A synthetic 90 s download: clean ECG at 72 bpm, heart sounds, and walking. */
function* download(startEpochUs: number): Generator<FlashSample> {
  const seconds = 90;
  const period = 60 / 72;
  let k = 0;
  const noise = () => {
    k = (k * 1103515245 + 12345) % 2147483648;
    return k / 2147483648 - 0.5;
  };
  // Interleave channels in 10 ms steps, as the patch writes pages.
  for (let ms = 0; ms < seconds * 1000; ms += 10) {
    const t0 = ms / 1000;
    for (let i = 0; i < 20; i++) {
      const t = t0 + i / 2000;
      const ph = t % period;
      let v = 0;
      for (const [c, a, f] of [[0.05, 20000, 50], [0.35, 12000, 60]]) {
        const d = ph - c;
        if (Math.abs(d) < 0.06) v += a * Math.exp(-((d / 0.02) ** 2)) * Math.sin(2 * Math.PI * f * d);
      }
      yield { channel: P.CHANNEL_ACOUSTIC, timestampUs: 0, values: [Math.round(v + 300 * noise())], epochUs: startEpochUs + t * 1e6 };
    }
    for (let i = 0; i < 2.5; i++) {
      const t = t0 + i / 250;
      if (i === 2 && ms % 20 !== 0) continue;
      const p = (t % period) / period;
      const g = (c: number, w: number, a: number) => a * Math.exp(-(((p - c) / w) ** 2));
      const mv = g(0.12, 0.03, 0.1) + g(0.22, 0.01, 1) + g(0.245, 0.01, -0.25) + g(0.48, 0.05, 0.25) + 0.01 * noise();
      yield { channel: P.CHANNEL_ECG, timestampUs: 0, values: [Math.round(mv / P.ECG_COUNTS_TO_MV)], epochUs: startEpochUs + t * 1e6 };
    }
    // IMU at 100 Hz, walking from 30 s to 90 s (raw units are mm/s^2).
    const walking = t0 >= 30 ? 0.2 * Math.sin(2 * Math.PI * 1.8 * t0) : 0;
    const ay = (-1 - walking) / P.IMU_ACCEL_RAW_TO_G;
    yield { channel: P.CHANNEL_IMU, timestampUs: 0, values: [0, Math.round(ay), 0, 0, 0, 0], epochUs: startEpochUs + t0 * 1e6 };
  }
}

test('a download becomes per-minute history with heart rate and steps', () => {
  const start = Date.UTC(2026, 10, 22, 21, 0, 0) * 1000;
  const a = new OfflineAnalyzer(DEFAULT_SETTINGS, P.DEFAULT_RATES_HZ);
  for (const s of download(start)) a.push(s);
  const r = a.finish();
  expect(r.firstEpochMs).toBe(start / 1000);
  expect(r.rows.length).toBe(2);
  const hrN = r.rows.reduce((s, x) => s + x.hrN, 0);
  expect(hrN).toBeGreaterThanOrEqual(5);
  for (const row of r.rows) {
    if (row.hrN) {
      expect(row.hrSum / row.hrN).toBeGreaterThan(69);
      expect(row.hrSum / row.hrN).toBeLessThan(75);
    }
  }
  const steps = r.rows.reduce((s, x) => s + x.steps, 0);
  expect(steps).toBeGreaterThan(95); // ~60 s at 1.8 steps/s
  expect(steps).toBeLessThan(112);
  expect(r.falls).toHaveLength(0);
});

test('samples without a clock are skipped, not misplaced', () => {
  const a = new OfflineAnalyzer(DEFAULT_SETTINGS, P.DEFAULT_RATES_HZ);
  a.push({ channel: P.CHANNEL_ECG, timestampUs: 5, values: [1], epochUs: null });
  const r = a.finish();
  expect(r.skipped).toBe(1);
  expect(r.rows).toHaveLength(0);
});
