/**
 * Wire protocol shared with the AusculPatch firmware (protocol version 3).
 *
 * A line-for-line port of host/ausculpatch/protocol.py. Any change here must be
 * made in the firmware and in the Python host at the same time; the tests in
 * __tests__/protocol.test.ts check the same invariants as host/tests.
 */

export const PROTOCOL_VERSION = 3;
export const MIN_SUPPORTED_PROTOCOL = 2;

// GATT ---------------------------------------------------------------------
export const SERVICE_UUID = '00001524-1212-efde-1523-785feabcd123';
export const DATA_CHAR_UUID = '00001529-1212-efde-1523-785feabcd123';
export const LOG_CHAR_UUID = '00001530-1212-efde-1523-785feabcd123';
export const CONFIG_CHAR_UUID = '00001531-1212-efde-1523-785feabcd123';

export const DEVICE_NAME_FILTER = 'auscul';
export const LOG_FRAME_MARKER = 0xdd;

// Record framing (firmware/src/app/app_types.h) -----------------------------
export const TAG_IMU = 0xa4;
export const TAG_BATT = 0xa5;
export const TAG_TEMP = 0xa6;
export const TAG_ECG = 0xa7;
export const TAG_TIMESYNC = 0xa8;
export const TAG_ACOUSTIC = 0xaa;

export const RECORD_LEN: Record<number, number> = {
  [TAG_IMU]: 17,
  [TAG_BATT]: 7,
  [TAG_TEMP]: 7,
  [TAG_ECG]: 8,
  [TAG_TIMESYNC]: 13,
};

export const ACOUSTIC_SAMPLES_PER_CHUNK = 33;
export const ACOUSTIC_SAMPLE_STRIDE = 7;
export const ACOUSTIC_RECORD_LEN = 1 + ACOUSTIC_SAMPLES_PER_CHUNK * ACOUSTIC_SAMPLE_STRIDE;

export const ALL_RECORD_LENGTHS: Record<number, number> = {
  ...RECORD_LEN,
  [TAG_ACOUSTIC]: ACOUSTIC_RECORD_LEN,
};

export const CHANNEL_IMU = 'IMU';
export const CHANNEL_BATT = 'BATT_V';
export const CHANNEL_TEMP = 'TMP';
export const CHANNEL_ECG = 'RESP';
export const CHANNEL_ACOUSTIC = 'ACO';
export type ChannelName =
  | typeof CHANNEL_IMU
  | typeof CHANNEL_BATT
  | typeof CHANNEL_TEMP
  | typeof CHANNEL_ECG
  | typeof CHANNEL_ACOUSTIC;

// Flash geometry (firmware/src/storage/log_format.h) ------------------------
export const PAGE_SIZE = 2048;
export const PAGE_HEADER_LEN = 16;
export const PAGE_PAYLOAD_SIZE = PAGE_SIZE - PAGE_HEADER_LEN;
export const LOG_PAGE_MAGIC = 0x324c5041; // 'APL2' little-endian
export const LEGACY_PAGE_USABLE_SIZE = 2044;

export const DUMP_HDR_LEN = 8;
export const DUMP_MARKER_OFFSET = 0xffffffff;
export const BATCH_ACK_PAGES = 8;
export const PADDING_BYTES = [0x00, 0xff];

// Timebase -----------------------------------------------------------------
export const TIMESTAMP_WRAP_US = 2 ** 32;

// Opcodes (firmware/src/comms/ble_service.c) --------------------------------
export const CMD_SET_GAIN_OFFSET = 0x00;
export const CMD_START_STORE = 0x01;
export const CMD_START_DUMP = 0x02;
export const CMD_FLASH_SELFTEST = 0x03;
export const CMD_DUMP_ACK = 0x04;
export const CMD_SET_RATE = 0x05;
export const CMD_RESET_RATES = 0x06;
export const CMD_QUERY_RATES = 0x07;
export const CMD_SET_DUTY_CYCLE = 0x08;
export const CMD_QUERY_DUTY = 0x09;
export const CMD_QUERY_FLASH = 0x0a;
export const CMD_STOP_STORE = 0x0b;
export const CMD_ERASE_LOG = 0x0c;
export const CMD_QUERY_INFO = 0x0d;

export type RateSensor = 'IMU' | 'BATT' | 'TMP' | 'ECG' | 'ACO';
export const RATE_SENSORS: RateSensor[] = ['ACO', 'ECG', 'IMU', 'TMP', 'BATT'];
export const RATE_SENSOR_IDS: Record<RateSensor, number> = { IMU: 0, BATT: 1, TMP: 2, ECG: 3, ACO: 4 };
export const DEFAULT_RATES_HZ: Record<RateSensor, number> = { IMU: 500, BATT: 1, TMP: 10, ECG: 250, ACO: 2000 };
export const RATE_BOUNDS_HZ: Partial<Record<RateSensor, [number, number]>> = {
  IMU: [1, 1000],
  BATT: [1, 100],
  TMP: [1, 50],
};
export const RATE_CHOICES_HZ: Record<RateSensor, number[]> = {
  IMU: [50, 100, 200, 250, 500, 1000],
  BATT: [1, 2, 5, 10],
  TMP: [1, 2, 5, 10, 20, 50],
  ECG: [125, 250, 500, 1000],
  ACO: [40, 90, 180, 350, 660, 1200, 2000, 4000],
};
export const HARDWARE_RATES_HZ: Partial<Record<RateSensor, number[]>> = {
  ECG: [125, 250, 500, 1000],
  ACO: [40, 90, 180, 350, 660, 1200, 2000, 4000],
};
export const RATE_SENSOR_LABELS: Record<RateSensor, string> = {
  ACO: 'Heart sound (ADS1220)',
  ECG: 'ECG / respiration (ADS1292R)',
  IMU: 'Body motion (BMI270)',
  TMP: 'Skin temperature (TMP117)',
  BATT: 'Battery',
};

// Duty cycle (firmware/src/power/duty_cycle.h) -----------------------------
export const DUTY_SINK_FLASH = 0;
export const DUTY_SINK_LIVE = 1;
export const DUTY_FLAG_ENABLED = 0x01;
export const DUTY_FLAG_SINK_LIVE = 0x02;
export const DUTY_MIN_SECONDS = 1;
export const DUTY_MAX_SECONDS = 86400;
export const DUTY_DEFAULT_ON_SECONDS = 60;
export const DUTY_DEFAULT_OFF_SECONDS = 240;
export const DUTY_TIME_UNITS: Record<string, number> = { seconds: 1, minutes: 60, hours: 3600 };
export const DUTY_STATE_NAMES: Record<number, string> = { 0: 'Off', 1: 'Measuring', 2: 'Idle' };

// Calibration --------------------------------------------------------------
const STANDARD_GRAVITY = 9.80665;
export const IMU_ACCEL_RAW_TO_G = 0.001 / STANDARD_GRAVITY;
export const IMU_GYRO_RAW_TO_DPS = 0.001 * (180.0 / Math.PI);

export const BATT_ADC_FULL_SCALE = 4095.0;
export const BATT_ADC_VREF = 3.6;
export const BATT_DIVIDER_RATIO = 2.0;
export const TEMP_RAW_TO_CELSIUS = 0.01;

export const ADS1292R_CONFIG2 = 0xa0;
export const ADS1292R_CH2SET = 0x60;
export const ADS1292R_PGA_GAIN: Record<number, number> = { 0: 6, 1: 1, 2: 2, 3: 3, 4: 4, 5: 8, 6: 12 };

/** Millivolts at the electrodes per ADC count: (2 x VREF / gain) / 2^24. */
export function ads1292rCountsToMv(config2: number, chset: number): number {
  const vref = config2 & 0x10 ? 4.033 : 2.42;
  const code = (chset >> 4) & 0x07;
  const gain = ADS1292R_PGA_GAIN[code];
  if (gain === undefined) throw new Error(`reserved ADS1292R gain code ${code}`);
  return ((2.0 * vref) / gain / 2 ** 24) * 1000.0;
}

export const ECG_COUNTS_TO_MV = ads1292rCountsToMv(ADS1292R_CONFIG2, ADS1292R_CH2SET);

export function batteryCountsToVolts(counts: number): number {
  return (counts / BATT_ADC_FULL_SCALE) * BATT_ADC_VREF * BATT_DIVIDER_RATIO;
}

/** Mirrors rate_nearest() in rate_config.c; ties go to the lower rate. */
export function nearestHardwareRate(sensor: RateSensor, requestedHz: number): number {
  const choices = HARDWARE_RATES_HZ[sensor];
  if (!choices) {
    const [lo, hi] = RATE_BOUNDS_HZ[sensor] ?? [1, 0xffff];
    return Math.max(lo, Math.min(hi, requestedHz));
  }
  let best = choices[0];
  for (const hz of choices) {
    if (Math.abs(hz - requestedHz) < Math.abs(best - requestedHz)) best = hz;
  }
  return best;
}

// Command builders ---------------------------------------------------------
const u8 = (...bytes: number[]) => Uint8Array.from(bytes);

export function cmdSetGainOffset(gainIndex: number, offset: number): Uint8Array {
  if (!(gainIndex >= 0 && gainIndex <= 7)) throw new RangeError(`gain index out of range: ${gainIndex}`);
  if (!(offset >= 0 && offset <= 255)) throw new RangeError(`offset out of range: ${offset}`);
  return u8(CMD_SET_GAIN_OFFSET, gainIndex, offset);
}
export const cmdStartStore = () => u8(CMD_START_STORE);
export const cmdStopStore = () => u8(CMD_STOP_STORE);
export function cmdStartDump(startPage = 0): Uint8Array {
  if (!(startPage >= 0 && startPage <= 0xffff)) throw new RangeError(`start page out of range: ${startPage}`);
  return u8(CMD_START_DUMP, (startPage >> 8) & 0xff, startPage & 0xff);
}
export const cmdFlashSelftest = () => u8(CMD_FLASH_SELFTEST);
export const cmdDumpAck = () => u8(CMD_DUMP_ACK);
export const cmdEraseLog = () => u8(CMD_ERASE_LOG);
export function cmdSetRate(sensor: RateSensor, hz: number): Uint8Array {
  const id = RATE_SENSOR_IDS[sensor];
  if (id === undefined) throw new RangeError(`unknown sensor ${sensor}`);
  if (!(hz >= 0 && hz <= 0xffff)) throw new RangeError(`rate out of range: ${hz}`);
  return u8(CMD_SET_RATE, id, (hz >> 8) & 0xff, hz & 0xff);
}
export const cmdResetRates = () => u8(CMD_RESET_RATES);
export const cmdQueryRates = () => u8(CMD_QUERY_RATES);
export function cmdSetDutyCycle(enabled: boolean, onSeconds: number, offSeconds: number, sink = DUTY_SINK_FLASH): Uint8Array {
  for (const [name, v] of [['onSeconds', onSeconds], ['offSeconds', offSeconds]] as const) {
    if (!(Number.isInteger(v) && v >= DUTY_MIN_SECONDS && v <= DUTY_MAX_SECONDS)) {
      throw new RangeError(`${name} must be between ${DUTY_MIN_SECONDS} and ${DUTY_MAX_SECONDS} seconds, got ${v}`);
    }
  }
  if (sink !== DUTY_SINK_FLASH && sink !== DUTY_SINK_LIVE) throw new RangeError(`unknown sink ${sink}`);
  const flags = (enabled ? DUTY_FLAG_ENABLED : 0) | (sink === DUTY_SINK_LIVE ? DUTY_FLAG_SINK_LIVE : 0);
  const out = new Uint8Array(10);
  const view = new DataView(out.buffer);
  out[0] = CMD_SET_DUTY_CYCLE;
  out[1] = flags;
  view.setUint32(2, onSeconds, false);
  view.setUint32(6, offSeconds, false);
  return out;
}
export const cmdQueryDuty = () => u8(CMD_QUERY_DUTY);
export const cmdQueryFlash = () => u8(CMD_QUERY_FLASH);
export const cmdQueryInfo = () => u8(CMD_QUERY_INFO);

// Log-line parsing ---------------------------------------------------------
function parseKeyValues(message: string, prefix: string): Record<string, string> | null {
  const at = message.indexOf(prefix);
  if (at < 0) return null;
  const payload = message.slice(at + prefix.length).trim();
  const fields: Record<string, string> = {};
  let any = false;
  for (const part of payload.split(',')) {
    const eq = part.indexOf('=');
    if (eq >= 0) {
      fields[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
      any = true;
    }
  }
  return any ? fields : null;
}

/** Python int(x, 0): accepts 0x.., 0o.., 0b.. and decimal. */
function parseIntBase0(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^([+-]?)0x([0-9a-f]+)$/))) return (m[1] === '-' ? -1 : 1) * parseInt(m[2], 16);
  if ((m = s.match(/^([+-]?)0b([01]+)$/))) return (m[1] === '-' ? -1 : 1) * parseInt(m[2], 2);
  if ((m = s.match(/^([+-]?)0o([0-7]+)$/))) return (m[1] === '-' ? -1 : 1) * parseInt(m[2], 8);
  if (/^[+-]?\d+$/.test(s)) return parseInt(s, 10);
  return null;
}
function parseIntBase10(raw: string): number | null {
  const s = raw.trim();
  return /^[+-]?\d+$/.test(s) ? parseInt(s, 10) : null;
}

export type Rates = Partial<Record<RateSensor, number>> & Record<string, number>;
export function parseRatesLog(message: string): Rates | null {
  const fields = parseKeyValues(message, 'RATES:');
  if (!fields) return null;
  const rates: Record<string, number> = {};
  let any = false;
  for (const [k, v] of Object.entries(fields)) {
    const n = parseIntBase10(v);
    if (n !== null) {
      rates[k] = n;
      any = true;
    }
  }
  return any ? (rates as Rates) : null;
}

export interface DutyStatus {
  enabled: boolean;
  onSeconds: number;
  offSeconds: number;
  sink: number;
  state: number; // 0 off, 1 measuring, 2 idle
  secondsLeft: number;
  bursts: number;
}
export function parseDutyLog(message: string): DutyStatus | null {
  const fields = parseKeyValues(message, 'DUTY:');
  if (!fields) return null;
  const asInt = (k: string, d = 0) => {
    const raw = fields[k];
    if (raw === undefined) return d;
    const n = parseIntBase10(raw);
    return n === null ? d : n;
  };
  const stateMap: Record<string, number> = { OFF: 0, ACTIVE: 1, IDLE: 2 };
  return {
    enabled: asInt('EN') !== 0,
    onSeconds: asInt('ON', DUTY_DEFAULT_ON_SECONDS),
    offSeconds: asInt('OFF', DUTY_DEFAULT_OFF_SECONDS),
    sink: fields.SINK === 'LIVE' ? DUTY_SINK_LIVE : DUTY_SINK_FLASH,
    state: stateMap[fields.STATE ?? 'OFF'] ?? 0,
    secondsLeft: asInt('LEFT'),
    bursts: asInt('BURSTS'),
  };
}

export interface FlashStatus {
  jedecId: number;
  session: number;
  pagesUsed: number;
  pagesTotal: number;
  bytesUsed: number;
  badBlocks: number;
  recovered: boolean;
  full: boolean;
}
export function parseFlashLog(message: string): FlashStatus | null {
  const fields = parseKeyValues(message, 'FLASH:');
  if (!fields) return null;
  const asInt = (k: string, d = 0) => {
    const raw = fields[k];
    if (raw === undefined) return d;
    const n = parseIntBase0(raw);
    return n === null ? d : n;
  };
  return {
    jedecId: asInt('ID'),
    session: asInt('SESSION'),
    pagesUsed: asInt('PAGES'),
    pagesTotal: asInt('TOTAL'),
    bytesUsed: asInt('BYTES'),
    badBlocks: asInt('BAD'),
    recovered: asInt('REC') !== 0,
    full: asInt('FULL') !== 0,
  };
}

export function parseInfoLog(message: string): Record<string, number> | null {
  const fields = parseKeyValues(message, 'INFO:');
  if (!fields) return null;
  const out: Record<string, number> = {};
  let any = false;
  for (const [k, v] of Object.entries(fields)) {
    const n = parseIntBase0(v);
    if (n !== null) {
      out[k.toLowerCase()] = n;
      any = true;
    }
  }
  return any ? out : null;
}

export const RESET_REASON_BITS: [number, string][] = [
  [0x00001, 'reset pin'],
  [0x00002, 'watchdog'],
  [0x00004, 'software reset (reboot, fatal error, or debugger)'],
  [0x00008, 'CPU lockup'],
  [0x10000, 'wake from System OFF (GPIO)'],
  [0x20000, 'wake from System OFF (LPCOMP)'],
  [0x40000, 'debug interface'],
  [0x80000, 'wake from System OFF (NFC)'],
  [0x100000, 'wake from System OFF (VBUS)'],
];
export function describeResetReason(value: number): string {
  if (!value) return 'power-on';
  const names = RESET_REASON_BITS.filter(([bit]) => value & bit).map(([, n]) => n);
  return names.length ? names.join(', ') : `unknown (0x${value.toString(16).toUpperCase()})`;
}
export function resetWasUnexpected(value: number): boolean {
  return (value & (0x2 | 0x4 | 0x8)) !== 0;
}

export interface DumpHeader {
  totalBytes: number;
  pages: number;
  stride: number;
  session: number;
}
export function parseDumpSizeLog(message: string): number | null {
  const m = message.match(/Dump size:\s*(\d+)\s*bytes/);
  if (m) return parseInt(m[1], 10);
  const at = message.indexOf('TotalBytes:');
  if (at >= 0) {
    const n = parseIntBase10(message.slice(at + 'TotalBytes:'.length).trim());
    return n;
  }
  return null;
}
export function parseDumpHeaderLog(message: string): DumpHeader | null {
  const size = message.match(/Dump size:\s*(\d+)\s*bytes/);
  if (!size) return null;
  const pages = message.match(/\((\d+)\s*pages\)/);
  const stride = message.match(/stride\s+(\d+)/);
  const session = message.match(/session\s+(\d+)/);
  return {
    totalBytes: parseInt(size[1], 10),
    pages: pages ? parseInt(pages[1], 10) : 0,
    stride: stride ? parseInt(stride[1], 10) : LEGACY_PAGE_USABLE_SIZE,
    session: session ? parseInt(session[1], 10) : 0,
  };
}
export const isDumpStartLog = (m: string) => m.includes('Dumping Flash') || m.includes('Dump size:');
export const isDumpEndLog = (m: string) => m.includes('Dump Complete') || m.includes('Dump FAILED');

// Record encoding (tests and replay) ---------------------------------------
export function encodeImu(ts: number, values: number[]): Uint8Array {
  if (values.length !== 6) throw new Error('IMU record needs 6 values');
  const out = new Uint8Array(17);
  const v = new DataView(out.buffer);
  out[0] = TAG_IMU;
  v.setUint32(1, ts >>> 0, true);
  values.forEach((x, i) => v.setInt16(5 + i * 2, x, true));
  return out;
}
function encodeTsI16(tag: number, ts: number, value: number): Uint8Array {
  const out = new Uint8Array(7);
  const v = new DataView(out.buffer);
  out[0] = tag;
  v.setUint32(1, ts >>> 0, true);
  v.setInt16(5, value, true);
  return out;
}
export const encodeBatt = (ts: number, counts: number) => encodeTsI16(TAG_BATT, ts, counts);
export const encodeTemp = (ts: number, centi: number) => encodeTsI16(TAG_TEMP, ts, centi);
export function encodeEcg(ts: number, value24: number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setUint32(1, ts >>> 0, true);
  out[0] = TAG_ECG;
  const raw = value24 & 0xffffff;
  out[5] = (raw >> 16) & 0xff;
  out[6] = (raw >> 8) & 0xff;
  out[7] = raw & 0xff;
  return out;
}
export function encodeTimesync(ts: number, epochUs: number): Uint8Array {
  const out = new Uint8Array(13);
  const v = new DataView(out.buffer);
  out[0] = TAG_TIMESYNC;
  v.setUint32(1, ts >>> 0, true);
  v.setBigUint64(5, BigInt(epochUs), true);
  return out;
}
export function encodeAcousticChunk(samples: [number, number][]): Uint8Array {
  if (samples.length > ACOUSTIC_SAMPLES_PER_CHUNK) throw new Error('too many acoustic samples');
  const out = new Uint8Array(ACOUSTIC_RECORD_LEN);
  const v = new DataView(out.buffer);
  out[0] = TAG_ACOUSTIC;
  samples.forEach(([ts, value], i) => {
    const base = 1 + i * ACOUSTIC_SAMPLE_STRIDE;
    v.setUint32(base, ts >>> 0, true);
    const raw = value & 0xffffff;
    out[base + 4] = (raw >> 16) & 0xff;
    out[base + 5] = (raw >> 8) & 0xff;
    out[base + 6] = raw & 0xff;
  });
  return out;
}
