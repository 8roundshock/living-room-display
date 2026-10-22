import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { Settings } from '../shared/contracts.ts';
import { emptySchedule, MANUAL_OVERRIDE_MS, SCHEDULE_RULE_LIMIT, selectScheduledPreset, type PresetSchedule, type ScheduleSnapshot } from '../shared/schedule.ts';
import { atomicWrite, type StoreFiles } from './store.ts';

const id = z.string().uuid();
// Saved styles imported from earlier releases may use non-UUID IDs.
const presetId = z.string().min(1).max(80);
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'Choose a time in HH:MM format.');
export const scheduleConfigSchema = z.object({
  enabled: z.boolean(), fallbackPresetId: presetId.nullable(),
  rules: z.array(z.object({ id, presetId, days: z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(days => new Set(days).size === days.length, 'Choose each weekday once.'), start: time, end: time }).strict()).max(SCHEDULE_RULE_LIMIT),
}).strict().refine(config => new Set(config.rules.map(rule => rule.id)).size === config.rules.length, 'Schedule rows must have different IDs.');
export const scheduleBackupSchema = z.object({ version: z.literal(1), kind: z.literal('still-schedule'), config: scheduleConfigSchema }).strict();
const scheduleFileSchema = z.object({ version: z.literal(1), config: scheduleConfigSchema, overrideUntil: z.iso.datetime().nullable() }).strict();
interface ScheduleFile { version: 1; config: PresetSchedule; overrideUntil: string | null }
export class ScheduleError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/** Local sidecar: no schedule reads or automatic transitions write canonical settings, backups or exports. */
export class ScheduleStore {
  readonly directory: string;
  warning: string | null = null;
  #data: ScheduleFile;
  #files: StoreFiles;
  #queue: Promise<unknown> = Promise.resolve();
  #generation = 0;
  #boot = randomBytes(6).toString('hex');
  #invalid = false;
  private constructor(directory: string, data: ScheduleFile, files: StoreFiles) { this.directory = directory; this.#data = data; this.#files = files; }
  static async open(directory: string, overrides: Partial<StoreFiles> = {}): Promise<ScheduleStore> {
    const files = { rename, ...overrides };
    let text: string;
    try { text = await readFile(join(directory, 'schedule.json'), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return new ScheduleStore(directory, { version: 1, config: emptySchedule(), overrideUntil: null }, files); }
    try { return new ScheduleStore(directory, scheduleFileSchema.parse(JSON.parse(text)), files); }
    catch {
      const store = new ScheduleStore(directory, { version: 1, config: emptySchedule(), overrideUntil: null }, files);
      store.#invalid = true;
      store.warning = 'The saved schedule could not be read. Scheduling is off; the original file is kept on this computer.';
      return store;
    }
  }
  get revision(): string { return `${this.#boot}.${this.#generation}`; }
  snapshot(settings: Settings, now: number): ScheduleSnapshot {
    const config = structuredClone(this.#data.config);
    const overrideUntil = config.enabled && this.#data.overrideUntil && Date.parse(this.#data.overrideUntil) > now ? this.#data.overrideUntil : null;
    const selection = selectScheduledPreset(config, settings.savedPresets, new Date(now), overrideUntil);
    const visual = settings.savedPresets.find(preset => preset.id === selection.presetId)?.visual ?? null;
    return { config, overrideUntil, selection, visual: visual ? structuredClone(visual) : null, revision: this.revision, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, warning: this.warning };
  }
  marker(settings: Settings, now: number): string {
    const { selection } = this.snapshot(settings, now);
    return `${this.revision}.${selection.source}.${selection.ruleId ?? ''}.${selection.presetId ?? ''}`;
  }
  async #change(update: (current: ScheduleFile) => ScheduleFile, expected: readonly string[] | null): Promise<void> {
    const operation = this.#queue.then(async () => {
      if (expected && !expected.includes(this.revision)) throw new ScheduleError(409, 'The schedule changed in another window. Reload it before saving.');
      const next = scheduleFileSchema.parse(update(structuredClone(this.#data)));
      if (!this.#invalid && isDeepStrictEqual(next, this.#data)) return;
      if (this.#invalid) {
        // A deliberate new save preserves the unreadable original under a unique private name.
        await this.#files.rename(join(this.directory, 'schedule.json'), join(this.directory, `schedule.corrupt-${randomUUID()}.json`));
        this.#invalid = false;
      } else {
        await atomicWrite(join(this.directory, 'schedule.backup.json'), JSON.stringify(this.#data, null, 2), this.#files);
      }
      await atomicWrite(join(this.directory, 'schedule.json'), JSON.stringify(next, null, 2), this.#files);
      this.#data = next; this.#generation++; this.warning = null;
    });
    this.#queue = operation.catch(() => undefined);
    return operation;
  }
  async configure(config: PresetSchedule, expected: readonly string[] | null): Promise<void> {
    await this.#change(current => ({ ...current, config, overrideUntil: config.enabled ? current.overrideUntil : null }), expected);
  }
  async restore(config: PresetSchedule, expected: readonly string[] | null): Promise<void> {
    await this.#change(current => ({ ...current, config, overrideUntil: null }), expected);
  }
  async override(manual: boolean, now: number, expected: readonly string[] | null): Promise<void> {
    await this.#change(current => {
      if (manual && !current.config.enabled) throw new ScheduleError(409, 'Enable a schedule before pausing it.');
      return { ...current, overrideUntil: manual ? new Date(now + MANUAL_OVERRIDE_MS).toISOString() : null };
    }, expected);
  }
}
