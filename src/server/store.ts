import { mkdir, open, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { defaultSettings } from '../shared/defaults.ts';
import type { Reminder, Settings, SettingsPatch } from '../shared/contracts.ts';
import { checkedPhotoDataSchema, dataSchema, mergeSettings } from './validation.ts';
import { createPhotoAsset, samePhotoAsset, type PhotoAsset } from './photo.ts';
import { persistableData } from './persistence.ts';

export interface PersistedData { version: 1; settings: Settings; reminders: Reminder[]; photoAsset: PhotoAsset | null }
/** File operations a test can replace to inject failures (#247). */
export interface StoreFiles { rename(from: string, to: string): Promise<void> }

export function defaultDataDirectory(): string {
  if (process.env.LRD_DATA_DIR) return resolve(process.env.LRD_DATA_DIR);
  if (process.platform === 'win32') return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'LivingRoomDisplay', 'data');
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'LivingRoomDisplay', 'data');
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'living-room-display');
}

/** Windows reports these while another process (a backup or scanning tool) holds the target open. */
const RETRYABLE_RENAME = new Set(['EPERM', 'EACCES', 'EBUSY']);
/** Waits between rename attempts, about 1 s in total. */
export const RENAME_RETRY_DELAYS_MS = [25, 50, 100, 150, 200, 250, 250];
/** `state.json.<uuid>.tmp` or `state.backup.json.<uuid>.tmp`, as atomicWrite names them. */
const TEMPORARY_FILE = /^state(?:\.backup)?\.json\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/;

async function atomicWrite(path: string, data: string, files: StoreFiles): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(data, 'utf8'); await file.sync(); } finally { await file.close(); }
    for (let attempt = 0; ; attempt++) {
      try { await files.rename(temporary, path); return; } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (!code || !RETRYABLE_RENAME.has(code) || attempt >= RENAME_RETRY_DELAYS_MS.length) throw error;
        await delay(RENAME_RETRY_DELAYS_MS[attempt]);
      }
    }
  } catch (error) {
    // A failed save never leaves a copy of the private state behind (#247).
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Temporary files left by a save that was interrupted before its rename (a crash or power loss). */
async function removeStaleTemporaryFiles(directory: string): Promise<void> {
  for (const name of await readdir(directory)) {
    if (TEMPORARY_FILE.test(name)) await rm(join(directory, name), { force: true }).catch(() => undefined);
  }
}

export class DataStore {
  readonly directory: string;
  warning: string | null = null;
  #data: PersistedData;
  #files: StoreFiles;
  #queue: Promise<unknown> = Promise.resolve();
  private constructor(directory: string, data: PersistedData, files: StoreFiles) { this.directory = directory; this.#data = data; this.#files = files; }

  static async open(directory: string, overrides: Partial<StoreFiles> = {}): Promise<DataStore> {
    const files: StoreFiles = { rename, ...overrides };
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await removeStaleTemporaryFiles(directory);
    const path = join(directory, 'state.json');
    let primary: string | null = null;
    try { primary = await readFile(path, 'utf8'); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (primary !== null) {
      try { return new DataStore(directory, dataSchema.parse(JSON.parse(primary)), files); } catch { /* Try the previous valid save below. */ }
    }
    let backup: string | null = null;
    try { backup = await readFile(join(directory, 'state.backup.json'), 'utf8'); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (backup !== null) {
      let recovered: PersistedData;
      try { recovered = dataSchema.parse(JSON.parse(backup)); }
      catch { throw new Error('Settings data and its backup could not be read. Preserve the data folder and restore a valid export before restarting.'); }
      if (primary !== null) await writeFile(join(directory, 'state.corrupt.json'), primary, { mode: 0o600 });
      await atomicWrite(path, JSON.stringify(persistableData(recovered), null, 2), files);
      const store = new DataStore(directory, recovered, files);
      store.warning = primary === null ? 'Recovered the previous saved state from backup because state.json was missing.'
        : 'Recovered the previous saved state from backup. The unreadable file is preserved as state.corrupt.json.';
      return store;
    }
    if (primary !== null) throw new Error('Settings data could not be read and no backup exists. Preserve the data folder and restore a valid export before restarting.');
    const store = new DataStore(directory, { version: 1, settings: defaultSettings(), reminders: [], photoAsset: null }, files);
    await atomicWrite(path, JSON.stringify(persistableData(store.#data), null, 2), files);
    return store;
  }

  snapshot(): PersistedData { return structuredClone(this.#data); }

  async update(mutator: (data: PersistedData) => void): Promise<PersistedData> {
    const operation = this.#queue.then(async () => {
      const next = this.snapshot();
      mutator(next);
      // The photo is inspected when it changes: at startup or recovery, and once for an upload, whose
      // checked asset reaches this parse unchanged. A save that keeps it parses only its shape (#245).
      const photoUnchanged = next.photoAsset === null || samePhotoAsset(next.photoAsset, this.#data.photoAsset);
      const validated = (photoUnchanged ? checkedPhotoDataSchema : dataSchema).parse(next);
      // Files omit additive defaults so the previous release can still read them (#84). The backup
      // receives the data of the last successful save before the new state replaces state.json, so a
      // save that still fails after its retries leaves both files holding that last successful save
      // and loses nothing that was saved; only the generation before it leaves the backup (#247).
      await atomicWrite(join(this.directory, 'state.backup.json'), JSON.stringify(persistableData(this.#data), null, 2), this.#files);
      await atomicWrite(join(this.directory, 'state.json'), JSON.stringify(persistableData(validated), null, 2), this.#files);
      this.#data = validated;
      return this.snapshot();
    });
    this.#queue = operation.catch(() => undefined);
    return operation;
  }

  async patchSettings(patch: SettingsPatch, now = Date.now()): Promise<Settings> {
    return (await this.update(data => {
      data.settings = mergeSettings(data.settings, patch);
      if (patch.photoChange !== undefined) data.photoAsset = patch.photoChange === null ? null : createPhotoAsset(patch.photoChange.pngBase64, new Date(now).toISOString());
    })).settings;
  }
}
