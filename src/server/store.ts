import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { defaultSettings } from '../shared/defaults.ts';
import type { Reminder, Settings, SettingsPatch } from '../shared/contracts.ts';
import { dataSchema, mergeSettings } from './validation.ts';
import { createPhotoAsset, type PhotoAsset } from './photo.ts';

export interface PersistedData { version: 1; settings: Settings; reminders: Reminder[]; photoAsset: PhotoAsset | null }

export function defaultDataDirectory(): string {
  if (process.env.LRD_DATA_DIR) return resolve(process.env.LRD_DATA_DIR);
  if (process.platform === 'win32') return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'LivingRoomDisplay', 'data');
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'LivingRoomDisplay', 'data');
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'living-room-display');
}

async function atomicWrite(path: string, data: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(data, 'utf8'); await file.sync(); } finally { await file.close(); }
  await rename(temporary, path);
}

export class DataStore {
  readonly directory: string;
  warning: string | null = null;
  #data: PersistedData;
  #queue: Promise<unknown> = Promise.resolve();
  private constructor(directory: string, data: PersistedData) { this.directory = directory; this.#data = data; }

  static async open(directory: string): Promise<DataStore> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, 'state.json');
    let primary: string | null = null;
    try { primary = await readFile(path, 'utf8'); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (primary !== null) {
      try { return new DataStore(directory, dataSchema.parse(JSON.parse(primary))); } catch { /* Try the previous valid save below. */ }
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
      await atomicWrite(path, JSON.stringify(recovered, null, 2));
      const store = new DataStore(directory, recovered);
      store.warning = primary === null ? 'Recovered the previous saved state from backup because state.json was missing.'
        : 'Recovered the previous saved state from backup. The unreadable file is preserved as state.corrupt.json.';
      return store;
    }
    if (primary !== null) throw new Error('Settings data could not be read and no backup exists. Preserve the data folder and restore a valid export before restarting.');
    const store = new DataStore(directory, { version: 1, settings: defaultSettings(), reminders: [], photoAsset: null });
    await atomicWrite(path, JSON.stringify(store.#data, null, 2));
    return store;
  }

  snapshot(): PersistedData { return structuredClone(this.#data); }

  async update(mutator: (data: PersistedData) => void): Promise<PersistedData> {
    const operation = this.#queue.then(async () => {
      const next = this.snapshot();
      mutator(next);
      const validated = dataSchema.parse(next);
      await atomicWrite(join(this.directory, 'state.backup.json'), JSON.stringify(this.#data, null, 2));
      await atomicWrite(join(this.directory, 'state.json'), JSON.stringify(validated, null, 2));
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
