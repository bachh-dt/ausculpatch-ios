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
import { LiveListener, WavRecorder } from '../audio/audio';
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
  };
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

  private steps = new StepCounter();
  private falls = new FallDetector('normal');
  private imuSeen = 0;
  private imuGeneration = -1;

  private listener = new LiveListener();
  private wav: WavRecorder | null = null;
  private csvName: string | null = null;
  private hrDuringRecording: number[] = [];

  constructor() {
    this.state.stepsToday = history.stepsToday();
    this.applySettings();
    settings.subscribe(() => this.applySettings());
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
    this.listener.volume = s.listenVolume;
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
    for (const f of this.falls.process(t, x, y, z, fs)) {
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

  private updateVitals(now: number): void {
    const raw = session.clinical.vitals();
    const { ecgQuality: eq, heartQuality: hq } = this.state;
    const poor = (q: Quality) => q.level === 'poor' || q.level === 'none';
    // Never show a number worked out from a bad signal.
    const vitals: Vitals = {
      ...raw,
      heartRate: poor(eq) ? null : raw.heartRate,
      breathingRate: poor(hq) ? null : raw.breathingRate,
    };
    if (vitals.heartRate !== null || vitals.breathingRate !== null) {
      history.live.addVitals(now, vitals.heartRate, vitals.breathingRate);
    }
    if (this.wav && vitals.heartRate !== null) this.hrDuringRecording.push(vitals.heartRate);
    this.set({ vitals, vitalsAt: now });
  }

  // ------------------------------------------------------------- actions --
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
    await this.listener.start();
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
