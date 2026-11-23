/**
 * Sound through Apple's own audio player (expo-audio, AVAudioPlayer). It is the
 * fallback, and now the default, because the Web Audio engine stayed silent
 * on a real iPhone.
 *
 * Live listening writes the incoming heart sound into short WAV files (0.5 s
 * each) and plays them one after another. That adds about a second of delay
 * but uses only the plainest iOS playback path.
 */
import { AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';
import { Agc, floatToPcm16, Resampler, wavHeader } from './pcm';
import { speakerBoost } from './boost';

const RATE = 8000;
const CHUNK = RATE / 2; // 0.5 s per file
const START_AFTER = 2; // files queued before playback starts
const RING = 6;

let modeSet = false;
export async function ensurePlaybackMode(): Promise<void> {
  if (modeSet) return;
  await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'duckOthers' });
  modeSet = true;
}

function audioDir(): Directory {
  const d = new Directory(Paths.cache, 'live-audio');
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
}

function writeWav(file: File, samples: Float32Array): void {
  const pcm = floatToPcm16(samples);
  const out = new Uint8Array(44 + pcm.length);
  out.set(wavHeader(RATE, pcm.length), 0);
  out.set(pcm, 44);
  if (file.exists) file.delete();
  file.create();
  file.writeSync(out);
}

function waitForEnd(p: AudioPlayer, maxMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, maxMs);
    const sub = p.addListener('playbackStatusUpdate', (st) => {
      if (st.didJustFinish) done();
    });
    function done() {
      clearTimeout(timer);
      sub.remove();
      resolve();
    }
  });
}

/** Plays one second of 440 Hz through AVAudioPlayer. Returns what happened, for the screen. */
export async function iosTestTone(): Promise<string> {
  try {
    await ensurePlaybackMode();
    const n = RATE;
    const tone = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const env = Math.min(1, i / 400, (n - i) / 400);
      tone[i] = 0.5 * env * Math.sin((2 * Math.PI * 440 * i) / RATE);
    }
    const f = new File(audioDir(), 'test-tone.wav');
    writeWav(f, tone);
    const p = createAudioPlayer({ uri: f.uri });
    p.volume = 1;
    p.play();
    await waitForEnd(p, 2000);
    const loaded = p.isLoaded;
    p.remove();
    return loaded ? 'Played through the iOS player.' : 'The iOS player could not load the tone file.';
  } catch (e) {
    return `iOS player error: ${String((e as Error).message ?? e)}`;
  }
}

/** Live heart sound in 0.5 s WAV pieces played back to back. */
export class ChunkedLivePlayer {
  private resampler = new Resampler(RATE);
  private agc = new Agc(0.6);
  private pending: Float32Array[] = [];
  private pendingLen = 0;
  private queue: string[] = [];
  private next = 0;
  private current: AudioPlayer | null = null;
  private preload: AudioPlayer | null = null;
  private running = false;
  volume = 0.8;
  boost = false;
  stats = { buffers: 0, underruns: 0 };

  get active(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) return;
    await ensurePlaybackMode();
    this.running = true;
    this.resampler.reset();
    this.agc.reset();
    this.pending = [];
    this.pendingLen = 0;
    this.queue = [];
    this.stats = { buffers: 0, underruns: 0 };
  }

  feed(values: ArrayLike<number>, fs: number): void {
    if (!this.running) return;
    let y = this.agc.process(this.resampler.process(values, fs), this.volume);
    if (this.boost) y = speakerBoost(y);
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
    // Too much queued means we are falling behind; drop the oldest.
    if (this.queue.length > 4) this.queue.shift();
    const f = new File(audioDir(), `live-${this.next++ % RING}.wav`);
    try {
      writeWav(f, samples);
    } catch {
      return;
    }
    this.queue.push(f.uri);
    if (!this.current && this.queue.length >= START_AFTER) this.playNext();
    else if (this.current && !this.preload) this.preparePreload();
  }

  private preparePreload(): void {
    const uri = this.queue.shift();
    if (!uri) return;
    this.preload = createAudioPlayer({ uri });
    this.preload.volume = 1;
  }

  private playNext(): void {
    if (!this.running) return;
    let p = this.preload;
    this.preload = null;
    if (!p) {
      const uri = this.queue.shift();
      if (!uri) {
        this.current = null;
        this.stats.underruns++;
        return;
      }
      p = createAudioPlayer({ uri });
      p.volume = 1;
    }
    const old = this.current;
    this.current = p;
    const sub = p.addListener('playbackStatusUpdate', (st) => {
      if (st.didJustFinish) {
        sub.remove();
        p!.remove();
        if (this.current === p) this.playNext();
      }
    });
    p.play();
    this.stats.buffers++;
    old?.remove();
    this.preparePreload();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.queue = [];
    try {
      this.current?.pause();
      this.current?.remove();
      this.preload?.remove();
    } catch {
      // already released
    }
    this.current = null;
    this.preload = null;
  }
}

/** Plays a saved WAV file through AVAudioPlayer. */
export class IosFilePlayer {
  private player: AudioPlayer | null = null;
  uri: string | null = null;
  duration = 0;
  onEnded: (() => void) | null = null;

  get playing(): boolean {
    return this.player !== null;
  }

  position(): number {
    return this.player?.currentTime ?? 0;
  }

  async play(uri: string, knownDurationS = 0): Promise<void> {
    await this.stop();
    await ensurePlaybackMode();
    const p = createAudioPlayer({ uri });
    p.volume = 1;
    this.player = p;
    this.uri = uri;
    this.duration = knownDurationS;
    p.addListener('playbackStatusUpdate', (st) => {
      if (st.duration) this.duration = st.duration;
      if (st.didJustFinish && this.player === p) {
        void this.stop().then(() => this.onEnded?.());
      }
    });
    p.play();
  }

  async stop(): Promise<void> {
    const p = this.player;
    this.player = null;
    this.uri = null;
    if (p) {
      try {
        p.pause();
        p.remove();
      } catch {
        // already released
      }
    }
  }
}
