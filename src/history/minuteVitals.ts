/**
 * Turns accepted heartbeats and breathing estimates into one value per minute
 * for Trends. A minute only gets a heart rate when at least 60% of it is
 * covered by good beats; its mean is beats / time, and its lowest and highest
 * are the slowest and fastest 15-second averages, never a single beat.
 * Breathing needs at least 10 estimates in the minute and stores their median,
 * with the 10th and 90th percentiles as its range.
 */
import { emptyRow, MinuteRow, minuteOf } from './aggregate';

export const HR_MIN_COVERAGE = 0.6;
const BLOCK_S = 15;
const BLOCK_MIN_COVERAGE = 0.6;
const BR_MIN_ESTIMATES = 10;
export const HR_PLAUSIBLE: [number, number] = [35, 200];
export const BR_PLAUSIBLE: [number, number] = [4, 45];

function pct(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
}

export class MinuteVitals {
  private beats = new Map<number, { ms: number; rr: number }[]>();
  private breaths = new Map<number, number[]>();

  addBeat(epochMs: number, rrS: number): void {
    const m = minuteOf(epochMs);
    let a = this.beats.get(m);
    if (!a) this.beats.set(m, (a = []));
    a.push({ ms: epochMs, rr: rrS });
  }

  addBreath(epochMs: number, bpm: number): void {
    if (!Number.isFinite(bpm)) return;
    const m = minuteOf(epochMs);
    let a = this.breaths.get(m);
    if (!a) this.breaths.set(m, (a = []));
    a.push(bpm);
  }

  /** Finished minutes before `epochMs` (all when omitted), removed from memory. */
  drain(epochMs?: number): MinuteRow[] {
    const cut = epochMs === undefined ? Infinity : minuteOf(epochMs);
    const minutes = new Set<number>([...this.beats.keys(), ...this.breaths.keys()]);
    const rows: MinuteRow[] = [];
    for (const m of [...minutes].sort((a, b) => a - b)) {
      if (m >= cut) continue;
      const row = emptyRow(m);
      const beats = this.beats.get(m) ?? [];
      const total = beats.reduce((s, b) => s + b.rr, 0);
      if (total >= 60 * HR_MIN_COVERAGE) {
        const mean = (60 * beats.length) / total;
        const blocks: number[] = [];
        const start = m * 60000;
        for (let k = 0; k < 60 / BLOCK_S; k++) {
          const inBlock = beats.filter((b) => b.ms >= start + k * BLOCK_S * 1000 && b.ms < start + (k + 1) * BLOCK_S * 1000);
          const sum = inBlock.reduce((s, b) => s + b.rr, 0);
          if (sum >= BLOCK_S * BLOCK_MIN_COVERAGE) blocks.push((60 * inBlock.length) / sum);
        }
        if (mean >= HR_PLAUSIBLE[0] && mean <= HR_PLAUSIBLE[1]) {
          row.hrSum = mean;
          row.hrN = 1;
          row.hrMin = blocks.length ? Math.min(...blocks) : mean;
          row.hrMax = blocks.length ? Math.max(...blocks) : mean;
        }
      }
      const br = (this.breaths.get(m) ?? []).filter((v) => v >= BR_PLAUSIBLE[0] && v <= BR_PLAUSIBLE[1]).sort((a, b) => a - b);
      if (br.length >= BR_MIN_ESTIMATES) {
        row.brSum = pct(br, 0.5);
        row.brN = 1;
        row.brMin = pct(br, 0.1);
        row.brMax = pct(br, 0.9);
      }
      this.beats.delete(m);
      this.breaths.delete(m);
      if (row.hrN || row.brN) rows.push(row);
    }
    return rows;
  }
}
