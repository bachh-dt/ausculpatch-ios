/**
 * The Recordings list: live recordings made on the phone (sound + ECG + motion)
 * and downloads from the patch. Each entry's details live in
 * recordings/index.json; the data files sit beside it.
 */
import { File } from 'expo-file-system';
import { recordingsDir } from './files';

export interface RecordingMeta {
  id: string;
  kind: 'live' | 'patch';
  startedAt: number; // epoch ms
  durationS: number;
  avgHeartRate: number | null;
  wav: string | null; // file names inside recordings/
  csv: string | null;
  bin: string | null;
  note: string;
}

type Listener = () => void;

class RecordingIndex {
  private items: RecordingMeta[] | null = null;
  private listeners = new Set<Listener>();

  private file(): File {
    return new File(recordingsDir(), 'index.json');
  }

  list(): RecordingMeta[] {
    if (this.items === null) {
      try {
        const f = this.file();
        this.items = f.exists ? (JSON.parse(f.textSync()) as RecordingMeta[]) : [];
      } catch {
        this.items = [];
      }
      // Drop entries whose files were deleted in the Files app.
      this.items = this.items.filter((m) => [m.wav, m.csv, m.bin].some((n) => n && new File(recordingsDir(), n).exists));
    }
    return [...this.items].sort((a, b) => b.startedAt - a.startedAt);
  }

  add(m: RecordingMeta): void {
    this.list();
    this.items = [...(this.items ?? []).filter((x) => x.id !== m.id), m];
    this.save();
  }

  remove(id: string): void {
    const m = this.list().find((x) => x.id === id);
    if (!m) return;
    for (const n of [m.wav, m.csv, m.bin]) {
      if (!n) continue;
      const f = new File(recordingsDir(), n);
      if (f.exists) f.delete();
    }
    this.items = (this.items ?? []).filter((x) => x.id !== id);
    this.save();
  }

  uri(name: string | null): string | null {
    return name ? new File(recordingsDir(), name).uri : null;
  }

  private save(): void {
    const f = this.file();
    if (!f.exists) f.create();
    f.writeSync(JSON.stringify(this.items ?? [], null, 1));
    for (const fn of this.listeners) fn();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export const recordings = new RecordingIndex();
