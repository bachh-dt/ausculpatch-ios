import { binEdges, binRows, MinuteAccumulator, mergeRows, minuteOf } from '../src/history/aggregate';

describe('minute accumulator', () => {
  test('aggregates readings and steps per minute', () => {
    const acc = new MinuteAccumulator();
    const t0 = new Date(2026, 10, 23, 10, 0, 5).getTime();
    acc.addVitals(t0, 70, 15);
    acc.addVitals(t0 + 20000, 80, null);
    acc.addSteps(t0 + 30000, 12);
    acc.addVitals(t0 + 65000, 90, 18);
    const first = acc.drain(t0 + 61000);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ hrMin: 70, hrMax: 80, hrSum: 150, hrN: 2, brMin: 15, brN: 1, steps: 12 });
    expect(acc.pending()).toHaveLength(1);
    expect(acc.drain()).toHaveLength(1);
  });

  test('merging two rows of the same minute keeps extremes and sums', () => {
    const acc = new MinuteAccumulator();
    const t = Date.UTC(2026, 0, 1);
    acc.addVitals(t, 60, null);
    const a = acc.drain()[0];
    acc.addVitals(t, 100, 20);
    acc.addSteps(t, 5);
    const b = acc.drain()[0];
    expect(mergeRows(a, b)).toMatchObject({ minute: minuteOf(t), hrMin: 60, hrMax: 100, hrN: 2, brMin: 20, steps: 5 });
  });
});

describe('binning', () => {
  const now = new Date(2026, 10, 25, 14, 30); // Wednesday 25 Nov 2026

  test('edges for day, week and month', () => {
    expect(binEdges('day', now)).toHaveLength(8);
    const week = binEdges('week', now);
    expect(week).toHaveLength(7);
    expect(new Date(week[0].start).getDate()).toBe(23); // Monday
    expect(binEdges('month', now)).toHaveLength(30);
  });

  test('rows land in the right bins and later bins are marked future', () => {
    const acc = new MinuteAccumulator();
    acc.addVitals(new Date(2026, 10, 23, 9).getTime(), 60, 12);
    acc.addVitals(new Date(2026, 10, 23, 18).getTime(), 100, 20);
    acc.addSteps(new Date(2026, 10, 24, 8).getTime(), 300);
    acc.addSteps(new Date(2026, 10, 30, 8).getTime(), 999); // next week
    const bins = binRows('week', now, acc.drain());
    expect(bins[0]).toMatchObject({ hrMin: 60, hrMax: 100, hrMean: 80, brMin: 12, brMax: 20, steps: 0 });
    expect(bins[1].steps).toBe(300);
    expect(bins[2].future).toBe(false);
    expect(bins[3].future).toBe(true);
    expect(bins.reduce((s, b) => s + b.steps, 0)).toBe(300);
  });
});
