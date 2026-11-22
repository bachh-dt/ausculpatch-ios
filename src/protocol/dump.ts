/**
 * Reassembly of a flash dump streamed over BLE. Port of host/ausculpatch/dump.py.
 *
 * The Python version keeps every chunk in memory. A full recording is about
 * 134 MB, which is too much to hold in a phone app's JavaScript heap, so here
 * the bytes go straight to an ImageSink (a file on the phone) at their absolute
 * offset and the assembler only keeps the bookkeeping: which offsets arrived
 * and how long each was. The rules are unchanged: CRC-failed chunks are
 * dropped, gaps are zero-filled to exactly their size, and a resume starts at
 * the first page not fully received.
 */
import * as P from './protocol';
import { readU32be } from './decode';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC32 (IEEE), identical to zlib.crc32. */
export function crc32(data: Uint8Array, start = 0, end = data.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface Gap {
  offset: number;
  length: number;
}

export type DumpEventKind = 'chunk' | 'chunk_crc_error' | 'page_marker' | 'ignored';
export interface DumpEvent {
  kind: DumpEventKind;
  offset?: number;
  length?: number;
  page?: number;
  shouldAck?: boolean;
  progress?: number;
}

/** Where chunk bytes are written. Unwritten bytes must read back as zero. */
export interface ImageSink {
  write(offset: number, bytes: Uint8Array): void;
}

/** In-memory sink, for tests and small dumps. */
export class MemorySink implements ImageSink {
  private buf = new Uint8Array(0);
  size = 0;
  write(offset: number, bytes: Uint8Array): void {
    const end = offset + bytes.length;
    if (end > this.buf.length) {
      const grown = new Uint8Array(Math.max(end, this.buf.length * 2));
      grown.set(this.buf.subarray(0, this.size));
      this.buf = grown;
    }
    this.buf.set(bytes, offset);
    this.size = Math.max(this.size, end);
  }
  image(totalBytes?: number): Uint8Array {
    const n = Math.max(this.size, totalBytes ?? 0);
    const out = new Uint8Array(n);
    out.set(this.buf.subarray(0, Math.min(this.size, n)));
    return out;
  }
}

export class DumpAssembler {
  expectedBytes: number | null = null;
  pageStride = P.PAGE_SIZE;
  session: number | null = null;
  crcFailures = 0;
  duplicateChunks = 0;
  /** offset -> payload length of every chunk received intact. */
  readonly chunks = new Map<number, number>();
  private receivedTotal = 0;

  constructor(public sink: ImageSink = new MemorySink()) {}

  reset(sink?: ImageSink): void {
    this.expectedBytes = null;
    this.pageStride = P.PAGE_SIZE;
    this.session = null;
    this.chunks.clear();
    this.receivedTotal = 0;
    this.crcFailures = 0;
    this.duplicateChunks = 0;
    if (sink) this.sink = sink;
  }

  setExpectedBytes(total: number): void {
    this.expectedBytes = total;
  }

  setGeometry(header: Partial<P.DumpHeader>): void {
    this.expectedBytes = header.totalBytes ?? null;
    this.pageStride = header.stride || P.PAGE_SIZE;
    this.session = header.session ? header.session : null;
  }

  get totalPages(): number | null {
    if (!this.expectedBytes) return null;
    return Math.ceil(this.expectedBytes / this.pageStride);
  }

  receivedBytes(): number {
    return this.receivedTotal;
  }

  private sortedOffsets(): number[] {
    return Array.from(this.chunks.keys()).sort((a, b) => a - b);
  }

  coveredRanges(): [number, number][] {
    const merged: [number, number][] = [];
    for (const start of this.sortedOffsets()) {
      const end = start + (this.chunks.get(start) as number);
      const last = merged[merged.length - 1];
      if (last && start <= last[1]) last[1] = Math.max(last[1], end);
      else merged.push([start, end]);
    }
    return merged;
  }

  private static fullyCovered(ranges: [number, number][], start: number, end: number): boolean {
    for (const [rs, re] of ranges) {
      if (rs <= start && re >= end) return true;
      if (rs > start) break;
    }
    return false;
  }

  /** First page not yet fully received (not one past the highest offset seen). */
  resumePage(): number {
    if (!this.chunks.size) return 0;
    const covered = this.coveredRanges();
    const total = this.totalPages;
    if (total === null) {
      let contiguousEnd = 0;
      for (const [s, e] of covered) {
        if (s > contiguousEnd) break;
        contiguousEnd = Math.max(contiguousEnd, e);
      }
      return Math.floor(contiguousEnd / this.pageStride);
    }
    for (let page = 0; page < total; page++) {
      const ps = page * this.pageStride;
      const pe = Math.min(ps + this.pageStride, this.expectedBytes || ps + this.pageStride);
      if (!DumpAssembler.fullyCovered(covered, ps, pe)) return page;
    }
    return total;
  }

  addPacket(data: Uint8Array): DumpEvent {
    if (data.length < P.DUMP_HDR_LEN) return { kind: 'ignored' };
    const offset = readU32be(data, 0);
    const second = readU32be(data, 4);
    if (offset === P.DUMP_MARKER_OFFSET) return this.pageMarker(second);

    if (data.length === P.DUMP_HDR_LEN) return { kind: 'ignored' };
    if (crc32(data, P.DUMP_HDR_LEN) !== second) {
      this.crcFailures += 1;
      return { kind: 'chunk_crc_error', offset, length: data.length - P.DUMP_HDR_LEN };
    }
    const payload = data.subarray(P.DUMP_HDR_LEN);
    const prev = this.chunks.get(offset);
    if (prev !== undefined) {
      this.duplicateChunks += 1;
      this.receivedTotal -= prev;
    }
    this.chunks.set(offset, payload.length);
    this.receivedTotal += payload.length;
    this.sink.write(offset, payload);
    return { kind: 'chunk', offset, length: payload.length };
  }

  private pageMarker(page: number): DumpEvent {
    const total = this.totalPages;
    let progress: number | undefined;
    let shouldAck = true;
    if (total) {
      progress = Math.min(100, ((page + 1) / total) * 100);
      shouldAck = page % P.BATCH_ACK_PAGES === P.BATCH_ACK_PAGES - 1 || page === total - 1;
    }
    return { kind: 'page_marker', page, shouldAck, progress };
  }

  /** Byte ranges that never arrived intact, including any missing tail. */
  gaps(): Gap[] {
    const gaps: Gap[] = [];
    let cursor = 0;
    for (const offset of this.sortedOffsets()) {
      if (offset > cursor) gaps.push({ offset: cursor, length: offset - cursor });
      cursor = Math.max(cursor, offset + (this.chunks.get(offset) as number));
    }
    if (this.expectedBytes !== null && cursor < this.expectedBytes) {
      gaps.push({ offset: cursor, length: this.expectedBytes - cursor });
    }
    return gaps;
  }

  /** Length of the reassembled image (announced size, or as far as data reached). */
  imageLength(): number {
    let end = 0;
    for (const [o, l] of this.chunks) end = Math.max(end, o + l);
    return Math.max(end, this.expectedBytes ?? 0);
  }

  integrityReport(): string {
    const gaps = this.gaps();
    const lines = [
      `Expected: ${this.expectedBytes ?? 'unknown'} bytes`,
      `Reassembled: ${this.imageLength()} bytes from ${this.chunks.size} chunks (${this.receivedBytes()} bytes received intact)`,
    ];
    if (this.crcFailures) lines.push(`CRC failures: ${this.crcFailures} (those chunks were discarded)`);
    if (this.duplicateChunks) lines.push(`Duplicate chunks: ${this.duplicateChunks}`);
    if (gaps.length) {
      lines.push(`Gaps: ${gaps.length}`);
      for (const g of gaps.slice(0, 20)) lines.push(`  - offset ${g.offset}, ${g.length} bytes`);
      if (gaps.length > 20) lines.push(`  ... and ${gaps.length - 20} more`);
    } else {
      lines.push('Gaps: none - dump is complete');
    }
    return lines.join('\n');
  }
}
