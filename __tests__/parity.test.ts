/**
 * The phone app against the Python host package.
 *
 * Every expected value in vectors.json was produced by host/ausculpatch (see
 * scripts/make_vectors.py), so these tests fail if the TypeScript port drifts
 * from the code the desktop apps use.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as P from '../src/protocol/protocol';
import { batchTotal, decodeStream } from '../src/protocol/decode';
import { DumpAssembler, MemorySink } from '../src/protocol/dump';
import { bytesSource, FlashImageReader } from '../src/protocol/flashlog';
import { batchRows, CSV_HEADER, flashSampleRow } from '../src/protocol/csv';
import { butterSos, findPeaks, sosfilt, sosfiltZi } from '../src/dsp/signal';
import {
  BlockMeanDecimator,
  HOST_BREATHING_FILTER as BREATHING_FILTER,
  HOST_ECG_FILTER as ECG_FILTER,
  HOST_HEART_SOUND_FILTER as HEART_SOUND_FILTER,
  StreamingFilter,
} from '../src/dsp/filters';
import { estimateHeartRate, estimateRateFromWave, RR_MAX_BPM, RR_MIN_BPM } from '../src/dsp/vitals';
import { base64ToBytes, bytesToBase64, utf8Decode } from '../src/util/base64';

const V = JSON.parse(fs.readFileSync(path.join(__dirname, 'vectors.json'), 'utf8'));
const b64 = (s: string) => Uint8Array.from(Buffer.from(s, 'base64'));
const hex = (u: Uint8Array) => Buffer.from(u).toString('hex');

function close(actual: ArrayLike<number>, expected: number[], rel = 1e-7) {
  expect(actual.length).toBe(expected.length);
  let scale = 0;
  for (const e of expected) scale = Math.max(scale, Math.abs(e));
  for (let i = 0; i < expected.length; i++) {
    const err = Math.abs(actual[i] - expected[i]);
    if (err > rel * Math.max(1, scale)) {
      throw new Error(`index ${i}: ${actual[i]} vs ${expected[i]} (scale ${scale})`);
    }
  }
}

describe('flash image decoding matches flashlog.py + storage.py', () => {
  for (const vec of V.flash) {
    test(vec.name, () => {
      const image = b64(vec.image);
      let csv = CSV_HEADER;
      const reader = new FlashImageReader(bytesSource(image), (s) => (csv += flashSampleRow(0, s)), vec.session);
      // Small steps, as the app runs it.
      while (reader.step(3));
      expect(reader.report.samples).toBe(vec.rows);
      expect(reader.report.summary()).toBe(vec.summary);
      expect(csv.replace(/\r\n/g, '\n')).toBe(vec.csv.replace(/\r\n/g, '\n'));
    });
  }
});

describe('dump reassembly matches dump.py', () => {
  const d = V.dump;
  test('events, gaps, resume page, report and image', () => {
    const sink = new MemorySink();
    const asm = new DumpAssembler(sink);
    asm.setGeometry(P.parseDumpHeaderLog(d.header) as P.DumpHeader);
    d.packets.forEach((p: string, i: number) => {
      const e = asm.addPacket(b64(p));
      const exp = d.events[i];
      expect(e.kind).toBe(exp.kind);
      if (exp.kind === 'page_marker') {
        expect(e.page).toBe(exp.page);
        expect(e.shouldAck).toBe(exp.shouldAck);
        if (exp.progress === null) expect(e.progress).toBeUndefined();
        else expect(e.progress).toBeCloseTo(exp.progress, 9);
      } else if (exp.offset !== null) {
        expect(e.offset).toBe(exp.offset);
      }
    });
    expect(asm.crcFailures).toBe(d.crcFailures);
    expect(asm.duplicateChunks).toBe(d.duplicates);
    expect(asm.gaps().map((g) => [g.offset, g.length])).toEqual(d.gaps);
    expect(asm.resumePage()).toBe(d.resumePage);
    expect(asm.integrityReport()).toBe(d.report);
    expect(hex(sink.image(asm.expectedBytes ?? 0))).toBe(hex(b64(d.image)));
  });
});

describe('live notifications match decode.py + CsvRecorder.write_batch', () => {
  V.notifications.forEach((n: { data: string; csv: string; total: number }, i: number) => {
    test(`notification ${i}`, () => {
      const batch = decodeStream(b64(n.data));
      expect(batchTotal(batch)).toBe(n.total);
      const header = n.csv.split(/\r?\n/)[0] + '\n';
      expect(header).toBe(CSV_HEADER);
      expect(CSV_HEADER + batchRows(0, batch)).toBe(n.csv.replace(/\r\n/g, '\n'));
    });
  });
});

describe('log parsing matches protocol.py', () => {
  for (const L of V.logs) {
    test(L.line, () => {
      const rates = P.parseRatesLog(L.line);
      expect(rates).toEqual(L.rates);
      const duty = P.parseDutyLog(L.line);
      expect(
        duty && {
          enabled: duty.enabled,
          on_seconds: duty.onSeconds,
          off_seconds: duty.offSeconds,
          sink: duty.sink,
          state: duty.state,
          seconds_left: duty.secondsLeft,
          bursts: duty.bursts,
        },
      ).toEqual(L.duty);
      const flash = P.parseFlashLog(L.line);
      expect(
        flash && {
          jedec_id: flash.jedecId,
          session: flash.session,
          pages_used: flash.pagesUsed,
          pages_total: flash.pagesTotal,
          bytes_used: flash.bytesUsed,
          bad_blocks: flash.badBlocks,
          recovered: flash.recovered,
          full: flash.full,
        },
      ).toEqual(L.flash);
      expect(P.parseInfoLog(L.line)).toEqual(L.info);
      const h = P.parseDumpHeaderLog(L.line);
      expect(h && { total_bytes: h.totalBytes, pages: h.pages, stride: h.stride, session: h.session }).toEqual(L.dumpHeader);
      expect(P.parseDumpSizeLog(L.line)).toEqual(L.dumpSize);
      expect(P.isDumpStartLog(L.line)).toBe(L.start);
      expect(P.isDumpEndLog(L.line)).toBe(L.end);
    });
  }
});

describe('commands and constants match protocol.py', () => {
  const C = V.commands;
  test('command bytes', () => {
    expect(hex(P.cmdSetGainOffset(5, 200))).toBe(C.gain);
    expect(hex(P.cmdStartDump())).toBe(C.dump0);
    expect(hex(P.cmdStartDump(300))).toBe(C.dump300);
    expect(hex(P.cmdSetRate('ACO', 4000))).toBe(C.rate);
    expect(hex(P.cmdSetDutyCycle(true, 60, 86400, P.DUTY_SINK_LIVE))).toBe(C.duty);
    expect(hex(P.cmdSetDutyCycle(false, 60, 240))).toBe(C.dutyOff);
  });
  test('scaling and rate snapping', () => {
    expect(P.ECG_COUNTS_TO_MV).toBeCloseTo(C.ecgMv, 15);
    expect(P.batteryCountsToVolts(2048)).toBeCloseTo(C.batt, 12);
    expect(P.nearestHardwareRate('ACO', 1000)).toBe(C.nearestAco);
    expect(P.nearestHardwareRate('ECG', 375)).toBe(C.nearestEcg);
    expect(P.nearestHardwareRate('IMU', 5000)).toBe(C.nearestImu);
    expect(P.describeResetReason(0x5)).toBe(C.reset);
  });
  test('rejects out-of-range arguments', () => {
    expect(() => P.cmdSetDutyCycle(true, 0, 10)).toThrow();
    expect(() => P.cmdSetDutyCycle(true, 10, 86401)).toThrow();
    expect(() => P.cmdSetGainOffset(8, 0)).toThrow();
  });
});

describe('signal processing matches scipy', () => {
  const specs: Record<string, typeof HEART_SOUND_FILTER> = {
    heart: HEART_SOUND_FILTER,
    ecg: ECG_FILTER,
    breath: BREATHING_FILTER,
  };
  for (const f of V.dsp.filters) {
    test(`${f.name} filter at ${f.fs} Hz`, () => {
      const sos = specs[f.name].design(f.fs);
      expect(sos).not.toBeNull();
      // Frequency response.
      const mags = (f.freqs as number[]).map((hz) => {
        const w = (2 * Math.PI * hz) / f.fs;
        let re = 1, im = 0;
        for (const s of sos!) {
          const zr1 = Math.cos(-w), zi1 = Math.sin(-w), zr2 = Math.cos(-2 * w), zi2 = Math.sin(-2 * w);
          const nr = s[0] + s[1] * zr1 + s[2] * zr2, ni = s[1] * zi1 + s[2] * zi2;
          const dr = s[3] + s[4] * zr1 + s[5] * zr2, di = s[4] * zi1 + s[5] * zi2;
          const d2 = dr * dr + di * di;
          const qr = (nr * dr + ni * di) / d2, qi = (ni * dr - nr * di) / d2;
          [re, im] = [re * qr - im * qi, re * qi + im * qr];
        }
        return Math.hypot(re, im);
      });
      close(mags, f.mag, 1e-6);
      close(sosfilt(sos!, f.x), f.cold, 1e-6);
      const zi = sosfiltZi(sos!).map(([a, b]) => [a * f.x[0], b * f.x[0]]);
      close(sosfilt(sos!, f.x, zi), f.warm, 1e-6);
    });
  }

  V.dsp.peaks.forEach((p: { x: number[]; height: number; distance: number; peaks: number[] }, i: number) => {
    test(`find_peaks case ${i}`, () => {
      expect(findPeaks(p.x, p.height, p.distance)).toEqual(p.peaks);
    });
  });

  for (const v of V.dsp.vitals) {
    test(`vitals ${v.name}`, () => {
      const got =
        v.kind === 'hr'
          ? estimateHeartRate(v.x, v.fs)
          : estimateRateFromWave(v.x, v.fs, RR_MIN_BPM, RR_MAX_BPM, 12);
      if (v.expected === null) expect(got).toBeNull();
      else expect(got).toBeCloseTo(v.expected, 6);
    });
  }

  test('streaming heart + breathing pipeline in uneven blocks', () => {
    const S = V.dsp.streaming;
    const hf = new StreamingFilter(HEART_SOUND_FILTER);
    const bf = new StreamingFilter(BREATHING_FILTER);
    const dec = new BlockMeanDecimator(50);
    const heart: number[] = [];
    const bt: number[] = [];
    const bv: number[] = [];
    let i = 0;
    for (const n of S.blocks as number[]) {
      const xs = S.x.slice(i, i + n);
      const ts = xs.map((_: number, k: number) => (i + k) / S.fs);
      const h = hf.process(xs, S.fs);
      heart.push(...h);
      const [et, env] = dec.process(ts, Array.from(h, Math.abs), S.fs);
      if (et.length) {
        bt.push(...et);
        bv.push(...bf.process(env, dec.outputRate(S.fs)));
      }
      i += n;
    }
    close(heart, S.heart, 1e-6);
    close(bt, S.breathT, 1e-9);
    close(bv, S.breath, 1e-6);
  });

  test('butterworth designs exist for the band edges the app uses', () => {
    expect(butterSos(2, [0.5, 40], 'bandpass', 250)).toHaveLength(2);
    expect(butterSos(4, [20, 100], 'bandpass', 2000)).toHaveLength(4);
    expect(butterSos(2, 0.5, 'lowpass', 50)).toHaveLength(1);
  });
});

describe('base64 and UTF-8 helpers', () => {
  test('round trip at every length', () => {
    for (let n = 0; n < 300; n++) {
      const b = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 0xff);
      expect(bytesToBase64(b)).toBe(Buffer.from(b).toString('base64'));
      expect(hex(base64ToBytes(Buffer.from(b).toString('base64')))).toBe(hex(b));
    }
  });
  test('utf8', () => {
    const s = 'Temp 36.5 °C, ✓ ok';
    expect(utf8Decode(Uint8Array.from(Buffer.from(s, 'utf8')))).toBe(s);
  });
});
