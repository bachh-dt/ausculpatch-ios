/**
 * Recording files on the phone: the dump image sink, buffered CSV writing, and
 * the recordings folder. Everything lives in the app's Documents folder under
 * "recordings", which the Files app can also see (UIFileSharingEnabled).
 */
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import type { FileHandle } from 'expo-file-system';
import { ImageSink } from '../protocol/dump';
import { ImageSource } from '../protocol/flashlog';
import { asciiBytes, CSV_HEADER } from '../protocol/csv';

export function recordingsDir(): Directory {
  const dir = new Directory(Paths.document, 'recordings');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

export function stampedName(prefix: string, ext: string): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${prefix}_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
}

export function newFile(name: string): File {
  const f = new File(recordingsDir(), name);
  if (f.exists) f.delete();
  f.create();
  return f;
}

const ZERO_BLOCK = new Uint8Array(64 * 1024);

/** Writes dump chunks at their absolute offset. Bytes never written stay zero. */
export class FileImageSink implements ImageSink {
  private handle: FileHandle | null;
  size = 0;

  constructor(readonly file: File) {
    this.handle = file.open(FileMode.ReadWrite);
  }

  private extendTo(target: number): void {
    const h = this.handle as FileHandle;
    h.offset = this.size;
    while (this.size < target) {
      const n = Math.min(ZERO_BLOCK.length, target - this.size);
      h.writeBytesSync(n === ZERO_BLOCK.length ? ZERO_BLOCK : ZERO_BLOCK.subarray(0, n));
      this.size += n;
    }
  }

  write(offset: number, bytes: Uint8Array): void {
    if (!this.handle) throw new Error('image file is closed');
    if (offset > this.size) this.extendTo(offset);
    this.handle.offset = offset;
    this.handle.writeBytesSync(bytes);
    this.size = Math.max(this.size, offset + bytes.length);
  }

  /** Zero-fill to the announced size, so page N sits at N x stride. */
  padTo(total: number): void {
    if (this.handle && total > this.size) this.extendTo(total);
  }

  close(): void {
    this.handle?.close();
    this.handle = null;
  }
}

/** Reads the image back a page at a time for decoding. */
export class FileImageSource implements ImageSource {
  private handle: FileHandle;
  readonly length: number;
  constructor(file: File) {
    this.handle = file.open(FileMode.ReadOnly);
    this.length = this.handle.size ?? 0;
  }
  read(offset: number, length: number): Uint8Array {
    this.handle.offset = offset;
    return this.handle.readBytesSync(Math.min(length, this.length - offset));
  }
  close(): void {
    this.handle.close();
  }
}

/** Buffered CSV writer: strings are batched and written as ASCII bytes. */
export class CsvFileWriter {
  private handle: FileHandle | null;
  private pending: string[] = [];
  private pendingLen = 0;
  rows = 0;

  constructor(readonly file: File, private flushAt = 512 * 1024) {
    this.handle = file.open(FileMode.Truncate);
    this.handle.writeBytesSync(asciiBytes(CSV_HEADER));
  }

  write(rows: string, count: number): void {
    if (!rows) return;
    this.pending.push(rows);
    this.pendingLen += rows.length;
    this.rows += count;
    if (this.pendingLen >= this.flushAt) this.flush();
  }

  flush(): void {
    if (!this.handle || !this.pending.length) return;
    this.handle.writeBytesSync(asciiBytes(this.pending.join('')));
    this.pending = [];
    this.pendingLen = 0;
  }

  close(): void {
    this.flush();
    this.handle?.close();
    this.handle = null;
  }

  get isOpen(): boolean {
    return this.handle !== null;
  }
}

export interface RecordingFile {
  name: string;
  uri: string;
  size: number;
  modified: number;
}

export function listRecordings(): RecordingFile[] {
  const out: RecordingFile[] = [];
  for (const item of recordingsDir().list()) {
    if (item instanceof File) {
      out.push({ name: item.name, uri: item.uri, size: item.size ?? 0, modified: item.modificationTime ?? 0 });
    }
  }
  return out.sort((a, b) => b.modified - a.modified);
}
