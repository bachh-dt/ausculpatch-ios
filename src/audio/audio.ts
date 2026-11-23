/**
 * Sound on the phone: live heart sound through the speaker or headphones, WAV
 * recording, and playback of saved recordings. Uses react-native-audio-api
 * (Web Audio for React Native).
 *
 * The acoustic channel runs at 2 kHz by default, below what phone audio
 * accepts, so live sound is resampled to the output device's rate and
 * recordings to 8 kHz.
 */
import { AudioBufferSourceNode, AudioContext, AudioManager, GainNode } from 'react-native-audio-api';
import { File, FileMode } from 'expo-file-system';
import type { FileHandle } from 'expo-file-system';
import { Agc, AUDIO_RATE, floatToPcm16, Resampler, wavHeader } from './pcm';

const CHUNK_S = 0.05;
/** Start this far ahead of "now", and again after the stream runs dry. */
const LEAD_S = 0.2;

let sessionUsers = 0;
async function acquireSession(): Promise<void> {
  if (sessionUsers++ === 0) {
    AudioManager.setSystemOptions({ ios: { category: 'playback', mode: 'default', options: ['allowBluetoothA2DP'] } });
    await AudioManager.setAudioSessionActivity(true);
  }
}
async function releaseSession(): Promise<void> {
  if (--sessionUsers <= 0) {
    sessionUsers = 0;
    await AudioManager.setAudioSessionActivity(false).catch(() => undefined);
  }
}

/** Soft clipping adds harmonics (150, 250 Hz...) of the 50 Hz heart sounds, which a phone speaker can play. */
export function speakerBoost(x: Float32Array, drive = 3): Float32Array {
  const norm = Math.tanh(drive);
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = Math.tanh(drive * x[i]) / norm;
  return out;
}

/**
 * Live heart sound. Each 50 ms of sound becomes its own buffer, scheduled to
 * start where the previous one ends. If Bluetooth stalls and the schedule falls
 * behind, playback restarts a little ahead of now instead of going silent.
 * Samples are resampled straight to the output device's own rate.
 */
export class LiveListener {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private resampler: Resampler | null = null;
  private agc = new Agc(0.6);
  private pending: Float32Array[] = [];
  private pendingLen = 0;
  private nextTime = 0;
  volume = 0.8;
  boost = false;
  /** Buffers scheduled since start, and how many times the stream ran dry. */
  stats = { buffers: 0, underruns: 0 };

  get active(): boolean {
    return this.ctx !== null;
  }

  async start(): Promise<void> {
    if (this.ctx) return;
    await acquireSession();
    const ctx = new AudioContext();
    if (ctx.state !== 'running') await ctx.resume().catch(() => undefined);
    const gain = ctx.createGain();
    gain.gain.value = 1;
    gain.connect(ctx.destination);
    this.ctx = ctx;
    this.gain = gain;
    this.resampler = new Resampler(ctx.sampleRate);
    this.agc.reset();
    this.pending = [];
    this.pendingLen = 0;
    this.nextTime = 0;
    this.stats = { buffers: 0, underruns: 0 };
  }

  /** Band-passed acoustic samples at `fs`. */
  feed(values: ArrayLike<number>, fs: number): void {
    if (!this.ctx || !this.resampler) return;
    let y = this.agc.process(this.resampler.process(values, fs), this.volume);
    if (this.boost) y = speakerBoost(y);
    if (!y.length) return;
    this.pending.push(y);
    this.pendingLen += y.length;
    const chunk = Math.round(this.ctx.sampleRate * CHUNK_S);
    while (this.pendingLen >= chunk) this.schedule(this.take(chunk));
  }

  private take(n: number): Float32Array {
    const out = new Float32Array(n);
    let filled = 0;
    while (filled < n) {
      const head = this.pending[0];
      const need = n - filled;
      if (head.length <= need) {
        out.set(head, filled);
        filled += head.length;
        this.pending.shift();
      } else {
        out.set(head.subarray(0, need), filled);
        this.pending[0] = head.subarray(need);
        filled += need;
      }
    }
    this.pendingLen -= n;
    return out;
  }

  private schedule(samples: Float32Array): void {
    const ctx = this.ctx;
    if (!ctx || !this.gain) return;
    const now = ctx.currentTime;
    if (this.nextTime < now + 0.02) {
      if (this.stats.buffers > 0) this.stats.underruns++;
      this.nextTime = now + LEAD_S;
    }
    // Too far ahead means latency is building up; drop this chunk.
    if (this.nextTime > now + 1.0) return;
    const buf = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buf.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.gain);
    src.onended = () => src.disconnect();
    src.start(this.nextTime);
    this.nextTime += samples.length / ctx.sampleRate;
    this.stats.buffers++;
  }

  async stop(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    this.gain?.disconnect();
    this.ctx = null;
    this.gain = null;
    this.resampler = null;
    await ctx.close().catch(() => undefined);
    await releaseSession();
  }
}

/** One second of a 440 Hz tone, to tell a sound-output problem from a signal problem. */
export async function playTestTone(): Promise<void> {
  await acquireSession();
  const ctx = new AudioContext();
  try {
    if (ctx.state !== 'running') await ctx.resume().catch(() => undefined);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 440;
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.4, t + 0.05);
    gain.gain.setValueAtTime(0.4, t + 0.9);
    gain.gain.linearRampToValueAtTime(0, t + 1.0);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 1.05);
    await new Promise((r) => setTimeout(r, 1200));
  } finally {
    await ctx.close().catch(() => undefined);
    await releaseSession();
  }
}

/** Mono 16-bit WAV at 8 kHz, written as samples arrive; the header is fixed on close. */
export class WavRecorder {
  private handle: FileHandle | null;
  private resampler = new Resampler(AUDIO_RATE);
  private agc = new Agc(0.6);
  private bytes = 0;
  private buffered: Uint8Array[] = [];
  private bufferedLen = 0;

  constructor(readonly file: File) {
    this.handle = file.open(FileMode.Truncate);
    this.handle.writeBytesSync(wavHeader(AUDIO_RATE, 0));
  }

  get seconds(): number {
    return (this.bytes + this.bufferedLen) / 2 / AUDIO_RATE;
  }

  write(values: ArrayLike<number>, fs: number): void {
    if (!this.handle) return;
    const pcm = floatToPcm16(this.agc.process(this.resampler.process(values, fs)));
    this.buffered.push(pcm);
    this.bufferedLen += pcm.length;
    if (this.bufferedLen >= 64 * 1024) this.flush();
  }

  private flush(): void {
    if (!this.handle || !this.bufferedLen) return;
    const all = new Uint8Array(this.bufferedLen);
    let o = 0;
    for (const b of this.buffered) {
      all.set(b, o);
      o += b.length;
    }
    this.handle.writeBytesSync(all);
    this.bytes += all.length;
    this.buffered = [];
    this.bufferedLen = 0;
  }

  close(): number {
    this.flush();
    if (this.handle) {
      this.handle.offset = 0;
      this.handle.writeBytesSync(wavHeader(AUDIO_RATE, this.bytes));
      this.handle.close();
      this.handle = null;
    }
    return this.bytes / 2 / AUDIO_RATE;
  }
}

/** Plays one saved WAV file. */
export class FilePlayer {
  private ctx: AudioContext | null = null;
  private src: AudioBufferSourceNode | null = null;
  private startedAt = 0;
  duration = 0;
  uri: string | null = null;
  onEnded: (() => void) | null = null;

  get playing(): boolean {
    return this.src !== null;
  }

  position(): number {
    return this.ctx && this.src ? Math.min(this.duration, this.ctx.currentTime - this.startedAt) : 0;
  }

  async play(uri: string): Promise<void> {
    await this.stop();
    await acquireSession();
    const ctx = new AudioContext();
    this.ctx = ctx;
    const path = decodeURI(uri.replace(/^file:\/\//, ''));
    const buffer = await ctx.decodeAudioData(path);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.onended = () => {
      if (this.src === src) void this.stop().then(() => this.onEnded?.());
    };
    this.duration = buffer.duration;
    this.uri = uri;
    this.src = src;
    this.startedAt = ctx.currentTime;
    src.start();
  }

  async stop(): Promise<void> {
    const ctx = this.ctx;
    const src = this.src;
    this.src = null;
    this.ctx = null;
    this.uri = null;
    if (src) {
      try {
        src.stop();
      } catch {
        // already ended
      }
      src.disconnect();
    }
    if (ctx) {
      await ctx.close().catch(() => undefined);
      await releaseSession();
    }
  }
}
