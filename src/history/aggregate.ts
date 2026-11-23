/**
 * Heart rate, breathing rate and steps are kept as one row per minute. A day is
 * 1440 rows at most, so a month of history is small and every chart is a quick
 * query plus the binning below.
 */

export interface MinuteRow {
  minute: number; // epoch minutes (ms / 60000, floored)
  hrMin: number | null;
  hrMax: number | null;
  hrSum: number;
  hrN: number;
  brMin: number | null;
  brMax: number | null;
  brSum: number;
  brN: number;
  steps: number;
}

export const emptyRow = (minute: number): MinuteRow => ({
  minute,
  hrMin: null,
  hrMax: null,
  hrSum: 0,
  hrN: 0,
  brMin: null,
  brMax: null,
  brSum: 0,
  brN: 0,
  steps: 0,
});

const lo = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.min(a, b));
const hi = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.max(a, b));

export function mergeRows(a: MinuteRow, b: MinuteRow): MinuteRow {
  return {
    minute: a.minute,
    hrMin: lo(a.hrMin, b.hrMin),
    hrMax: hi(a.hrMax, b.hrMax),
    hrSum: a.hrSum + b.hrSum,
    hrN: a.hrN + b.hrN,
    brMin: lo(a.brMin, b.brMin),
    brMax: hi(a.brMax, b.brMax),
    brSum: a.brSum + b.brSum,
    brN: a.brN + b.brN,
    steps: a.steps + b.steps,
  };
}

export const minuteOf = (epochMs: number) => Math.floor(epochMs / 60000);

/** Collects readings in memory and hands out finished minutes for saving. */
export class MinuteAccumulator {
  private rows = new Map<number, MinuteRow>();

  private row(epochMs: number): MinuteRow {
    const m = minuteOf(epochMs);
    let r = this.rows.get(m);
    if (!r) {
      r = emptyRow(m);
      this.rows.set(m, r);
    }
    return r;
  }

  addVitals(epochMs: number, hr: number | null, br: number | null): void {
    const r = this.row(epochMs);
    if (hr !== null && Number.isFinite(hr)) {
      r.hrMin = lo(r.hrMin, hr);
      r.hrMax = hi(r.hrMax, hr);
      r.hrSum += hr;
      r.hrN++;
    }
    if (br !== null && Number.isFinite(br)) {
      r.brMin = lo(r.brMin, br);
      r.brMax = hi(r.brMax, br);
      r.brSum += br;
      r.brN++;
    }
  }

  addSteps(epochMs: number, n: number): void {
    if (n > 0) this.row(epochMs).steps += n;
  }

  /** Rows for minutes before `epochMs` (all rows when omitted), removed from memory. */
  drain(epochMs?: number): MinuteRow[] {
    const cut = epochMs === undefined ? Infinity : minuteOf(epochMs);
    const out: MinuteRow[] = [];
    for (const [m, r] of this.rows) {
      if (m < cut) {
        out.push(r);
        this.rows.delete(m);
      }
    }
    return out.sort((a, b) => a.minute - b.minute);
  }

  /** Unsaved rows, for showing today's totals before they are written. */
  pending(): MinuteRow[] {
    return [...this.rows.values()];
  }
}

export type Period = 'day' | 'week' | 'month';

export interface Bin {
  label: string;
  start: number; // epoch ms
  end: number;
  hrMin: number | null;
  hrMax: number | null;
  hrMean: number | null;
  brMin: number | null;
  brMax: number | null;
  brMean: number | null;
  steps: number;
  /** True for bins that start after `now` (drawn empty). */
  future: boolean;
}

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Bin edges in local time for the period containing `now`. */
export function binEdges(period: Period, now: Date): { start: number; end: number; label: string }[] {
  const y = now.getFullYear(), mo = now.getMonth(), d = now.getDate();
  const out: { start: number; end: number; label: string }[] = [];
  if (period === 'day') {
    for (let h = 0; h < 24; h += 3) {
      out.push({ start: new Date(y, mo, d, h).getTime(), end: new Date(y, mo, d, h + 3).getTime(), label: `${h}h` });
    }
  } else if (period === 'week') {
    const monday = d - ((now.getDay() + 6) % 7);
    for (let i = 0; i < 7; i++) {
      out.push({ start: new Date(y, mo, monday + i).getTime(), end: new Date(y, mo, monday + i + 1).getTime(), label: DAY_LETTERS[i] });
    }
  } else {
    const days = new Date(y, mo + 1, 0).getDate();
    for (let i = 1; i <= days; i++) {
      out.push({ start: new Date(y, mo, i).getTime(), end: new Date(y, mo, i + 1).getTime(), label: i === 1 || i % 5 === 0 ? String(i) : '' });
    }
  }
  return out;
}

export function binRows(period: Period, now: Date, rows: MinuteRow[]): Bin[] {
  const edges = binEdges(period, now);
  const bins: Bin[] = edges.map((e) => ({
    ...e,
    hrMin: null,
    hrMax: null,
    hrMean: null,
    brMin: null,
    brMax: null,
    brMean: null,
    steps: 0,
    future: e.start > now.getTime(),
  }));
  const sums = edges.map(() => ({ hr: 0, hrN: 0, br: 0, brN: 0 }));
  for (const r of rows) {
    const t = r.minute * 60000;
    // Edges are sorted and contiguous, so a binary search finds the bin.
    let a = 0, b = edges.length - 1, k = -1;
    while (a <= b) {
      const mid = (a + b) >> 1;
      if (t < edges[mid].start) b = mid - 1;
      else if (t >= edges[mid].end) a = mid + 1;
      else {
        k = mid;
        break;
      }
    }
    if (k < 0) continue;
    const bin = bins[k];
    bin.hrMin = lo(bin.hrMin, r.hrMin);
    bin.hrMax = hi(bin.hrMax, r.hrMax);
    bin.brMin = lo(bin.brMin, r.brMin);
    bin.brMax = hi(bin.brMax, r.brMax);
    bin.steps += r.steps;
    sums[k].hr += r.hrSum;
    sums[k].hrN += r.hrN;
    sums[k].br += r.brSum;
    sums[k].brN += r.brN;
  }
  bins.forEach((bin, k) => {
    bin.hrMean = sums[k].hrN ? sums[k].hr / sums[k].hrN : null;
    bin.brMean = sums[k].brN ? sums[k].br / sums[k].brN : null;
  });
  return bins;
}

export function periodRange(period: Period, now: Date): [number, number] {
  const e = binEdges(period, now);
  return [e[0].start, e[e.length - 1].end];
}
