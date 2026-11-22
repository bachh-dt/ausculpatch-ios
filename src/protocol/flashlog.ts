/**
 * Page-by-page decoding of a downloaded flash image.
 * Port of host/ausculpatch/flashlog.py.
 *
 * The Python reader takes the whole image as bytes. This one reads through an
 * ImageSource so the phone can decode a 134 MB image from disk a page at a time
 * and stream the samples to a CSV file, without holding either in memory.
 */
import * as P from './protocol';
import { crc32 } from './dump';
import { readBe24, readI16le, readU16le, readU32le, readU64le } from './decode';

export const FORMAT_V2 = 'v2';
export const FORMAT_LEGACY = 'legacy';

export const PAGE_OK = 'ok';
export const PAGE_SHORT = 'short';
export const PAGE_BAD_MAGIC = 'bad_magic';
export const PAGE_CRC_ERROR = 'crc_error';
export const PAGE_WRONG_SESSION = 'wrong_session';
export const PAGE_BAD_LENGTH = 'bad_length';

export interface PageInfo {
  index: number;
  status: string;
  seq?: number;
  session?: number;
  payloadLen: number;
}

export interface FlashSample {
  channel: P.ChannelName;
  timestampUs: number;
  values: number[];
  epochUs: number | null;
}

export type SampleSink = (s: FlashSample) => void;

export interface ImageSource {
  length: number;
  read(offset: number, length: number): Uint8Array;
}

export const bytesSource = (image: Uint8Array): ImageSource => ({
  length: image.length,
  read: (o, l) => image.subarray(o, Math.min(o + l, image.length)),
});

export class FlashLogReport {
  format = FORMAT_V2;
  pagesTotal = 0;
  pagesOk = 0;
  rejected: PageInfo[] = [];
  session: number | null = null;
  records = 0;
  samples = 0;
  resyncs = 0;
  firstEpochUs: number | null = null;
  lastEpochUs: number | null = null;

  get pagesRejected(): number {
    return this.rejected.length;
  }
  get durationS(): number {
    if (this.firstEpochUs === null || this.lastEpochUs === null) return 0;
    return (this.lastEpochUs - this.firstEpochUs) / 1e6;
  }
  summary(): string {
    const lines = [`Format: ${this.format}`, `Pages: ${this.pagesOk} good of ${this.pagesTotal}`];
    if (this.session !== null) lines.push(`Session: ${this.session}`);
    lines.push(`Samples decoded: ${this.samples} (from ${this.records} records)`);
    if (this.durationS) lines.push(`Span: ${this.durationS.toFixed(1)} s`);
    if (this.rejected.length) {
      const reasons: Record<string, number> = {};
      for (const p of this.rejected) reasons[p.status] = (reasons[p.status] ?? 0) + 1;
      const detail = Object.keys(reasons)
        .sort()
        .map((r) => `${reasons[r]} ${r}`)
        .join(', ');
      lines.push(`Pages dropped: ${this.pagesRejected} (${detail})`);
      const shown = this.rejected.slice(0, 20).map((p) => String(p.index));
      if (this.rejected.length > 20) shown.push(`... and ${this.rejected.length - 20} more`);
      lines.push(`  at page ${shown.join(', ')}`);
    } else {
      lines.push('Pages dropped: none');
    }
    if (this.resyncs) {
      lines.push(
        `Resyncs: ${this.resyncs} - legacy images have no per-page checksum, so records near these points may be spurious`,
      );
    }
    return lines.join('\n');
  }
}

export function detectFormat(src: ImageSource): string {
  const n = Math.min(4, Math.floor(src.length / P.PAGE_SIZE) + 1);
  for (let i = 0; i < n; i++) {
    const off = i * P.PAGE_SIZE;
    if (off + 4 > src.length) break;
    if (readU32le(src.read(off, 4), 0) === P.LOG_PAGE_MAGIC) return FORMAT_V2;
  }
  return FORMAT_LEGACY;
}

/** Validate one v2 page. Returns the payload (empty when rejected). */
export function checkPage(page: Uint8Array, index: number, session: number | null): [PageInfo, Uint8Array] {
  const empty = new Uint8Array(0);
  if (page.length < P.PAGE_HEADER_LEN) return [{ index, status: PAGE_SHORT, payloadLen: 0 }, empty];
  const magic = readU32le(page, 0);
  const seq = readU32le(page, 4);
  const payloadLen = readU16le(page, 8);
  const pageSession = readU16le(page, 10);
  const crc = readU32le(page, 12);
  if (magic !== P.LOG_PAGE_MAGIC) return [{ index, status: PAGE_BAD_MAGIC, payloadLen: 0 }, empty];
  const info = { index, seq, session: pageSession, payloadLen };
  if (payloadLen > P.PAGE_PAYLOAD_SIZE || page.length < P.PAGE_SIZE) return [{ ...info, status: PAGE_BAD_LENGTH }, empty];
  if (session !== null && pageSession !== session) return [{ ...info, status: PAGE_WRONG_SESSION }, empty];
  if (crc32(page, P.PAGE_HEADER_LEN, P.PAGE_HEADER_LEN + payloadLen) !== crc) {
    return [{ ...info, status: PAGE_CRC_ERROR }, empty];
  }
  return [{ ...info, status: PAGE_OK }, page.subarray(P.PAGE_HEADER_LEN, P.PAGE_HEADER_LEN + payloadLen)];
}

function anchor(ts32: number, anchorTs32: number, anchorEpoch: number): number {
  let delta = (ts32 - anchorTs32) >>> 0;
  if (delta >= 2 ** 31) delta -= 2 ** 32;
  return anchorEpoch + delta;
}

/** Decode one validated page payload. Returns [records, anchorEpoch, anchorTs32]. */
export function decodePageRecords(
  payload: Uint8Array,
  emit: SampleSink,
  anchorEpoch: number | null = null,
  anchorTs32: number | null = null,
): [number, number | null, number | null] {
  let records = 0;
  let idx = 0;
  const length = payload.length;
  const absolute = (ts: number) =>
    anchorEpoch === null || anchorTs32 === null ? null : anchor(ts, anchorTs32, anchorEpoch);

  while (idx < length) {
    const tag = payload[idx];
    if (tag === P.TAG_TIMESYNC && idx + 13 <= length) {
      anchorTs32 = readU32le(payload, idx + 1);
      anchorEpoch = readU64le(payload, idx + 5);
      idx += 13;
      records += 1;
    } else if (tag === P.TAG_IMU && idx + 17 <= length) {
      const ts = readU32le(payload, idx + 1);
      const v: number[] = [];
      for (let i = 0; i < 6; i++) v.push(readI16le(payload, idx + 5 + i * 2));
      emit({ channel: P.CHANNEL_IMU, timestampUs: ts, values: v, epochUs: absolute(ts) });
      idx += 17;
      records += 1;
    } else if (tag === P.TAG_BATT && idx + 7 <= length) {
      const ts = readU32le(payload, idx + 1);
      emit({ channel: P.CHANNEL_BATT, timestampUs: ts, values: [readI16le(payload, idx + 5)], epochUs: absolute(ts) });
      idx += 7;
      records += 1;
    } else if (tag === P.TAG_TEMP && idx + 7 <= length) {
      const ts = readU32le(payload, idx + 1);
      emit({
        channel: P.CHANNEL_TEMP,
        timestampUs: ts,
        values: [readI16le(payload, idx + 5) * P.TEMP_RAW_TO_CELSIUS],
        epochUs: absolute(ts),
      });
      idx += 7;
      records += 1;
    } else if (tag === P.TAG_ECG && idx + 8 <= length) {
      const ts = readU32le(payload, idx + 1);
      emit({ channel: P.CHANNEL_ECG, timestampUs: ts, values: [readBe24(payload, idx + 5)], epochUs: absolute(ts) });
      idx += 8;
      records += 1;
    } else if (tag === P.TAG_ACOUSTIC && idx + P.ACOUSTIC_RECORD_LEN <= length) {
      for (let i = 0; i < P.ACOUSTIC_SAMPLES_PER_CHUNK; i++) {
        const base = idx + 1 + i * P.ACOUSTIC_SAMPLE_STRIDE;
        const ts = readU32le(payload, base);
        const value = readBe24(payload, base + 4);
        if (ts === 0 && value === 0) continue;
        emit({ channel: P.CHANNEL_ACOUSTIC, timestampUs: ts, values: [value], epochUs: absolute(ts) });
      }
      idx += P.ACOUSTIC_RECORD_LEN;
      records += 1;
    } else {
      // The page passed its CRC: anything unparseable is padding or a format
      // disagreement, and guessing through it would only invent records.
      break;
    }
  }
  return [records, anchorEpoch, anchorTs32];
}

/**
 * Incremental reader. Call step() repeatedly until it returns false; the app
 * awaits between steps so the UI keeps drawing during a long decode.
 */
export class FlashImageReader {
  readonly report = new FlashLogReport();
  readonly format: string;
  private next = 0;
  private anchorEpoch: number | null = null;
  private anchorTs32: number | null = null;
  private seenSession: number | null;
  private readonly stride: number;
  readonly pageCount: number;

  constructor(
    private src: ImageSource,
    private emit: SampleSink,
    private session: number | null = null,
    imageFormat?: string,
  ) {
    this.format = imageFormat ?? detectFormat(src);
    this.report.format = this.format;
    this.seenSession = session;
    this.stride = this.format === FORMAT_LEGACY ? P.LEGACY_PAGE_USABLE_SIZE : P.PAGE_SIZE;
    this.pageCount = Math.ceil(src.length / this.stride);
  }

  get pagesDone(): number {
    return this.next;
  }

  /** Decode up to `pages` pages. Returns true while there is more to do. */
  step(pages = 256): boolean {
    const end = Math.min(this.pageCount, this.next + pages);
    for (; this.next < end; this.next++) {
      const start = this.next * this.stride;
      const page = this.src.read(start, this.stride);
      if (this.format === FORMAT_LEGACY) this.legacyPage(page);
      else this.v2Page(page, this.next);
    }
    if (this.next >= this.pageCount) {
      this.report.session = this.format === FORMAT_LEGACY ? null : this.seenSession;
      return false;
    }
    return true;
  }

  run(): FlashLogReport {
    while (this.step(1 << 30));
    return this.report;
  }

  private counting: SampleSink = (s) => {
    this.report.samples += 1;
    this.emit(s);
  };

  private v2Page(page: Uint8Array, index: number): void {
    const r = this.report;
    r.pagesTotal += 1;
    const [info, payload] = checkPage(page, index, this.session);
    if (info.status !== PAGE_OK) {
      r.rejected.push(info);
      return;
    }
    r.pagesOk += 1;
    if (this.seenSession === null) this.seenSession = info.session ?? null;
    const [records, epoch, ts] = decodePageRecords(payload, this.counting, this.anchorEpoch, this.anchorTs32);
    this.anchorEpoch = epoch;
    this.anchorTs32 = ts;
    r.records += records;
    if (epoch !== null) {
      if (r.firstEpochUs === null) r.firstEpochUs = epoch;
      r.lastEpochUs = epoch;
    }
  }

  private legacyPage(page: Uint8Array): void {
    const r = this.report;
    r.pagesTotal += 1;
    r.pagesOk += 1;
    let idx = 0;
    const length = page.length;
    while (idx < length) {
      const tag = page[idx];
      const recLen = P.ALL_RECORD_LENGTHS[tag];
      if (recLen === undefined || idx + recLen > length) {
        if (!P.PADDING_BYTES.includes(tag)) r.resyncs += 1;
        idx += 1;
        continue;
      }
      if (tag === P.TAG_IMU) {
        const v: number[] = [];
        for (let i = 0; i < 6; i++) v.push(readI16le(page, idx + 5 + i * 2));
        this.counting({ channel: P.CHANNEL_IMU, timestampUs: readU32le(page, idx + 1), values: v, epochUs: null });
      } else if (tag === P.TAG_BATT) {
        this.counting({ channel: P.CHANNEL_BATT, timestampUs: readU32le(page, idx + 1), values: [readI16le(page, idx + 5)], epochUs: null });
      } else if (tag === P.TAG_TEMP) {
        this.counting({
          channel: P.CHANNEL_TEMP,
          timestampUs: readU32le(page, idx + 1),
          values: [readI16le(page, idx + 5) * P.TEMP_RAW_TO_CELSIUS],
          epochUs: null,
        });
      } else if (tag === P.TAG_ECG) {
        this.counting({ channel: P.CHANNEL_ECG, timestampUs: readU32le(page, idx + 1), values: [readBe24(page, idx + 5)], epochUs: null });
      } else if (tag === P.TAG_ACOUSTIC) {
        for (let i = 0; i < P.ACOUSTIC_SAMPLES_PER_CHUNK; i++) {
          const base = idx + 1 + i * P.ACOUSTIC_SAMPLE_STRIDE;
          const ts = readU32le(page, base);
          const value = readBe24(page, base + 4);
          if (ts === 0 && value === 0) continue;
          this.counting({ channel: P.CHANNEL_ACOUSTIC, timestampUs: ts, values: [value], epochUs: null });
        }
      }
      idx += recLen;
      r.records += 1;
    }
  }
}

/** Whole-image convenience, mirroring read_flash_image(). */
export function readFlashImage(
  image: Uint8Array,
  session: number | null = null,
  imageFormat?: string,
): [FlashSample[], FlashLogReport] {
  const samples: FlashSample[] = [];
  const reader = new FlashImageReader(bytesSource(image), (s) => samples.push(s), session, imageFormat);
  return [samples, reader.run()];
}
