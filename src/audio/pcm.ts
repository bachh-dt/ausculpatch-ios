/**
 * Pure audio helpers: resampling the acoustic channel to a rate phones can
 * play, automatic gain, and WAV headers. No native code, so Jest covers them.
 */

export const AUDIO_RATE = 8000;

/** Streaming linear-interpolation resampler from `fsIn` to `fsOut`. */
export class Resampler {
  private pos = 0; // position of the next output sample, in input samples, relative to `prev`
  private prev: number | null = null;
  private fsIn = 0;

  constructor(readonly fsOut = AUDIO_RATE) {}

  reset(): void {
    this.pos = 0;
    this.prev = null;
  }

  process(x: ArrayLike<number>, fsIn: number): Float32Array {
    if (!x.length || fsIn <= 0) return new Float32Array(0);
    if (Math.abs(fsIn - this.fsIn) > 0.01 * fsIn) {
      this.fsIn = fsIn;
      this.reset();
    }
    const step = fsIn / this.fsOut;
    // Work on [prev, ...x]; index 0 is prev when there is one.
    const offset = this.prev === null ? 0 : 1;
    const at = (i: number) => (i < offset ? (this.prev as number) : x[i - offset]);
    const last = x.length - 1 + offset;
    const out: number[] = [];
    let p = this.pos;
    while (p <= last - 1 + 1e-9) {
      const i = Math.floor(p);
      const f = p - i;
      out.push(at(i) * (1 - f) + at(Math.min(i + 1, last)) * f);
      p += step;
    }
    this.pos = p - last;
    this.prev = x[x.length - 1];
    return Float32Array.from(out);
  }
}

/**
 * Slow automatic gain: scales the signal so its recent peak level sits near
 * `target`, then hard-limits to [-1, 1]. Fast attack stops a knock from
 * blasting, slow release lets quiet heart sounds come up.
 */
export class Agc {
  private level = 0;

  constructor(
    public target = 0.5,
    private attack = 0.2,
    private release = 0.0005,
  ) {}

  reset(): void {
    this.level = 0;
  }

  process(x: Float32Array, volume = 1): Float32Array {
    const out = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) {
      const a = Math.abs(x[i]);
      this.level += (a > this.level ? this.attack : this.release) * (a - this.level);
      const g = this.level > 1e-9 ? this.target / this.level : 0;
      const v = x[i] * g * volume;
      out[i] = v > 1 ? 1 : v < -1 ? -1 : v;
    }
    return out;
  }
}

/** 44-byte PCM WAV header for mono 16-bit audio. */
export function wavHeader(sampleRate: number, dataBytes: number): Uint8Array {
  const h = new Uint8Array(44);
  const dv = new DataView(h.buffer);
  const ascii = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) h[o + i] = s.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  dv.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  ascii(36, 'data');
  dv.setUint32(40, dataBytes, true);
  return h;
}

export function floatToPcm16(x: Float32Array): Uint8Array {
  const out = new Uint8Array(x.length * 2);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < x.length; i++) {
    const v = Math.max(-1, Math.min(1, x[i]));
    dv.setInt16(i * 2, Math.round(v * 32767), true);
  }
  return out;
}

/** Peak heights for a waveform preview: `bars` values in 0..1. */
export function waveformBars(pcm: Int16Array, bars: number): number[] {
  const out: number[] = [];
  const per = Math.max(1, Math.floor(pcm.length / bars));
  for (let b = 0; b < bars; b++) {
    let m = 0;
    for (let i = b * per; i < Math.min(pcm.length, (b + 1) * per); i++) m = Math.max(m, Math.abs(pcm[i]));
    out.push(m / 32767);
  }
  return out;
}
