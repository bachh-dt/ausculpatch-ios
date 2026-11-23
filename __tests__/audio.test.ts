import { Agc, floatToPcm16, Resampler, wavHeader } from '../src/audio/pcm';

describe('resampler', () => {
  test('2 kHz to 8 kHz keeps a sine and gives 4x the samples across chunks', () => {
    const fs = 2000;
    const x = Float64Array.from({ length: 2000 }, (_, i) => Math.sin((2 * Math.PI * 50 * i) / fs));
    const r = new Resampler(8000);
    const parts: Float32Array[] = [];
    for (let i = 0; i < x.length; i += 33) parts.push(r.process(x.subarray(i, i + 33), fs));
    const y = Float32Array.from(parts.flatMap((p) => Array.from(p)));
    expect(Math.abs(y.length - 8000)).toBeLessThanOrEqual(8); // the last few positions wait for the next chunk
    for (let k = 400; k < 7000; k += 977) {
      expect(y[k]).toBeCloseTo(Math.sin((2 * Math.PI * 50 * k) / 8000), 1);
    }
  });
});

describe('AGC', () => {
  test('brings a quiet signal up and never clips past 1', () => {
    const quiet = Float32Array.from({ length: 8000 }, (_, i) => 0.01 * Math.sin(i / 10));
    const y = new Agc(0.5).process(quiet);
    const peak = Math.max(...Array.from(y.subarray(4000)).map(Math.abs));
    expect(peak).toBeGreaterThan(0.3);
    expect(peak).toBeLessThanOrEqual(1);
  });
});

describe('WAV', () => {
  test('header fields', () => {
    const h = wavHeader(8000, 16000);
    const dv = new DataView(h.buffer);
    expect(String.fromCharCode(...h.subarray(0, 4))).toBe('RIFF');
    expect(dv.getUint32(4, true)).toBe(16036);
    expect(dv.getUint32(24, true)).toBe(8000);
    expect(dv.getUint32(40, true)).toBe(16000);
  });
  test('pcm conversion clamps and scales', () => {
    const b = floatToPcm16(Float32Array.from([0, 1, -1, 2]));
    const dv = new DataView(b.buffer);
    expect([0, 1, 2, 3].map((i) => dv.getInt16(i * 2, true))).toEqual([0, 32767, -32767, 32767]);
  });
});
