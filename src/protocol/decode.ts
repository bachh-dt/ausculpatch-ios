/**
 * Decoding of sample records from one BLE notification.
 * Port of host/ausculpatch/decode.py.
 */
import * as P from './protocol';

export const signExtend24 = (raw: number) => (raw & 0x800000 ? raw - 0x1000000 : raw);

export function readBe24(buf: Uint8Array, offset: number): number {
  return signExtend24((buf[offset] << 16) | (buf[offset + 1] << 8) | buf[offset + 2]);
}
export function readU32le(buf: Uint8Array, o: number): number {
  return (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16)) + buf[o + 3] * 0x1000000;
}
export function readI16le(buf: Uint8Array, o: number): number {
  const v = buf[o] | (buf[o + 1] << 8);
  return v & 0x8000 ? v - 0x10000 : v;
}
export function readU16le(buf: Uint8Array, o: number): number {
  return buf[o] | (buf[o + 1] << 8);
}
/** uint64 little-endian as a double (exact below 2^53 us, about 285 years). */
export function readU64le(buf: Uint8Array, o: number): number {
  return readU32le(buf, o) + readU32le(buf, o + 4) * 0x100000000;
}
export function readU32be(buf: Uint8Array, o: number): number {
  return buf[o] * 0x1000000 + ((buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3]);
}

export type Imu6 = [number, number, number, number, number, number];

/** Samples recovered from one notification, grouped by channel. Each entry is [timestamp_us, value]. */
export interface DecodedBatch {
  imu: [number, Imu6][];
  batt: [number, number][];
  temp: [number, number][];
  ecg: [number, number][];
  acoustic: [number, number][];
  timesync: [number, number] | null;
}

export const emptyBatch = (): DecodedBatch => ({ imu: [], batt: [], temp: [], ecg: [], acoustic: [], timesync: null });

export const batchTotal = (b: DecodedBatch) =>
  b.imu.length + b.batt.length + b.temp.length + b.ecg.length + b.acoustic.length;

/**
 * Decode one data notification. Stops at the first unknown tag or truncated
 * record, which is how the firmware's buffer boundaries present themselves.
 */
export function decodeStream(data: Uint8Array): DecodedBatch {
  const batch = emptyBatch();
  let idx = 0;
  const length = data.length;

  while (idx < length) {
    const tag = data[idx];
    idx += 1;

    if (tag === P.TAG_IMU) {
      if (idx + 16 > length) break;
      const ts = readU32le(data, idx);
      const v: Imu6 = [0, 0, 0, 0, 0, 0];
      for (let i = 0; i < 6; i++) v[i] = readI16le(data, idx + 4 + i * 2);
      batch.imu.push([ts, v]);
      idx += 16;
    } else if (tag === P.TAG_BATT) {
      if (idx + 6 > length) break;
      batch.batt.push([readU32le(data, idx), readI16le(data, idx + 4)]);
      idx += 6;
    } else if (tag === P.TAG_TEMP) {
      if (idx + 6 > length) break;
      batch.temp.push([readU32le(data, idx), readI16le(data, idx + 4) * P.TEMP_RAW_TO_CELSIUS]);
      idx += 6;
    } else if (tag === P.TAG_ECG) {
      if (idx + 7 > length) break;
      batch.ecg.push([readU32le(data, idx), readBe24(data, idx + 4)]);
      idx += 7;
    } else if (tag === P.TAG_TIMESYNC) {
      if (idx + 12 > length) break;
      batch.timesync = [readU32le(data, idx), readU64le(data, idx + 4)];
      idx += 12;
    } else if (tag === P.TAG_ACOUSTIC) {
      const chunkBytes = P.ACOUSTIC_SAMPLES_PER_CHUNK * P.ACOUSTIC_SAMPLE_STRIDE;
      if (idx + chunkBytes > length) break;
      for (let i = 0; i < P.ACOUSTIC_SAMPLES_PER_CHUNK; i++) {
        const base = idx + i * P.ACOUSTIC_SAMPLE_STRIDE;
        const ts = readU32le(data, base);
        const value = readBe24(data, base + 4);
        // Zeroed slots are padding from a burst that ended mid-chunk.
        if (ts === 0 && value === 0) continue;
        batch.acoustic.push([ts, value]);
      }
      idx += chunkBytes;
    } else {
      break;
    }
  }
  return batch;
}

/** Raw 32-bit timestamps (in acquisition order) to seconds from the first sample. */
export function unwrapTimestamps(timestamps: number[]): number[] {
  if (!timestamps.length) return [];
  const out: number[] = [];
  let offset = 0;
  let last = timestamps[0];
  for (const raw of timestamps) {
    if (raw < last - P.TIMESTAMP_WRAP_US / 2) offset += P.TIMESTAMP_WRAP_US;
    last = raw;
    out.push(raw + offset);
  }
  const origin = out[0];
  return out.map((v) => (v - origin) / 1e6);
}

/** Raw IMU values to (ax_g, ay_g, az_g, gx_dps, gy_dps, gz_dps). */
export function imuToEngineeringUnits(v: ArrayLike<number>): Imu6 {
  if (v.length !== 6) throw new Error('expected 6 raw IMU values');
  return [
    v[0] * P.IMU_ACCEL_RAW_TO_G,
    v[1] * P.IMU_ACCEL_RAW_TO_G,
    v[2] * P.IMU_ACCEL_RAW_TO_G,
    v[3] * P.IMU_GYRO_RAW_TO_DPS,
    v[4] * P.IMU_GYRO_RAW_TO_DPS,
    v[5] * P.IMU_GYRO_RAW_TO_DPS,
  ];
}
