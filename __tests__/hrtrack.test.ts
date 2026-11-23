import { HeartRateTracker } from '../src/dsp/hrtrack';
import { MinuteVitals } from '../src/history/minuteVitals';

/** Beat times at a steady rate, with a little natural jitter. */
function beats(start: number, seconds: number, bpm: number): number[] {
  const out: number[] = [];
  const rr = 60 / bpm;
  for (let t = start, k = 0; t < start + seconds; t += rr * (1 + 0.02 * Math.sin(k++))) out.push(t);
  return out;
}

/** Feed beats the way the app does: overlapping 8 s windows every second. */
function feed(tr: HeartRateTracker, all: number[], good = (t: number) => true) {
  const accepted: { t: number; rr: number }[] = [];
  const end = all[all.length - 1];
  for (let w = all[0]; w <= end + 1; w += 1) {
    const inWin = all.filter((b) => b >= w - 8 && b < w);
    accepted.push(...tr.addBeats(inWin, good(w)));
  }
  return accepted;
}

describe('heart rate tracker', () => {
  test('steady 72 bpm reads 72 and repeats in overlapping windows are ignored', () => {
    const tr = new HeartRateTracker();
    const b = beats(0, 60, 72);
    const acc = feed(tr, b);
    expect(acc.length).toBe(b.length - 1);
    expect(tr.liveHr(60)).toBeCloseTo(72, 0);
  });

  test('a missed beat (which would read about 36 bpm) is rejected', () => {
    const tr = new HeartRateTracker();
    const b = beats(0, 60, 72).filter((_, i) => i !== 30);
    const acc = feed(tr, b);
    expect(acc.every((a) => a.rr < 1.2)).toBe(true);
    expect(tr.rejected).toBe(1);
    expect(tr.liveHr(60)).toBeCloseTo(72, 0);
  });

  test('T waves counted as beats (which would read far too high) are rejected', () => {
    const tr = new HeartRateTracker();
    const b = beats(0, 60, 72);
    const withT = [...b, ...b.slice(20, 25).map((x) => x + 0.3)].sort((x, y) => x - y);
    const acc = feed(tr, withT);
    expect(tr.liveHr(60)).toBeCloseTo(72, 0);
    // The true intervals around the extra peaks are still measured.
    expect(acc.length).toBeGreaterThanOrEqual(b.length - 3);
    expect(acc.every((a) => a.rr > 0.7 && a.rr < 0.95)).toBe(true);
  });

  test('a real change from 70 to 110 bpm is followed within a few beats', () => {
    const tr = new HeartRateTracker();
    const b = [...beats(0, 30, 70), ...beats(30.5, 30, 110)];
    feed(tr, b);
    expect(tr.liveHr(60.5)).toBeCloseTo(110, -1);
  });

  test('no heart rate across a stretch of poor signal', () => {
    const tr = new HeartRateTracker();
    const b = beats(0, 60, 72);
    const acc = feed(tr, b, (w) => w < 20 || w > 40);
    // No accepted interval should start in the bad stretch.
    expect(acc.some((a) => a.t - a.rr > 21 && a.t < 39)).toBe(false);
  });
});

describe('per-minute vitals', () => {
  const t0 = Date.UTC(2026, 10, 23, 10, 0, 0);

  test('a fully covered minute stores its mean and 15 s range', () => {
    const mv = new MinuteVitals();
    let ms = t0;
    while (ms < t0 + 60000) {
      const bpm = ms < t0 + 30000 ? 66 : 78;
      const rr = 60 / bpm;
      ms += rr * 1000;
      if (ms < t0 + 60000) mv.addBeat(ms, rr);
    }
    const [row] = mv.drain();
    expect(row.hrN).toBe(1);
    expect(row.hrSum).toBeGreaterThan(70);
    expect(row.hrSum).toBeLessThan(74);
    expect(row.hrMin).toBeCloseTo(66, 0);
    expect(row.hrMax).toBeCloseTo(78, 0);
  });

  test('a minute with only 20 s of good beats gets no heart rate', () => {
    const mv = new MinuteVitals();
    for (let k = 1; k <= 24; k++) mv.addBeat(t0 + k * 833, 0.833);
    expect(mv.drain()).toHaveLength(0);
  });

  test('breathing needs 10 estimates and stores the median', () => {
    const mv = new MinuteVitals();
    [14, 15, 15, 16, 15, 14, 15, 16, 15, 40].forEach((v, i) => mv.addBreath(t0 + i * 5000, v));
    const [row] = mv.drain();
    expect(row.brSum).toBe(15);
    expect(row.brMax).toBeLessThanOrEqual(16);
  });

  test('the current minute is held back until it is over', () => {
    const mv = new MinuteVitals();
    for (let k = 1; k <= 70; k++) mv.addBeat(t0 + k * 850, 0.85);
    expect(mv.drain(t0 + 59000)).toHaveLength(0);
    expect(mv.drain(t0 + 61000)).toHaveLength(1);
  });
});
