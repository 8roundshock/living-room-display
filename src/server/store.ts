import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { defaultSettings } from '../shared/defaults.ts';
import type { Reminder, Settings, SettingsPatch } from '../shared/contracts.ts';
import { checkedPhotoDataSchema, dataSchema, mergeSettings } from './validation.ts';
import { createPhotoAsset, samePhotoAsset, type PhotoAsset } from './photo.ts';
import { persistableData } from './persistence.ts';

export interface PersistedData { version: 1; settings: Settings; reminders: Reminder[]; photoAsset: PhotoAsset | null }
export interface PhotoMetadata { id: string; width: number; height: number; updatedAt: string }
/** Everything but the photo bytes (#353), plus the in-memory settings revision (#287). */
export interface StoreView { version: 1; settings: Settings; reminders: Reminder[]; photo: PhotoMetadata | null; settingsRevision: string }
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
/**
 * A temporary save file at least this far from now (by mtime) cannot belong to a save still in
 * progress, which takes about a second at most: startup removes only such files (#320).
 */
export const STALE_TEMPORARY_FILE_MS = 60_000;
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

/**
 * Temporary files left by a save that was interrupted before its rename (a crash or power loss).
 * A recent one may be another server's save in progress on the same folder, which must still be
 * able to rename it (#320); it is removed at a later start.
 */
async function removeStaleTemporaryFiles(directory: string, now = Date.now()): Promise<void> {
  for (const name of await readdir(directory)) {
    if (!TEMPORARY_FILE.test(name)) continue;
    const path = join(directory, name);
    try {
      if (Math.abs(now - (await stat(path)).mtimeMs) < STALE_TEMPORARY_FILE_MS) continue;
      await rm(path, { force: true });
    } catch { /* Already gone. */ }
  }
}

export class DataStore {
  readonly directory: string;
  warning: string | null = null;
  #data: PersistedData;
  #files: StoreFiles;
  #queue: Promise<unknown> = Promise.resolve();
  /**
   * The settings revision (#287) is this process's random boot id and a counter bumped whenever a
   * write changes the settings. It lives in memory only: nothing about it is persisted or exported.
   */
  readonly #boot = randomBytes(6).toString('hex');
  #generation = 0;
  /** The selected photo's PNG bytes, decoded once per photo id (#353). */
  #photoImage: { id: string; content: Buffer } | null = null;
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

  /** A full copy including the photo bytes; routes use view() instead (#353). */
  snapshot(): PersistedData { return structuredClone(this.#data); }

  /** The current settings revision; it changes with every write that changes the settings (#287). */
  get settingsRevision(): string { return `${this.#boot}-${this.#generation}`; }

  /** Settings, reminders and photo metadata without cloning the photo bytes (#353). */
  view(): StoreView {
    const { version, settings, reminders, photoAsset } = this.#data;
    return {
      version, settings: structuredClone(settings), reminders: structuredClone(reminders),
      photo: photoAsset ? { id: photoAsset.id, width: photoAsset.width, height: photoAsset.height, updatedAt: photoAsset.updatedAt } : null,
      settingsRevision: this.settingsRevision,
    };
  }

  /** The selected photo's PNG bytes, shared between requests until the photo changes (#353). Do not modify. */
  photoImage(): { id: string; content: Buffer } | null {
    const asset = this.#data.photoAsset;
    if (!asset) { this.#photoImage = null; return null; }
    if (this.#photoImage?.id !== asset.id) this.#photoImage = { id: asset.id, content: Buffer.from(asset.pngBase64, 'base64') };
    return this.#photoImage;
  }

  async update(mutator: (data: PersistedData) => void): Promise<PersistedData> {
    return (await this.commit(mutator)).data;
  }

  /**
   * One serialized write. The mutator runs after every earlier write has finished, so it can check
   * `settingsRevision` against what a client last saw (#287); the result carries the revision of this
   * write, read in the same step as its data.
   */
  async commit(mutator: (data: PersistedData) => void): Promise<{ data: PersistedData; settingsRevision: string }> {
    const operation = this.#queue.then(async () => {
      const next = this.snapshot();
      mutator(next);
      // The photo is inspected when it changes: at startup or recovery, and once for an upload, whose
      // checked asset reaches this parse unchanged. A save that keeps it parses only its shape (#245).
      const photoUnchanged = next.photoAsset === null || samePhotoAsset(next.photoAsset, this.#data.photoAsset);
      const validated = (photoUnchanged ? checkedPhotoDataSchema : dataSchema).parse(next);
      // Files omit additive defaults so the previous release can still read them (#84). The backup
      // receives the last successful save first, then the new state replaces state.json (#247). A save
      // that still fails after its retries leaves state.json holding the last successful save, so
      // nothing that was saved is lost (#325). Which write failed decides the backup: when state.json
      // was held, the backup already holds that same save; when state.backup.json itself was held, its
      // write is the one that failed, state.json was never attempted and the backup keeps the save before.
      await atomicWrite(join(this.directory, 'state.backup.json'), JSON.stringify(persistableData(this.#data), null, 2), this.#files);
      await atomicWrite(join(this.directory, 'state.json'), JSON.stringify(persistableData(validated), null, 2), this.#files);
      const settingsChanged = !isDeepStrictEqual(this.#data.settings, validated.settings);
      this.#data = validated;
      if (settingsChanged) this.#generation++;
      return { data: this.snapshot(), settingsRevision: this.settingsRevision };
    });
    this.#queue = operation.catch(() => undefined);
    return operation;
  }

  async patchSettings(patch: SettingsPatch, now = Date.now()): Promise<Settings> {
    return (await this.commitSettings(patch, now)).settings;
  }

  /**
   * Applies a settings patch. With `expected` (the revisions a client's If-Match names, #287), a
   * patch computed from settings that another write has since changed is refused with a
   * SettingsConflict carrying the current settings and revision; the check runs inside the
   * serialized write, so two patches from the same stale revision cannot both pass.
   */
  async commitSettings(patch: SettingsPatch, now = Date.now(), expected: readonly string[] | null = null): Promise<{ settings: Settings; settingsRevision: string }> {
    const { data, settingsRevision } = await this.commit(data => {
      if (expected && !expected.includes(this.settingsRevision)) throw new SettingsConflict(data.settings, this.settingsRevision);
      data.settings = mergeSettings(data.settings, patch);
      if (patch.photoChange !== undefined) data.photoAsset = patch.photoChange === null ? null : createPhotoAsset(patch.photoChange.pngBase64, new Date(now).toISOString());
    });
    return { settings: data.settings, settingsRevision };
  }
}

/** A settings patch sent from an outdated revision (#287): nothing was written. */
export class SettingsConflict extends Error {
  readonly settings: Settings;
  readonly settingsRevision: string;
  constructor(settings: Settings, settingsRevision: string) {
    super('Settings changed in another window. Review and save again.');
    this.settings = settings; this.settingsRevision = settingsRevision;
  }
}
