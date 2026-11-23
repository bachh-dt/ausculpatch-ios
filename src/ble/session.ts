/**
 * One AusculPatch, connected over Bluetooth. Port of host/ausculpatch/ble.py and
 * host/ausculpatch/ui/session.py, merged, for a phone that talks to one patch.
 *
 * Notification routing follows the Python host exactly:
 *   - first byte 0xDD: a log line on the Log characteristic
 *   - otherwise, while a dump is running: a dump packet
 *   - otherwise: sensor records
 * Dump routing starts when we WRITE 0x02, not when "Dump size:" arrives,
 * because the Log subscription can lag behind the Data subscription.
 */
import { BleError, BleManager, Characteristic, Device, State, Subscription } from 'react-native-ble-plx';
import { File } from 'expo-file-system';
import * as P from '../protocol/protocol';
import { batchTotal, decodeStream } from '../protocol/decode';
import { DumpAssembler } from '../protocol/dump';
import { FlashImageReader } from '../protocol/flashlog';
import { batchRows, flashSampleRow } from '../protocol/csv';
import { LiveBuffers } from '../live/buffers';
import { ClinicalPipeline } from '../live/clinical';
import { base64ToBytes, bytesToBase64, toHex, utf8Decode } from '../util/base64';
import { CsvFileWriter, FileImageSink, FileImageSource, newFile, stampedName } from '../storage/files';
import { OfflineAnalyzer } from '../analysis/offline';
import { history, settings } from '../app/services';
import { recordings } from '../storage/recordings';

export const RECONNECT_INTERVAL_MS = 2000;
export const SCAN_TIMEOUT_MS = 10000;
const DEVICE_INDEX = 0;
const MAX_LOG_LINES = 400;
/** No dump packet for this long means the download has stalled. */
const DUMP_STALL_MS = 15000;

export interface FoundDevice {
  id: string;
  name: string;
  rssi: number | null;
}

export interface DownloadState {
  phase: 'idle' | 'receiving' | 'decoding' | 'done' | 'interrupted';
  progress: number; // percent of the current phase
  headline: string;
  report: string;
  ok: boolean;
  csvUri: string | null;
  binUri: string | null;
  canResume: boolean;
}

export interface SessionState {
  bluetooth: State;
  scanning: boolean;
  found: FoundDevice[];
  status: string;
  connected: boolean;
  deviceName: string | null;
  mtu: number | null;
  info: Record<string, number> | null;
  rates: Partial<Record<P.RateSensor, number>>;
  duty: P.DutyStatus | null;
  flash: P.FlashStatus | null;
  download: DownloadState;
  phoneRecording: { active: boolean; name: string | null; rows: number };
  logVersion: number;
}

const idleDownload = (): DownloadState => ({
  phase: 'idle',
  progress: 0,
  headline: '',
  report: '',
  ok: false,
  csvUri: null,
  binUri: null,
  canResume: false,
});

type Listener = () => void;

export class PatchSession {
  readonly manager = new BleManager();
  readonly buffers = new LiveBuffers();
  readonly clinical: ClinicalPipeline;
  readonly log: string[] = [];

  state: SessionState = {
    bluetooth: State.Unknown,
    scanning: false,
    found: [],
    status: 'Not connected',
    connected: false,
    deviceName: null,
    mtu: null,
    info: null,
    rates: { ...P.DEFAULT_RATES_HZ },
    duty: null,
    flash: null,
    download: idleDownload(),
    phoneRecording: { active: false, name: null, rows: 0 },
    logVersion: 0,
  };

  private listeners = new Set<Listener>();
  private device: Device | null = null;
  private deviceId: string | null = null;
  private shouldReconnect = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  private subs: Subscription[] = [];
  private disconnectSub: Subscription | null = null;
  private writeChain: Promise<unknown> = Promise.resolve();

  private dumping = false;
  private assembler = new DumpAssembler();
  private dumpSink: FileImageSink | null = null;
  private dumpFile: File | null = null;
  private lastDumpPacket = 0;
  private stallTimer: ReturnType<typeof setInterval> | null = null;

  private phoneCsv: CsvFileWriter | null = null;
  private phoneCsvTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.clinical = new ClinicalPipeline(this.buffers, () => this.state.rates, settings.get());
    this.manager.onStateChange((s) => this.set({ bluetooth: s }), true);
  }

  // ---------------------------------------------------------------- state --
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private set(patch: Partial<SessionState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }
  private setDownload(patch: Partial<DownloadState>): void {
    this.set({ download: { ...this.state.download, ...patch } });
  }
  private addLog(line: string): void {
    const t = new Date();
    const stamp = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
    this.log.push(`${stamp}  ${line}`);
    if (this.log.length > MAX_LOG_LINES) this.log.splice(0, this.log.length - MAX_LOG_LINES);
    this.set({ logVersion: this.state.logVersion + 1 });
  }

  // ----------------------------------------------------------------- scan --
  startScan(): void {
    if (this.state.scanning) return;
    this.set({ scanning: true, found: [] });
    this.manager
      .startDeviceScan(null, { allowDuplicates: false }, (error, dev) => {
        if (error) {
          this.addLog(`Scan failed: ${error.message}`);
          this.stopScan();
          return;
        }
        if (!dev) return;
        const name = dev.name ?? dev.localName ?? '';
        if (!name.toLowerCase().includes(P.DEVICE_NAME_FILTER)) return;
        if (this.state.found.some((d) => d.id === dev.id)) return;
        this.set({ found: [...this.state.found, { id: dev.id, name, rssi: dev.rssi }] });
      })
      .catch((e: Error) => {
        this.addLog(`Scan failed: ${e.message}`);
        this.set({ scanning: false });
      });
    this.scanTimer = setTimeout(() => this.stopScan(), SCAN_TIMEOUT_MS);
  }

  stopScan(): void {
    if (this.scanTimer) clearTimeout(this.scanTimer);
    this.scanTimer = null;
    this.manager.stopDeviceScan().catch(() => undefined);
    this.set({ scanning: false });
  }

  // -------------------------------------------------------------- connect --
  async connect(id: string, name: string): Promise<void> {
    this.stopScan();
    this.shouldReconnect = true;
    this.deviceId = id;
    this.set({ status: 'Connecting...', deviceName: name });
    try {
      await this.openClient(id);
    } catch (e) {
      this.set({ status: `Could not connect: ${(e as Error).message}` });
      this.scheduleReconnect();
    }
  }

  private async openClient(id: string): Promise<void> {
    const dev = await this.manager.connectToDevice(id, { timeout: 10000 });
    await dev.discoverAllServicesAndCharacteristics();
    const chars = await this.manager.characteristicsForDevice(id, P.SERVICE_UUID);
    const have = new Set(chars.map((c) => c.uuid.toLowerCase()));
    const missing = [P.DATA_CHAR_UUID, P.CONFIG_CHAR_UUID].filter((u) => !have.has(u));
    if (missing.length) {
      await this.manager.cancelDeviceConnection(id).catch(() => undefined);
      throw new Error('the patch did not expose its command characteristic');
    }
    this.device = dev;
    this.set({ mtu: dev.mtu });

    this.disconnectSub?.remove();
    this.disconnectSub = this.manager.onDeviceDisconnected(id, (err) => this.onDisconnected(err));

    this.subs.forEach((s) => s.remove());
    this.subs = [
      this.manager.monitorCharacteristicForDevice(id, P.SERVICE_UUID, P.DATA_CHAR_UUID, (e, c) => this.onNotify(e, c)),
    ];
    if (have.has(P.LOG_CHAR_UUID)) {
      this.subs.push(
        this.manager.monitorCharacteristicForDevice(id, P.SERVICE_UUID, P.LOG_CHAR_UUID, (e, c) => this.onNotify(e, c)),
      );
    }

    this.buffers.clear();
    this.set({ connected: true, status: 'Connected' });
    this.addLog(`Connected to ${this.state.deviceName ?? id} (MTU ${dev.mtu})`);
    // Let the subscriptions land before asking for status.
    setTimeout(() => this.refreshAll(), 400);
  }

  private onDisconnected(err: BleError | null): void {
    this.subs.forEach((s) => s.remove());
    this.subs = [];
    this.device = null;
    if (this.dumping) this.interruptDownload('The connection dropped during the download.');
    this.dumping = false;
    this.set({ connected: false, mtu: null });
    if (err) this.addLog(`Disconnected: ${err.message}`);
    if (this.shouldReconnect) {
      this.set({ status: 'Connection lost. Reconnecting...' });
      this.scheduleReconnect();
    } else {
      this.set({ status: 'Not connected' });
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.shouldReconnect || !this.deviceId) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (!this.shouldReconnect || !this.deviceId || this.state.connected) return;
      try {
        await this.openClient(this.deviceId);
      } catch {
        this.scheduleReconnect();
      }
    }, RECONNECT_INTERVAL_MS);
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopPhoneRecording();
    const id = this.deviceId;
    if (id) await this.manager.cancelDeviceConnection(id).catch(() => undefined);
    this.set({ connected: false, status: 'Not connected', info: null, duty: null, flash: null });
  }

  // -------------------------------------------------------------- command --
  send(payload: Uint8Array): Promise<void> {
    const id = this.deviceId;
    if (!id || !this.state.connected) {
      this.addLog('Not connected: command not sent');
      return Promise.resolve();
    }
    const job = this.writeChain.then(async () => {
      try {
        await this.manager.writeCharacteristicWithoutResponseForDevice(
          id,
          P.SERVICE_UUID,
          P.CONFIG_CHAR_UUID,
          bytesToBase64(payload),
        );
        if (payload[0] === P.CMD_START_DUMP || payload[0] === P.CMD_FLASH_SELFTEST) {
          this.dumping = payload[0] === P.CMD_START_DUMP;
        }
        if (payload[0] !== P.CMD_DUMP_ACK) this.addLog(`> ${toHex(payload)}`);
      } catch (e) {
        this.addLog(`Command failed: ${(e as Error).message}`);
      }
    });
    this.writeChain = job;
    return job;
  }

  refreshAll(): void {
    for (const c of [P.cmdQueryInfo(), P.cmdQueryRates(), P.cmdQueryDuty(), P.cmdQueryFlash()]) this.send(c);
  }

  // --------------------------------------------------------- notification --
  private onNotify(error: BleError | null, ch: Characteristic | null): void {
    if (error || !ch?.value) return;
    const data = base64ToBytes(ch.value);
    if (data.length < 2) return;

    if (data[0] === P.LOG_FRAME_MARKER) {
      this.handleLog(data.subarray(1));
      return;
    }
    if (this.dumping) {
      this.onDumpPacket(data);
      return;
    }
    const batch = decodeStream(data);
    if (batchTotal(batch) === 0) return;
    this.buffers.addBatch(batch);
    if (this.phoneCsv?.isOpen) this.phoneCsv.write(batchRows(DEVICE_INDEX, batch), batchTotal(batch));
  }

  private handleLog(raw: Uint8Array): void {
    const message = utf8Decode(raw).trim();

    const header = P.parseDumpHeaderLog(message);
    if (header) this.onDumpHeader(header);
    else if (message.includes('TotalBytes:')) {
      const total = P.parseDumpSizeLog(message);
      if (total !== null) this.onDumpHeader({ totalBytes: total });
    }

    const rates = P.parseRatesLog(message);
    const duty = rates ? null : P.parseDutyLog(message);
    const flash = rates || duty ? null : P.parseFlashLog(message);
    const info = rates || duty || flash ? null : P.parseInfoLog(message);
    if (rates) this.set({ rates: { ...this.state.rates, ...rates } });
    if (duty) this.set({ duty });
    if (flash) this.set({ flash });
    if (info) this.set({ info });

    if (P.isDumpStartLog(message)) this.dumping = true;
    else if (P.isDumpEndLog(message)) {
      const wasDumping = this.dumping || this.state.download.phase === 'receiving';
      this.dumping = false;
      if (wasDumping) void this.finishDownload(message);
    } else if (message.includes('Dump suspended')) {
      this.dumping = false;
      this.interruptDownload(message);
    }
    this.addLog(message);
  }

  // ---------------------------------------------------------- flash dump --
  /** Start a download, or resume an interrupted one from its first missing page. */
  startDownload(resume = false): void {
    if (!this.state.connected) return;
    let startPage = 0;
    if (resume && this.dumpFile && this.state.download.canResume) {
      startPage = this.assembler.resumePage();
      if (!this.dumpSink) this.dumpSink = new FileImageSink(this.dumpFile);
      this.assembler.sink = this.dumpSink;
    } else {
      this.dumpSink?.close();
      this.dumpFile = newFile(stampedName('AusculPatch_flash', 'bin'));
      this.dumpSink = new FileImageSink(this.dumpFile);
      this.assembler.reset(this.dumpSink);
    }
    this.set({
      download: {
        ...idleDownload(),
        phase: 'receiving',
        headline: resume ? `Resuming from page ${startPage}...` : 'Downloading from the patch...',
      },
    });
    this.lastDumpPacket = Date.now();
    this.startStallWatch();
    void this.send(P.cmdStartDump(startPage));
  }

  private startStallWatch(): void {
    if (this.stallTimer) clearInterval(this.stallTimer);
    this.stallTimer = setInterval(() => {
      if (this.state.download.phase !== 'receiving') {
        if (this.stallTimer) clearInterval(this.stallTimer);
        this.stallTimer = null;
        return;
      }
      if (Date.now() - this.lastDumpPacket > DUMP_STALL_MS) {
        this.dumping = false;
        this.interruptDownload('No data from the patch for 15 seconds.');
      }
    }, 2000);
  }

  private onDumpHeader(header: Partial<P.DumpHeader>): void {
    if (header.stride !== undefined) this.assembler.setGeometry(header);
    else this.assembler.setExpectedBytes(header.totalBytes ?? 0);
  }

  private onDumpPacket(data: Uint8Array): void {
    // Only a download this app started has somewhere to put the bytes.
    if (this.state.download.phase !== 'receiving') return;
    this.lastDumpPacket = Date.now();
    let event;
    try {
      event = this.assembler.addPacket(data);
    } catch (e) {
      this.addLog(`Could not write the download to the phone: ${(e as Error).message}`);
      this.dumping = false;
      this.interruptDownload('Writing the download to the phone failed.');
      return;
    }
    if (event.kind === 'page_marker') {
      if (event.progress !== undefined) this.setDownload({ progress: event.progress });
      if (event.shouldAck) void this.send(P.cmdDumpAck());
    }
  }

  private interruptDownload(reason: string): void {
    if (this.state.download.phase !== 'receiving') return;
    const page = this.assembler.resumePage();
    this.setDownload({
      phase: 'interrupted',
      ok: false,
      canResume: this.assembler.chunks.size > 0,
      headline: `Download interrupted at page ${page}.`,
      report: `${reason}\n\n${this.assembler.integrityReport()}`,
    });
  }

  private async finishDownload(message: string): Promise<void> {
    const ok = !message.includes('FAILED') && !message.toLowerCase().includes('suspended');
    const sink = this.dumpSink;
    const binFile = this.dumpFile;
    if (!sink || !binFile) {
      this.setDownload({ phase: 'done', ok, headline: message, report: message });
      return;
    }
    if (this.assembler.expectedBytes) sink.padTo(this.assembler.expectedBytes);
    sink.close();
    this.dumpSink = null;

    if (this.assembler.imageLength() === 0) {
      binFile.delete();
      this.dumpFile = null;
      this.setDownload({
        phase: 'done',
        ok,
        progress: 100,
        headline: 'The patch has no recording stored. Nothing to download.',
        report: message,
      });
      return;
    }

    this.setDownload({ phase: 'decoding', progress: 0, headline: 'Decoding the recording...' });
    let csv: CsvFileWriter | null = null;
    let source: FileImageSource | null = null;
    try {
      source = new FileImageSource(binFile);
      const csvFile = newFile(binFile.name.replace(/\.bin$/, '.csv'));
      csv = new CsvFileWriter(csvFile);
      const writer = csv;
      let rows = '';
      let count = 0;
      const analyzer = new OfflineAnalyzer(settings.get(), this.state.rates);
      const reader = new FlashImageReader(
        source,
        (s) => {
          rows += flashSampleRow(DEVICE_INDEX, s);
          count++;
          analyzer.push(s);
        },
        this.assembler.session,
      );
      let more = true;
      while (more) {
        more = reader.step(64);
        writer.write(rows, count);
        rows = '';
        count = 0;
        this.setDownload({ progress: (100 * reader.pagesDone) / Math.max(1, reader.pageCount) });
        await new Promise((r) => setTimeout(r, 0));
      }
      writer.close();
      source.close();

      const gaps = this.assembler.gaps();
      const analysis = analyzer.finish();
      history.saveRows(analysis.rows);
      for (const f of analysis.falls) {
        history.addEvent({
          time: f.epochMs,
          kind: 'fall',
          source: 'patch',
          detail: JSON.stringify({ impactG: f.impactG, angleDeg: f.angleDeg }),
        });
      }
      const hrN = analysis.rows.reduce((a, r) => a + r.hrN, 0);
      const hrSum = analysis.rows.reduce((a, r) => a + r.hrSum, 0);
      const first = analysis.firstEpochMs;
      const last = analysis.lastEpochMs;
      recordings.add({
        id: binFile.name,
        kind: 'patch',
        startedAt: first ?? Date.now(),
        durationS: first !== null && last !== null ? (last - first) / 1000 : 0,
        avgHeartRate: hrN ? hrSum / hrN : null,
        wav: null,
        csv: csvFile.name,
        bin: binFile.name,
        note: 'Downloaded from the patch',
      });
      const historyLine =
        first === null
          ? 'This recording has no clock time, so it was not added to Trends.'
          : `Added ${analysis.rows.length} minutes to Trends` +
            (analysis.falls.length ? `, including ${analysis.falls.length} possible fall(s).` : '.');
      const lines = [
        `Saved ${writer.rows} samples to ${csvFile.name}`,
        historyLine,
        '',
        this.assembler.integrityReport(),
        '',
        reader.report.summary(),
      ];
      if (gaps.length && ok) {
        lines.splice(1, 0, `${gaps.length} chunk(s) were lost in transit. Downloading again with Resume fetches them.`);
      }
      this.setDownload({
        phase: 'done',
        ok: ok && writer.rows > 0,
        progress: 100,
        headline: `Saved ${writer.rows.toLocaleString()} samples.`,
        report: lines.join('\n'),
        csvUri: csvFile.uri,
        binUri: binFile.uri,
        canResume: gaps.length > 0,
      });
    } catch (e) {
      csv?.close();
      source?.close();
      this.setDownload({
        phase: 'done',
        ok: false,
        headline: 'Could not decode the download.',
        report: String((e as Error).message ?? e),
        binUri: binFile.uri,
      });
    }
  }

  dismissDownload(): void {
    this.set({ download: idleDownload() });
  }

  // ----------------------------------------------------- phone recording --
  /** Starts writing every live sample to a CSV and returns its file name. */
  startPhoneRecording(): string {
    this.stopPhoneRecording();
    const file = newFile(stampedName('AusculPatch_live', 'csv'));
    this.phoneCsv = new CsvFileWriter(file, 256 * 1024);
    this.set({ phoneRecording: { active: true, name: file.name, rows: 0 } });
    this.phoneCsvTimer = setInterval(() => {
      this.phoneCsv?.flush();
      this.set({ phoneRecording: { ...this.state.phoneRecording, rows: this.phoneCsv?.rows ?? 0 } });
    }, 1000);
    return file.name;
  }

  stopPhoneRecording(): void {
    if (this.phoneCsvTimer) clearInterval(this.phoneCsvTimer);
    this.phoneCsvTimer = null;
    if (this.phoneCsv) {
      const rows = this.phoneCsv.rows;
      this.phoneCsv.close();
      this.addLog(`Saved ${rows} live samples to ${this.state.phoneRecording.name}`);
    }
    this.phoneCsv = null;
    if (this.state.phoneRecording.active) this.set({ phoneRecording: { ...this.state.phoneRecording, active: false } });
  }
}

export const session = new PatchSession();
