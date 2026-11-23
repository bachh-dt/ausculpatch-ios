/**
 * The live engine: one timer, at the trace frame rate, does all per-sample work
 * outside React. Screens only read its results.
 *
 *   every frame : filters, steps and falls, audio, recording; then redraw traces
 *   every second: signal quality and the reattach reminder
 *   every 2 s   : heart rate and breathing rate, hidden while quality is poor
 *
 * Earlier versions filtered inside the screen's render and copied every sample
 * of every trace on each redraw, which is what made high sampling rates lag.
 */
import * as P from '../protocol/protocol';
import { session } from '../ble/session';
import { Vitals } from './clinical';
import { ecgQuality, EcgQuality, heartSoundQuality, PoorContactTimer, Quality, UNKNOWN } from '../dsp/quality';
import { FallDetector, FallEvent, StepCounter } from '../dsp/motion';
import { history, notifyFall, notifyReattach, settings } from '../app/services';
import { LiveListener, playTestTone, WavRecorder } from '../audio/audio';
import { ChunkedLivePlayer, iosTestTone } from '../audio/iosAudio';
import { analyzeCardiac, CardiacResult } from '../dsp/cardiac';
import { FallCheck } from '../dsp/motion';
import { HeartRateTracker } from '../dsp/hrtrack';
import { median } from '../dsp/signal';
import { recordings } from '../storage/recordings';
import { newFile, stampedName } from '../storage/files';

const QUALITY_WINDOW_S = 8;
const EMPTY_VITALS: Vitals = { heartRate: null, breathingRate: null, skinTempC: null, batteryV: null };

export interface PendingFall extends FallEvent {
  epochMs: number;
  heartRate: number | null;
}

export interface EngineState {
  vitals: Vitals;
  vitalsAt: number;
  ecgQuality: EcgQuality;
  heartQuality: Quality;
  reattach: boolean;
  stepsToday: number;
  fall: PendingFall | null;
  listening: boolean;
  recording: { active: boolean; startedAt: number; seconds: number };
  science: CardiacResult | null;
  motion: { peakG: number; imuHz: number; lastCheck: FallCheck | null };
  audio: { buffers: number; underruns: number };
}

type Listener = () => void;

class LiveEngine {
  state: EngineState = {
    vitals: EMPTY_VITALS,
    vitalsAt: 0,
    ecgQuality: { ...UNKNOWN, beats: [] },
    heartQuality: UNKNOWN,
    reattach: false,
    stepsToday: 0,
    fall: null,
    listening: false,
    recording: { active: false, startedAt: 0, seconds: 0 },
    science: null,
    motion: { peakG: 0, imuHz: 0, lastCheck: null },
    audio: { buffers: 0, underruns: 0 },
  };
  /** Screens that need the cardiac analysis register here, so it only runs while shown. */
  private scienceUsers = 0;
  private lastScience = 0;
  private lastMotionReport = 0;
  frame = 0;

  private listeners = new Set<Listener>();
  private frameListeners = new Set<Listener>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private fps = 0;
  private lastQuality = 0;
  private lastVitals = 0;
  private poorTimer = new PoorContactTimer(10);
  private snoozeUntil = 0;
  private reattachNotified = false;

  private hr = new HeartRateTracker();
  private hrGeneration = -1;
  private breathRecent: number[] = [];
  private steps = new StepCounter();
  private falls = new FallDetector('normal');
  private imuSeen = 0;
  private imuGeneration = -1;

  private webListener = new LiveListener();
  private iosListener = new ChunkedLivePlayer();
  private listener: LiveListener | ChunkedLivePlayer = this.iosListener;
  private wav: WavRecorder | null = null;
  private csvName: string | null = null;
  private hrDuringRecording: number[] = [];

  constructor() {
    this.state.stepsToday = history.stepsToday();
    this.applySettings();
    settings.subscribe(() => this.applySettings());
    history.subscribe(() => {
      const steps = history.stepsToday();
      if (steps !== this.state.stepsToday) this.set({ stepsToday: steps });
    });
    session.subscribe(() => {
      if (!session.state.connected && this.state.reattach) this.set({ reattach: false });
    });
  }

  // ------------------------------------------------------------ plumbing --
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  onFrame(fn: Listener): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }
  private set(patch: Partial<EngineState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  private applySettings(): void {
    const s = settings.get();
    session.clinical.configure(s);
    this.falls.sensitivity = s.fallSensitivity;
    this.poorTimer.delayS = s.reattachDelayS;
    for (const l of [this.webListener, this.iosListener]) {
      l.volume = s.listenVolume;
      l.boost = s.listenBand === 'wide';
    }
    const wanted = s.audioEngine === 'web' ? this.webListener : this.iosListener;
    if (wanted !== this.listener) {
      const was = this.listener.active;
      void this.listener.stop().then(async () => {
        this.listener = wanted;
        if (was) await this.listener.start();
        this.wireSink();
      });
    }
    if (s.traceFps !== this.fps) {
      this.fps = s.traceFps;
      if (this.timer) clearInterval(this.timer);
      this.timer = setInterval(() => this.tick(), 1000 / this.fps);
    }
  }

  // --------------------------------------------------------------- frame --
  private tick(): void {
    const now = Date.now();
    if (session.state.connected) {
      session.clinical.update();
      this.updateMotion(now);
      if (now - this.lastQuality >= 1000) {
        this.lastQuality = now;
        this.updateQuality(now);
      }
      if (now - this.lastVitals >= 2000) {
        this.lastVitals = now;
        this.updateVitals(now);
      }
      if (this.scienceUsers > 0 && now - this.lastScience >= 2000) {
        this.lastScience = now;
        this.updateScience();
      }
      if (this.wav) {
        const seconds = Math.floor(this.wav.seconds);
        if (seconds !== this.state.recording.seconds) this.set({ recording: { ...this.state.recording, seconds } });
      }
    } else if (this.state.vitals !== EMPTY_VITALS) {
      this.set({ vitals: EMPTY_VITALS, ecgQuality: { ...UNKNOWN, beats: [] }, heartQuality: UNKNOWN });
    }
    this.frame++;
    for (const fn of this.frameListeners) fn();
  }

  private updateMotion(now: number): void {
    const buf = session.buffers.channels[P.CHANNEL_IMU];
    if (session.buffers.generation !== this.imuGeneration) {
      this.imuGeneration = session.buffers.generation;
      this.imuSeen = 0;
      this.steps.reset();
      this.falls.reset();
    }
    const total = buf.totalSamples;
    const n = Math.min(Math.max(0, total - this.imuSeen), buf.length);
    this.imuSeen = total;
    if (!n) return;
    const [t, x] = buf.latest(n, 0);
    const [, y] = buf.latest(n, 1);
    const [, z] = buf.latest(n, 2);
    const fs = buf.timestampRateHz(5) || session.state.rates.IMU || P.DEFAULT_RATES_HZ.IMU;

    const counted = this.steps.process(t, x, y, z, fs);
    if (counted.length) {
      history.live.addSteps(now, counted.length);
      this.set({ stepsToday: history.stepsToday() });
    }
    const fallsNow = this.falls.process(t, x, y, z, fs);
    if (now - this.lastMotionReport >= 1000 || fallsNow.length) {
      this.lastMotionReport = now;
      this.set({ motion: { peakG: this.falls.recentPeakG, imuHz: fs, lastCheck: this.falls.lastCheck } });
      if (this.listener.active) this.set({ audio: { ...this.listener.stats } });
    }
    for (const f of fallsNow) {
      // The detector judges 6 s after the impact; date the event at the impact.
      const latest = buf.latestTimeS ?? f.t;
      const epochMs = now - Math.max(0, latest - f.t) * 1000;
      const fall: PendingFall = { ...f, epochMs, heartRate: this.state.vitals.heartRate };
      history.addEvent({
        time: epochMs,
        kind: 'fall',
        source: 'live',
        detail: JSON.stringify({ impactG: f.impactG, angleDeg: f.angleDeg }),
      });
      if (settings.get().fallAlerts) {
        this.set({ fall });
        void notifyFall(new Date(epochMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      }
    }
  }

  private updateQuality(now: number): void {
    const s = settings.get();
    const c = session.clinical;
    const resting = session.state.duty?.state === 2;
    if (resting) {
      this.poorTimer.reset();
      this.set({ ecgQuality: { ...UNKNOWN, beats: [] }, heartQuality: UNKNOWN, reattach: false });
      return;
    }
    const [et, ef] = c.ecgOut.snapshot(QUALITY_WINDOW_S);
    const [, er] = c.ecgRawMv.snapshot(QUALITY_WINDOW_S);
    const eq = ecgQuality(er, ef, c.rate('ECG'), s.qualityThreshold);
    this.trackBeats(et, eq.beats, eq.level, now);

    const [ht, hf] = c.heartOut.snapshot(QUALITY_WINDOW_S);
    const [, ar] = session.buffers.channels[P.CHANNEL_ACOUSTIC].snapshot(QUALITY_WINDOW_S);
    const beats = eq.level === 'good' && et.length && ht.length ? eq.beats.map((b) => et[0] + b - ht[0]).filter((b) => b >= 0) : [];
    const hq = heartSoundQuality(ar, hf, c.rate('ACO'), beats, s.qualityThreshold);

    const bad = (q: Quality) => q.level === 'poor' || q.level === 'none';
    const due = this.poorTimer.update(bad(eq) || bad(hq), now / 1000);
    const show = s.reattachReminders && due && now >= this.snoozeUntil;
    if (show && !this.state.reattach && !this.reattachNotified) {
      this.reattachNotified = true;
      void notifyReattach();
    }
    if (!due) this.reattachNotified = false;
    this.set({ ecgQuality: eq, heartQuality: hq, reattach: show });
  }

  /** Beat-by-beat heart rate: checked R-R intervals go to the live value and to history. */
  private trackBeats(et: Float64Array, beats: number[], level: Quality['level'], now: number): void {
    if (session.buffers.generation !== this.hrGeneration) {
      this.hrGeneration = session.buffers.generation;
      this.hr.reset();
      this.breathRecent = [];
    }
    if (!et.length) return;
    if (level === 'poor' || level === 'none') {
      this.hr.breakChain();
      return;
    }
    if (level !== 'good') return;
    // A peak in the last 0.1 s may still be rising; the next window will have it.
    const span = et[et.length - 1] - et[0];
    const abs = beats.filter((b) => b <= span - 0.1).map((b) => et[0] + b);
    const latest = session.buffers.latestTimeS() ?? et[et.length - 1];
    for (const a of this.hr.addBeats(abs, true)) history.vitals.addBeat(now - (latest - a.t) * 1000, a.rr);
  }

  private updateVitals(now: number): void {
    const raw = session.clinical.vitals();
    const { ecgQuality: eq, heartQuality: hq } = this.state;
    const poor = (q: Quality) => q.level === 'poor' || q.level === 'none';
    const latest = session.buffers.latestTimeS();
    // Never show a number worked out from a bad signal.
    const heartRate = poor(eq) || latest === null ? null : this.hr.liveHr(latest);
    const br = poor(hq) ? null : raw.breathingRate;
    if (br !== null) {
      history.vitals.addBreath(now, br);
      this.breathRecent.push(br);
      if (this.breathRecent.length > 3) this.breathRecent.shift();
    } else if (poor(hq)) this.breathRecent = [];
    const breathingRate = br !== null && this.breathRecent.length ? median(this.breathRecent) : null;
    const vitals: Vitals = { ...raw, heartRate, breathingRate };
    if (this.wav && heartRate !== null) this.hrDuringRecording.push(heartRate);
    this.set({ vitals, vitalsAt: now });
  }

  private updateScience(): void {
    const s = settings.get();
    const c = session.clinical;
    const W = 30;
    const [et, ev] = c.ecgRawMv.snapshot(W);
    const aco = session.buffers.channels[P.CHANNEL_ACOUSTIC];
    const [at, av] = aco.snapshot(W);
    const imu = session.buffers.channels[P.CHANNEL_IMU];
    const [it, ix] = imu.snapshot(W, 0);
    const [, iy] = imu.snapshot(W, 1);
    const [, iz] = imu.snapshot(W, 2);
    const imuFs = imu.timestampRateHz(5) || session.state.rates.IMU || 0;
    try {
      const science = analyzeCardiac({
        ecg: { t: et, v: ev, fs: c.rate('ECG') },
        pcg: at.length ? { t: at, v: av, fs: c.rate('ACO') } : null,
        scg: it.length ? { t: it, x: ix, y: iy, z: iz, fs: imuFs } : null,
        ecgBand: s.ecgBand,
        pcgBand: s.heartBand,
        axis: s.scgAxis,
      });
      this.set({ science });
    } catch (e) {
      this.set({ science: null });
      session.log.push(`Science analysis failed: ${String((e as Error).message ?? e)}`);
    }
  }

  // ------------------------------------------------------------- actions --
  /** Call from a screen's effect; returns the cleanup. */
  useScience(): () => void {
    this.scienceUsers++;
    this.lastScience = 0;
    return () => {
      this.scienceUsers = Math.max(0, this.scienceUsers - 1);
    };
  }

  /** Plays a 1 s tone through one audio route and says what happened. */
  async testTone(route: 'ios' | 'web'): Promise<string> {
    return route === 'ios' ? iosTestTone() : playTestTone();
  }

  /** Shows the fall alert and sends the notification, without a fall. */
  testFallAlert(): void {
    const epochMs = Date.now();
    this.set({ fall: { t: 0, impactG: 0, angleDeg: 0, stillnessG: 0, epochMs, heartRate: this.state.vitals.heartRate } });
    void notifyFall(new Date(epochMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' (test)');
  }

  snoozeReattach(minutes: number): void {
    this.snoozeUntil = Date.now() + minutes * 60000;
    this.set({ reattach: false });
  }

  checkContactNow(): void {
    this.poorTimer.reset();
    this.lastQuality = 0;
    this.set({ reattach: false });
  }

  dismissFall(): void {
    this.set({ fall: null });
  }

  private wireSink(): void {
    const need = this.listener.active || this.wav !== null;
    session.clinical.listenSink = need
      ? (values, fs) => {
          this.listener.feed(values, fs);
          this.wav?.write(values, fs);
        }
      : null;
  }

  async startListening(): Promise<void> {
    try {
      await this.listener.start();
    } catch (e) {
      session.log.push(`Could not start listening: ${String((e as Error).message ?? e)}`);
      throw e;
    }
    this.wireSink();
    this.set({ listening: true });
  }

  async stopListening(): Promise<void> {
    await this.listener.stop();
    this.wireSink();
    this.set({ listening: false });
  }

  startRecording(): void {
    if (this.wav) return;
    const name = stampedName('AusculPatch_sound', 'wav');
    this.wav = new WavRecorder(newFile(name));
    this.csvName = session.startPhoneRecording();
    this.hrDuringRecording = [];
    this.wireSink();
    this.set({ recording: { active: true, startedAt: Date.now(), seconds: 0 } });
  }

  stopRecording(): void {
    const wav = this.wav;
    if (!wav) return;
    this.wav = null;
    this.wireSink();
    const seconds = wav.close();
    session.stopPhoneRecording();
    const hr = this.hrDuringRecording;
    recordings.add({
      id: wav.file.name,
      kind: 'live',
      startedAt: this.state.recording.startedAt,
      durationS: seconds,
      avgHeartRate: hr.length ? hr.reduce((a, b) => a + b, 0) / hr.length : null,
      wav: wav.file.name,
      csv: this.csvName,
      bin: null,
      note: 'Heart sound, ECG and motion',
    });
    this.csvName = null;
    this.set({ recording: { active: false, startedAt: 0, seconds: 0 } });
  }
}

export const engine = new LiveEngine();
