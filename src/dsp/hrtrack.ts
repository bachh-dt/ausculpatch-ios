/**
 * Beat-to-beat heart rate with artifact rejection.
 *
 * Heart rate is built from individual R-R intervals, not from one estimate per
 * window, so each interval can be checked on its own:
 *
 *   - only beats from ECG windows whose quality is good are used, and an
 *     interval never spans a stretch of poor signal
 *   - intervals outside 0.3-1.7 s (35-200 bpm) are dropped
 *   - an interval more than 25% away from the median of the last 8 accepted
 *     ones is dropped (a missed beat doubles the interval). A peak that comes
 *     far too soon (a T wave or a knock) is skipped, so the true interval to
 *     the next beat is still measured
 *   - if four rejected intervals in a row agree with each other, the heart
 *     rate really has changed, and they become the new reference
 */
import { median } from './signal';

export const RR_MIN_S = 0.3;
export const RR_MAX_S = 1.7;
export const RR_MAX_DEVIATION = 0.25;
const REFERENCE_BEATS = 8;
const LIVE_WINDOW_S = 15;
const LIVE_MIN_BEATS = 8;
const MIN_BEAT_GAP_S = 0.25;

export interface AcceptedBeat {
  t: number; // time of the beat that ends the interval
  rr: number; // seconds
}

export class HeartRateTracker {
  private lastBeat: number | null = null;
  private reference: number[] = [];
  private rejectedRun: number[] = [];
  private recent: AcceptedBeat[] = [];
  accepted = 0;
  rejected = 0;

  reset(): void {
    this.lastBeat = null;
    this.reference = [];
    this.rejectedRun = [];
    this.recent = [];
  }

  /**
   * Feed R-peak times (seconds, any order, repeats allowed) from one analysis
   * window, and whether that window's ECG was good. Returns newly accepted intervals.
   */
  addBeats(beats: number[], good: boolean): AcceptedBeat[] {
    const out: AcceptedBeat[] = [];
    const sorted = [...beats].sort((a, b) => a - b);
    for (const b of sorted) {
      if (this.lastBeat !== null && b <= this.lastBeat + MIN_BEAT_GAP_S) continue; // already seen
      const prev = this.lastBeat;
      this.lastBeat = b;
      if (!good || prev === null) continue;
      const rr = b - prev;
      if (rr < RR_MIN_S || rr > RR_MAX_S) {
        this.reject(rr);
        continue;
      }
      if (this.reference.length >= 4) {
        const med = median(this.reference);
        if (Math.abs(rr - med) > RR_MAX_DEVIATION * med) {
          // Much too short: an extra peak (a T wave or a knock), not a beat.
          // Skip it and measure the next beat from the real one before it.
          if (rr < (1 - 2 * RR_MAX_DEVIATION) * med) this.lastBeat = prev;
          this.reject(rr);
          continue;
        }
      }
      this.accept({ t: b, rr }, out);
    }
    return out;
  }

  /** Call when the signal goes bad, so the next interval does not bridge the gap. */
  breakChain(): void {
    this.lastBeat = null;
  }

  private accept(beat: AcceptedBeat, out: AcceptedBeat[]): void {
    this.rejectedRun = [];
    this.reference.push(beat.rr);
    if (this.reference.length > REFERENCE_BEATS) this.reference.shift();
    this.recent.push(beat);
    if (this.recent.length > 300) this.recent.shift();
    this.accepted++;
    out.push(beat);
  }

  private reject(rr: number): void {
    this.rejected++;
    if (rr < RR_MIN_S || rr > RR_MAX_S) {
      this.rejectedRun = [];
      return;
    }
    this.rejectedRun.push(rr);
    if (this.rejectedRun.length >= 4) {
      const med = median(this.rejectedRun);
      if (this.rejectedRun.every((v) => Math.abs(v - med) < 0.15 * med)) {
        // A real change of rate: start the reference again from these.
        this.reference = [...this.rejectedRun];
      }
      this.rejectedRun = this.rejectedRun.slice(-3);
    }
  }

  /** Heart rate over the last 15 s, or null with fewer than 8 good intervals. */
  liveHr(nowS: number): number | null {
    const rrs = this.recent.filter((b) => b.t >= nowS - LIVE_WINDOW_S).map((b) => b.rr);
    if (rrs.length < LIVE_MIN_BEATS) return null;
    return 60 / median(rrs);
  }
}
