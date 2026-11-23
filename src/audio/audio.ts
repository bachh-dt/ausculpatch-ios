/**
 * Sound on the phone: live heart sound through the speaker or headphones, WAV
 * recording, and playback of saved recordings. Uses react-native-audio-api
 * (Web Audio for React Native).
 *
 * The acoustic channel runs at 2 kHz by default, below what phone audio
 * accepts, so samples are resampled to 8 kHz first. A queue of ~100 ms buffers
 * with a short pre-buffer absorbs Bluetooth jitter.
 */
import { AudioBufferQueueSourceNode, AudioBufferSourceNode, AudioContext, AudioManager, GainNode } from 'react-native-audio-api';
import { File, FileMode } from 'expo-file-system';
import type { FileHandle } from 'expo-file-system';
import { Agc, AUDIO_RATE, floatToPcm16, Resampler, wavHeader } from './pcm';

const CHUNK = AUDIO_RATE / 10; // 100 ms
const PREBUFFER_CHUNKS = 3;

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

export class LiveListener {
  private ctx: AudioContext | null = null;
  private queue: AudioBufferQueueSourceNode | null = null;
  private gain: GainNode | null = null;
  private resampler = new Resampler(AUDIO_RATE);
  private agc = new Agc(0.6);
  private pending: Float32Array[] = [];
  private pendingLen = 0;
  private queued = 0;
  private started = false;
  volume = 0.8;

  get active(): boolean {
    return this.ctx !== null;
  }

  async start(): Promise<void> {
    if (this.ctx) return;
    await acquireSession();
    const ctx = new AudioContext();
    const queue = ctx.createBufferQueueSource();
    const gain = ctx.createGain();
    gain.gain.value = 1;
    queue.connect(gain);
    gain.connect(ctx.destination);
    this.ctx = ctx;
    this.queue = queue;
    this.gain = gain;
    this.resampler.reset();
    this.agc.reset();
    this.pending = [];
    this.pendingLen = 0;
    this.queued = 0;
    this.started = false;
  }

  /** Band-passed acoustic samples at `fs`. */
  feed(values: ArrayLike<number>, fs: number): void {
    if (!this.ctx || !this.queue) return;
    const y = this.agc.process(this.resampler.process(values, fs), this.volume);
    if (!y.length) return;
    this.pending.push(y);
    this.pendingLen += y.length;
    while (this.pendingLen >= CHUNK) this.enqueue(this.take(CHUNK));
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

  private enqueue(samples: Float32Array): void {
    if (!this.ctx || !this.queue) return;
    const buf = this.ctx.createBuffer(1, samples.length, AUDIO_RATE);
    buf.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    this.queue.enqueueBuffer(buf);
    this.queued++;
    if (!this.started && this.queued >= PREBUFFER_CHUNKS) {
      this.queue.start();
      this.started = true;
    }
  }

  async stop(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      if (this.started) this.queue?.stop();
    } catch {
      // already stopped
    }
    this.queue?.disconnect();
    this.gain?.disconnect();
    this.ctx = null;
    this.queue = null;
    this.gain = null;
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
