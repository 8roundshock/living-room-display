import { open, mkdir, lstat, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { PreviewState } from '../shared/contracts.ts';

export const SNAPSHOT_NAME = 'last-screen.png';
const EMPTY: PreviewState = { available: false, capturedAt: null, width: null, height: null };
export type SnapshotPhase = 'empty' | 'capture-started' | 'saved' | 'write-failed' | 'cleared' | 'clear-failed';

/** One app-owned PNG, outside data/backups. No pixels are retained after a request. */
export class SnapshotFile {
  readonly path: string;
  readonly #temporary: string;
  readonly #changed: () => void;
  readonly #replace: typeof rename;
  #state: PreviewState = { ...EMPTY };
  #generation = 0;
  #queue: Promise<unknown> = Promise.resolve();
  #phase: SnapshotPhase = 'empty';
  #writes = 0;
  #failures = 0;

  private constructor(directory: string, changed: () => void, replace: typeof rename) {
    this.path = join(resolve(directory), SNAPSHOT_NAME);
    this.#temporary = join(resolve(directory), '.last-screen.tmp');
    this.#changed = changed; this.#replace = replace;
  }
  static async open(directory: string, changed = () => {}, replace: typeof rename = rename) {
    const store = new SnapshotFile(directory, changed, replace);
    await store.#plainAncestors(directory);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await store.#plainAncestors(directory);
    // A previous session's unobserved desktop is never adopted on startup.
    await store.#remove(store.path); await store.#remove(store.#temporary);
    return store;
  }
  async #plainAncestors(path: string) {
    for (let current = resolve(path); ; current = dirname(current)) {
      try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Snapshot path is linked'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (dirname(current) === current) break;
    }
  }
  async #remove(path: string) {
    try { await this.#plainAncestors(path); await unlink(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  state(): PreviewState { return { ...this.#state }; }
  pipeline() { return { phase: this.#phase, writes: this.#writes, failures: this.#failures }; }
  captureStarted() { this.#phase = 'capture-started'; }
  clear() {
    this.#generation++;
    const visible = this.#state.available;
    this.#state = { ...EMPTY }; this.#phase = 'cleared';
    if (visible) this.#changed();
    this.#queue = this.#queue.catch(() => {}).then(async () => {
      await this.#remove(this.path); await this.#remove(this.#temporary);
    }).catch(() => { this.#phase = 'clear-failed'; this.#failures++; });
    return this.#queue;
  }
  /** A publication may be invalidated while disk IO is pending. Never recreate cleared pixels. */
  write(content: Buffer, capturedAt: string, allowed: () => boolean): Promise<boolean> {
    const generation = this.#generation;
    const task = this.#queue.catch(() => {}).then(async () => {
      let temporaryExists = false;
      try {
        if (generation !== this.#generation || !allowed()) return false;
        const captured = new Date(capturedAt);
        if (!Number.isFinite(captured.getTime()) || content.length < 33 ||
            !content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
            content.toString('ascii', 12, 16) !== 'IHDR') throw new Error('Invalid snapshot');
        const width = content.readUInt32BE(16), height = content.readUInt32BE(20);
        if (!width || !height || width > 4096 || height > 4096 || width * height > 4_194_304 || content.length > 4 * 1024 * 1024) throw new Error('Invalid snapshot');
        await this.#plainAncestors(this.path); await this.#plainAncestors(this.#temporary);
        const handle = await open(this.#temporary, 'wx', 0o600); temporaryExists = true;
        try { await handle.writeFile(content); await handle.utimes(captured, captured); await handle.sync(); }
        finally { await handle.close(); }
        if (generation !== this.#generation || !allowed()) return false;
        // Windows viewers can briefly hold the old file. Never truncate as a fallback.
        for (let attempt = 0; ; attempt++) {
          try { await this.#replace(this.#temporary, this.path); temporaryExists = false; break; }
          catch (error) {
            if (attempt >= 2 || !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
            await new Promise(done => setTimeout(done, 20));
            if (generation !== this.#generation || !allowed()) return false;
          }
        }
        if (generation !== this.#generation || !allowed()) {
          const visible = this.#state.available; this.#state = { ...EMPTY }; this.#phase = 'cleared';
          if (visible) this.#changed();
          await this.#remove(this.path); return false;
        }
        this.#state = { available: true, capturedAt: captured.toISOString(), width, height };
        this.#phase = 'saved'; this.#writes++; this.#changed(); return true;
      } catch {
        this.#phase = 'write-failed'; this.#failures++; return false;
      } finally { if (temporaryExists) await this.#remove(this.#temporary); }
    });
    this.#queue = task;
    return task;
  }
  /** Bytes and timestamp come from one opened version, even during atomic replacement. */
  async read(expectedAt?: string): Promise<{ content: Buffer; preview: PreviewState } | null> {
    const generation = this.#generation, expected = this.#state;
    if (!expected.available || (expectedAt !== undefined && expectedAt !== expected.capturedAt)) return null;
    let content: Buffer | undefined;
    try {
      await this.#plainAncestors(this.path);
      const handle = await open(this.path, 'r');
      let capturedAt: string;
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size < 33 || stat.size > 4 * 1024 * 1024) return null;
        content = await handle.readFile(); capturedAt = stat.mtime.toISOString();
      } finally { await handle.close(); }
      if (generation !== this.#generation || capturedAt !== expected.capturedAt || (expectedAt !== undefined && capturedAt !== expectedAt) ||
          !content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || content.toString('ascii', 12, 16) !== 'IHDR') return null;
      const preview = { available: true, capturedAt, width: content.readUInt32BE(16), height: content.readUInt32BE(20) };
      if (!preview.width || !preview.height || preview.width > 4096 || preview.height > 4096 || preview.width * preview.height > 4_194_304 ||
          preview.width !== expected.width || preview.height !== expected.height) return null;
      const result = { content, preview }; content = undefined; return result;
    } catch { return null; }
    finally { content?.fill(0); }
  }
  async settled() { await this.#queue; }
  /** Order display-pause/session transitions against publication before acknowledging/painting. */
  transition<T>(change: () => T): Promise<T> {
    const task = this.#queue.catch(() => {}).then(change); this.#queue = task; return task;
  }
}
