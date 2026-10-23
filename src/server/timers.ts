import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Timer, TimerInput, TimerPatch } from '../shared/contracts.ts';
import { KEEP_DONE_MS, TIMER_LIMIT, TIMER_MAX_MS, TIMER_MESSAGES, timerDoneAt, timerPhase, timerRemaining } from '../shared/timers.ts';
import { atomicWrite, type StoreFiles } from './store.ts';
import { timersFileSchema } from './validation.ts';

export const TIMERS_FILE = 'timers.json';
export const TIMERS_CORRUPT_FILE = 'timers.corrupt.json';

/** A timer request the store refused, with the HTTP status the API answers with. */
export class TimerError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/** Done timers kept for Home: those that finished less than an hour ago (#438). */
function kept(timers: readonly Timer[], now: number): Timer[] {
  return timers.filter(timer => { const doneAt = timerDoneAt(timer, now); return doneAt === null || now - doneAt < KEEP_DONE_MS; });
}

/**
 * Silent timers (#438) in their own `timers.json` sidecar, beside but never inside `state.json`: the
 * previous release never opens this file, so timers need no rollback exception, and timer churn never
 * rotates `state.backup.json`. Writes are atomic (mode 0600, no backup copy) and serialized on this
 * store's own queue, so a slow settings save (a large photo) never delays a tap. Labels are private
 * user content: nothing here logs them.
 */
export class TimerStore {
  readonly directory: string;
  /** Set when the file could not be read at startup and was moved aside; cleared by the next timer write. */
  warning: string | null = null;
  #timers: Timer[];
  #files: StoreFiles;
  #queue: Promise<unknown> = Promise.resolve();
  #changes = 0;
  private constructor(directory: string, timers: Timer[], files: StoreFiles) { this.directory = directory; this.#timers = timers; this.#files = files; }

  /**
   * Reads `timers.json` (a missing file is no timers). Done timers older than an hour are pruned, and
   * the file is rewritten only when that removed something. An unreadable or invalid file is moved to
   * `timers.corrupt.json` and the store starts empty with a warning; `state.json` is never touched.
   * Run after DataStore.open, which removes stale `timers.json.<uuid>.tmp` files.
   */
  static async open(directory: string, now: number, overrides: Partial<StoreFiles> = {}): Promise<TimerStore> {
    const files: StoreFiles = { rename, ...overrides };
    const path = join(directory, TIMERS_FILE);
    let text: string | null = null;
    try { text = await readFile(path, 'utf8'); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (text === null) return new TimerStore(directory, [], files);
    let timers: Timer[];
    try { timers = timersFileSchema.parse(JSON.parse(text)).timers; } catch {
      const corrupt = join(directory, TIMERS_CORRUPT_FILE);
      try { await files.rename(path, corrupt); } catch {
        // Held by another process: keep a copy aside; the next timer write replaces the unreadable file.
        await writeFile(corrupt, text, { mode: 0o600 });
        await rm(path, { force: true }).catch(() => undefined);
      }
      const store = new TimerStore(directory, [], files);
      store.warning = TIMER_MESSAGES.cleared;
      return store;
    }
    const store = new TimerStore(directory, kept(timers, now), files);
    if (store.#timers.length !== timers.length) await store.#write(store.#timers);
    return store;
  }

  /** Writes since this process opened the store, for `GET /api/changes`. */
  get changes(): number { return this.#changes; }

  /** The timers Home still lists (done ones for an hour), pruned in memory only: a read never writes. */
  list(now: number): Timer[] { return structuredClone(kept(this.#timers, now)); }

  async #write(timers: Timer[]): Promise<void> {
    await atomicWrite(join(this.directory, TIMERS_FILE), JSON.stringify({ version: 1, timers }, null, 2), this.#files);
  }

  /**
   * One serialized change. `change` returns the next list, or null to write nothing; done timers older
   * than an hour leave in the same write.
   */
  async #update<T>(now: number, change: (timers: Timer[]) => { timers: Timer[] | null; result: T }): Promise<T> {
    const operation = this.#queue.then(async () => {
      const current = kept(this.#timers, now);
      const { timers, result } = change(structuredClone(current));
      if (timers === null) return result;
      const validated = timersFileSchema.parse({ version: 1, timers }).timers;
      await this.#write(validated);
      this.#timers = validated;
      this.#changes++;
      this.warning = null;
      return result;
    });
    this.#queue = operation.catch(() => undefined);
    return operation;
  }

  async create(input: TimerInput, now: number): Promise<Timer> {
    const timestamp = new Date(now).toISOString();
    const remainingMs = input.remainingMs ?? null;
    const timer: Timer = {
      id: randomUUID(), label: (input.label ?? '').trim(), durationMs: input.durationMs,
      endsAt: remainingMs !== null ? null : input.endsAt ?? new Date(now + input.durationMs).toISOString(),
      remainingMs, createdAt: timestamp, updatedAt: timestamp,
    };
    return this.#update(now, timers => {
      if (timers.length >= TIMER_LIMIT) throw new TimerError(409, TIMER_MESSAGES.limit);
      return { timers: [...timers, timer], result: structuredClone(timer) };
    });
  }

  /** Pause, resume, add time or restart. A request that changes nothing writes nothing. */
  async patch(id: string, patch: TimerPatch, now: number): Promise<Timer> {
    return this.#update(now, timers => {
      const index = timers.findIndex(timer => timer.id === id);
      if (index < 0) throw new TimerError(404, TIMER_MESSAGES.notFound);
      const stored = timers[index]!, phase = timerPhase(stored, now);
      let next: Timer | null = null;
      const running = (endsAt: number): Timer => ({ ...stored, endsAt: new Date(endsAt).toISOString(), remainingMs: null });
      if ('paused' in patch) {
        if (phase === 'done') throw new TimerError(409, TIMER_MESSAGES.finished);
        if (patch.paused && phase === 'running') next = { ...stored, endsAt: null, remainingMs: Math.max(1, Math.ceil(timerRemaining(stored, now))) };
        if (!patch.paused && phase === 'paused') next = running(now + stored.remainingMs!);
      } else if ('addMs' in patch) {
        const left = phase === 'done' ? 0 : timerRemaining(stored, now);
        if (left + patch.addMs > TIMER_MAX_MS) throw new TimerError(400, TIMER_MESSAGES.total);
        next = phase === 'paused' ? { ...stored, remainingMs: stored.remainingMs! + patch.addMs }
          : running((phase === 'done' ? now : Date.parse(stored.endsAt!)) + patch.addMs);
      } else {
        next = running(now + stored.durationMs);
      }
      if (!next) return { timers: null, result: structuredClone(stored) };
      next.updatedAt = new Date(now).toISOString();
      timers[index] = next;
      return { timers, result: structuredClone(next) };
    });
  }

  async remove(id: string, now: number): Promise<void> {
    await this.#update(now, timers => {
      if (!timers.some(timer => timer.id === id)) throw new TimerError(404, TIMER_MESSAGES.notFound);
      return { timers: timers.filter(timer => timer.id !== id), result: undefined };
    });
  }

  /** Dismisses every finished timer at once; returns how many. */
  async removeFinished(now: number): Promise<number> {
    return this.#update(now, timers => {
      const left = timers.filter(timer => timerPhase(timer, now) !== 'done');
      const deleted = timers.length - left.length;
      return { timers: deleted ? left : null, result: deleted };
    });
  }
}
