/**
 * CSV rows in the exact format of host/ausculpatch/storage.py, so recordings
 * from the phone open in the desktop workbench and existing analysis scripts:
 *
 *   Timestamp(us),Device_Index,DataType,Value,Value2..Value6,Epoch_us
 */
import * as P from './protocol';
import { DecodedBatch, imuToEngineeringUnits } from './decode';
import { FlashSample } from './flashlog';

export const VALUE_COLUMNS = 6;
export const CSV_HEADER =
  'Timestamp(us),Device_Index,DataType,Value,Value2,Value3,Value4,Value5,Value6,Epoch_us\n';

const fmtFloat = (v: number) => v.toFixed(4);
const fmtInt = (v: number) => String(v);
const EMPTY = ['', ',', ',,', ',,,', ',,,,', ',,,,,', ',,,,,,'];

export function csvRow(
  timestampUs: number,
  deviceIndex: number,
  channel: string,
  cells: string[],
  epochUs: number | null = null,
): string {
  const n = Math.min(cells.length, VALUE_COLUMNS);
  const values = cells.slice(0, n).join(',') + EMPTY[VALUE_COLUMNS - n];
  return `${timestampUs},${deviceIndex},${channel},${values},${epochUs === null ? '' : epochUs}\n`;
}

/** One sample from a flash image: IMU in g and deg/s, battery in volts. */
export function flashSampleRow(deviceIndex: number, s: FlashSample): string {
  let cells: string[];
  if (s.channel === P.CHANNEL_IMU) cells = imuToEngineeringUnits(s.values).map(fmtFloat);
  else if (s.channel === P.CHANNEL_BATT) cells = [fmtFloat(P.batteryCountsToVolts(s.values[0]))];
  else if (s.channel === P.CHANNEL_TEMP) cells = [fmtFloat(s.values[0])];
  else cells = [fmtInt(s.values[0])];
  return csvRow(s.timestampUs, deviceIndex, s.channel, cells, s.epochUs);
}

/** Everything decoded from one live notification, in the order storage.py writes it. */
export function batchRows(deviceIndex: number, b: DecodedBatch): string {
  let out = '';
  for (const [ts, v] of b.imu) out += csvRow(ts, deviceIndex, P.CHANNEL_IMU, imuToEngineeringUnits(v).map(fmtFloat));
  for (const [ts, c] of b.batt) out += csvRow(ts, deviceIndex, P.CHANNEL_BATT, [fmtFloat(P.batteryCountsToVolts(c))]);
  for (const [ts, c] of b.temp) out += csvRow(ts, deviceIndex, P.CHANNEL_TEMP, [fmtFloat(c)]);
  for (const [ts, v] of b.ecg) out += csvRow(ts, deviceIndex, P.CHANNEL_ECG, [fmtInt(v)]);
  for (const [ts, v] of b.acoustic) out += csvRow(ts, deviceIndex, P.CHANNEL_ACOUSTIC, [fmtInt(v)]);
  return out;
}

/** ASCII string to bytes. CSV here is ASCII only, so this avoids depending on TextEncoder. */
export function asciiBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0x7f;
  return out;
}
