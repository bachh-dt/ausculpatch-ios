/**
 * History on the phone, in SQLite: one row per minute of heart rate, breathing
 * rate and steps, plus a table of events (falls). Live sessions and decoded
 * patch downloads both write here, so Trends shows both.
 */
import { openDatabaseSync, SQLiteDatabase } from 'expo-sqlite';
import { binRows, Bin, MinuteAccumulator, MinuteRow, Period, periodRange } from './aggregate';

export interface HistoryEvent {
  id: number;
  time: number; // epoch ms
  kind: 'fall';
  source: 'live' | 'patch';
  detail: string;
}

interface DbRow {
  minute: number;
  hr_min: number | null;
  hr_max: number | null;
  hr_sum: number;
  hr_n: number;
  br_min: number | null;
  br_max: number | null;
  br_sum: number;
  br_n: number;
  steps: number;
}

export class History {
  private db: SQLiteDatabase;
  readonly live = new MinuteAccumulator();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<() => void>();
  version = 0;

  constructor(name = 'history.db') {
    this.db = openDatabaseSync(name);
    this.db.execSync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS minutes (
        minute INTEGER PRIMARY KEY,
        hr_min REAL, hr_max REAL, hr_sum REAL NOT NULL DEFAULT 0, hr_n INTEGER NOT NULL DEFAULT 0,
        br_min REAL, br_max REAL, br_sum REAL NOT NULL DEFAULT 0, br_n INTEGER NOT NULL DEFAULT 0,
        steps INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        time INTEGER NOT NULL, kind TEXT NOT NULL, source TEXT NOT NULL, detail TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS events_time ON events(time);
    `);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private changed(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  /** Write finished live minutes every 30 s. */
  startAutoFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => this.flushLive(false), 30000);
  }

  flushLive(all: boolean): void {
    const rows = this.live.drain(all ? undefined : Date.now());
    if (rows.length) this.saveRows(rows);
  }

  saveRows(rows: MinuteRow[]): void {
    if (!rows.length) return;
    this.db.withTransactionSync(() => {
      for (const r of rows) {
        this.db.runSync(
          `INSERT INTO minutes (minute, hr_min, hr_max, hr_sum, hr_n, br_min, br_max, br_sum, br_n, steps)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(minute) DO UPDATE SET
             hr_min = CASE WHEN hr_min IS NULL THEN excluded.hr_min WHEN excluded.hr_min IS NULL THEN hr_min ELSE MIN(hr_min, excluded.hr_min) END,
             hr_max = CASE WHEN hr_max IS NULL THEN excluded.hr_max WHEN excluded.hr_max IS NULL THEN hr_max ELSE MAX(hr_max, excluded.hr_max) END,
             hr_sum = hr_sum + excluded.hr_sum, hr_n = hr_n + excluded.hr_n,
             br_min = CASE WHEN br_min IS NULL THEN excluded.br_min WHEN excluded.br_min IS NULL THEN br_min ELSE MIN(br_min, excluded.br_min) END,
             br_max = CASE WHEN br_max IS NULL THEN excluded.br_max WHEN excluded.br_max IS NULL THEN br_max ELSE MAX(br_max, excluded.br_max) END,
             br_sum = br_sum + excluded.br_sum, br_n = br_n + excluded.br_n,
             steps = steps + excluded.steps`,
          [r.minute, r.hrMin, r.hrMax, r.hrSum, r.hrN, r.brMin, r.brMax, r.brSum, r.brN, r.steps],
        );
      }
    });
    this.changed();
  }

  rowsBetween(fromMs: number, toMs: number): MinuteRow[] {
    const rows = this.db.getAllSync<DbRow>(
      'SELECT * FROM minutes WHERE minute >= ? AND minute < ? ORDER BY minute',
      [Math.floor(fromMs / 60000), Math.ceil(toMs / 60000)],
    );
    const saved = rows.map((r) => ({
      minute: r.minute,
      hrMin: r.hr_min,
      hrMax: r.hr_max,
      hrSum: r.hr_sum,
      hrN: r.hr_n,
      brMin: r.br_min,
      brMax: r.br_max,
      brSum: r.br_sum,
      brN: r.br_n,
      steps: r.steps,
    }));
    const pending = this.live.pending().filter((r) => r.minute * 60000 >= fromMs && r.minute * 60000 < toMs);
    return [...saved, ...pending];
  }

  bins(period: Period, now = new Date()): Bin[] {
    const [from, to] = periodRange(period, now);
    return binRows(period, now, this.rowsBetween(from, to));
  }

  stepsToday(now = new Date()): number {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return this.rowsBetween(start, start + 86400000).reduce((s, r) => s + r.steps, 0);
  }

  addEvent(e: Omit<HistoryEvent, 'id'>): void {
    this.db.runSync('INSERT INTO events (time, kind, source, detail) VALUES (?, ?, ?, ?)', [e.time, e.kind, e.source, e.detail]);
    this.changed();
  }

  events(fromMs: number, toMs: number): HistoryEvent[] {
    return this.db.getAllSync<HistoryEvent>('SELECT * FROM events WHERE time >= ? AND time < ? ORDER BY time DESC', [fromMs, toMs]);
  }

  /** CSV of every saved minute, for export. */
  exportCsv(): string {
    this.flushLive(true);
    const rows = this.db.getAllSync<DbRow>('SELECT * FROM minutes ORDER BY minute');
    const lines = ['time_utc,heart_rate_min,heart_rate_mean,heart_rate_max,breathing_min,breathing_mean,breathing_max,steps'];
    const f = (v: number | null) => (v === null ? '' : v.toFixed(1));
    for (const r of rows) {
      lines.push(
        [
          new Date(r.minute * 60000).toISOString(),
          f(r.hr_min),
          f(r.hr_n ? r.hr_sum / r.hr_n : null),
          f(r.hr_max),
          f(r.br_min),
          f(r.br_n ? r.br_sum / r.br_n : null),
          f(r.br_max),
          r.steps,
        ].join(','),
      );
    }
    return lines.join('\n') + '\n';
  }
}
