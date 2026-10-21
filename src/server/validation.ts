import { z } from 'zod';
import type { Settings, SettingsPatch, WidgetId } from '../shared/contracts.ts';
import { defaultSettings } from '../shared/defaults.ts';
import { WIDGET_CATALOG, WIDGET_IDS, GRID_DENSITIES, absorbRetiredWidgets, absorbableGridProblem, defaultWidgetGrid, firstPlacement, fitGridDensity, isPlannedWidget, normalizePlacement, placementFits, type WidgetDefinition } from '../shared/widgets.ts';
import { ACCENT_MODES } from '../shared/palette.ts';
import { ANIMATION_LEVELS } from '../shared/motion.ts';
import { checkPhotoUpload, photoAssetSchema, photoAssetShape } from './photo.ts';
import { AT_REST } from './persistence.ts';

const widgetShape = <T>(factory: (id: WidgetId) => T) => Object.fromEntries(WIDGET_IDS.map(id => [id, factory(id)])) as Record<WidgetId, T>;
function legacyWidgets(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const source = value as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...Object.fromEntries(WIDGET_IDS.map(id => {
    const definition: WidgetDefinition = WIDGET_CATALOG[id];
    return [id, definition.legacyEnabledFrom && Object.hasOwn(source, definition.legacyEnabledFrom) ? source[definition.legacyEnabledFrom] : definition.defaultEnabled];
  })), ...source };
  // Planned ids have no renderer yet: they always read as disabled (retired ids are untouched).
  for (const id of WIDGET_IDS) if (isPlannedWidget(id)) merged[id] = false;
  return merged;
}

export const timezone = z.string().max(100).refine(value => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
}, 'Use an IANA timezone, for example America/Toronto');
export const location = z.object({
  name: z.string().trim().min(1).max(100), latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180), timezone: z.union([timezone, z.literal('auto')]),
}).strict();
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit hex color');
const brightnessLevel = z.number().min(0.1).max(1);
/** Follow daylight (#439): a whole range, replaced whole by PATCH; null is Fixed. */
const daylightBrightness = z.object({ dimmest: brightnessLevel, brightest: brightnessLevel }).strict()
  .refine(range => range.dimmest <= range.brightest, { message: 'Dimmest must not be brighter than Brightest', path: ['dimmest'] })
  .nullable();
// Field schemas carry no defaults: zod applies .default() inside .partial(), which made a
// brightness-only PATCH reset a saved clock style (#83). Only the persisted reader fills defaults.
const appearanceFields = {
  preset: z.enum(['phone', 'room', 'night', 'custom']), accentColor: color, textColor: color,
  brightness: brightnessLevel, fontScale: z.number().min(0.7).max(1.5),
  fontFamily: z.enum(['sans', 'serif', 'mono']), layout: z.enum(['balanced', 'minimal', 'weather-first']),
  motionEnabled: z.boolean(), motionIntervalSeconds: z.number().int().min(30).max(1800),
  fadeSeconds: z.number().min(0).max(10),
  clockStyle: z.enum(['outline', 'digital', 'analog']),
  accentMode: z.enum(ACCENT_MODES),
  animation: z.enum(ANIMATION_LEVELS),
  daylightBrightness,
  rearrange: z.boolean(),
};
/** Persisted settings, saved styles and imports: additive fields read as their defaults. */
const appearance = z.object({
  ...appearanceFields,
  clockStyle: appearanceFields.clockStyle.default('outline'),
  accentMode: appearanceFields.accentMode.default(AT_REST.appearance.accentMode),
  animation: appearanceFields.animation.default(AT_REST.appearance.animation),
  daylightBrightness: appearanceFields.daylightBrightness.default(AT_REST.appearance.daylightBrightness),
  rearrange: appearanceFields.rearrange.default(AT_REST.appearance.rearrange),
}).strict();
/** PATCH: exactly the supplied keys, never a default. */
const appearancePatch = z.object(appearanceFields).strict().partial();
const widgetsObject = z.object(widgetShape(() => z.boolean())).strict();
const widgets = z.preprocess(legacyWidgets, widgetsObject);
const transform = z.object({ offsetX: z.number().min(-25).max(25), offsetY: z.number().min(-25).max(25), scale: z.number().min(0.5).max(2) }).strict();
const widgetOverrides = z.preprocess(value => value && typeof value === 'object' && !Array.isArray(value)
  ? { ...Object.fromEntries(WIDGET_IDS.map(id => [id, { offsetX: 0, offsetY: 0, scale: 1 }])), ...value } : value,
z.object(widgetShape(() => transform)).strict());
// Free-size custom span (#73); gridProblem enforces the widget's own limits.
const spanSchema = z.object({ columns: z.number().int().min(1).max(16), rows: z.number().int().min(1).max(10) }).strict();
const placement = z.object({ column: z.number().int().min(0).max(15), row: z.number().int().min(0).max(9), size: z.enum(['small', 'medium', 'large']), span: spanSchema.optional() }).strict();
const widgetGrid = z.preprocess(value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const source = value as { revision?: number; density?: string; placements?: Record<string, unknown> };
  if (!source.placements || typeof source.placements !== 'object' || Array.isArray(source.placements)) return value;
  const defaults = defaultWidgetGrid(source.revision === 2 ? 2 : 1);
  if (source.density && source.density in GRID_DENSITIES) defaults.density = source.density as typeof defaults.density;
  for (const id of WIDGET_IDS) {
    const candidate = placementFits(defaults, id, defaults.placements[id], {}) ? defaults.placements[id] : firstPlacement(defaults, id, WIDGET_CATALOG[id].defaultSize, {});
    if (candidate) defaults.placements[id] = candidate;
  }
  return { revision: 1, ...source, placements: { ...defaults.placements, ...source.placements } };
}, z.object({ revision: z.union([z.literal(1), z.literal(2)]), density: z.enum(['spacious', 'balanced', 'fine']), placements: z.object(widgetShape(() => placement)).strict() }).strict()
  // Spans are canonical only when they differ from the contained family's span; size is derived.
  .transform(grid => ({ ...grid, placements: widgetShape(id => normalizePlacement(id, grid.placements[id])) }))).default(() => ({ ...defaultWidgetGrid(), revision: 2 as const }));
const reminderBehavior = z.object({ hideWhenEmpty: z.boolean().default(true) }).strict();
// Additive version-one migration applies to settings and every saved visual preset.
const widgetBehavior = z.object({ reminders: reminderBehavior.default({ hideWhenEmpty: true }) }).strict()
  .default({ reminders: { hideWhenEmpty: true } });
const preview = z.object({ enabled: z.boolean(), opacity: z.number().min(0.02).max(0.3), widthPercent: z.number().min(12).max(35) }).strict();
const idle = z.object({ enabled: z.boolean(), idleMinutes: z.number().int().min(1).max(120) }).strict();
/** #436 Keep the screen on: persisted settings and imports only, never part of visualShape, so saved styles never carry it. */
const screen = z.object({ keepAwake: z.boolean().default(true) }).strict().default(() => defaultSettings().screen);
const screenPatch = z.object({ keepAwake: z.boolean() }).strict().partial();
const visualShape = { appearance, widgets, widgetOverrides, widgetBehavior, widgetGrid, preview };

// #78 widget content. Field schemas carry no defaults; only the persisted reader fills them.
const civilDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date').refine(value => {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1900 && year <= 2200 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}, 'Use a real calendar date between 1900 and 2200');
const worldClock = z.object({
  id: z.uuid(), label: z.string().trim().min(1).max(40), timezone,
  latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180),
}).strict();
const countdown = z.object({ id: z.uuid(), title: z.string().trim().min(1).max(60), date: civilDate, repeatsYearly: z.boolean() }).strict();
const noteText = z.string().transform(value => value.replace(/\r\n?/g, '\n').trim())
  .pipe(z.string().max(200, 'Use at most 200 characters').refine(value => value.split('\n').length <= 4, 'Use at most 4 lines'));
const uniqueIds = (items: { id: string }[]) => new Set(items.map(item => item.id)).size === items.length;
const worldClocks = z.array(worldClock).max(4).refine(uniqueIds, 'World clock IDs must be unique');
const countdowns = z.array(countdown).max(12).refine(uniqueIds, 'Countdown IDs must be unique');
const weekStart = z.enum(['locale', 'sunday', 'monday']);
const airQualityScale = z.enum(['us', 'european']);
/** Dynamic's sources (#437): each reads as on when missing, and a saved section keeps at least one on. */
export const DYNAMIC_SOURCES_PROBLEM = 'Dynamic needs at least one source';
const dynamicSources = z.object({
  weather: z.boolean().default(true), alerts: z.boolean().default(true), air: z.boolean().default(true),
  sky: z.boolean().default(true), personal: z.boolean().default(true),
}).strict().refine(value => Object.values(value).some(Boolean), DYNAMIC_SOURCES_PROBLEM)
  .default(() => ({ weather: true, alerts: true, air: true, sky: true, personal: true }));
const dynamicSourcesPatch = z.object({ weather: z.boolean(), alerts: z.boolean(), air: z.boolean(), sky: z.boolean(), personal: z.boolean() }).strict().partial();
/** Persisted settings and imports only: never part of visualShape, so saved styles never contain it. */
const widgetData = z.object({
  worldClocks: worldClocks.default(() => []),
  calendar: z.object({ weekStart: weekStart.default('locale') }).strict().default(() => ({ weekStart: 'locale' as const })),
  countdowns: countdowns.default(() => []),
  note: z.object({ text: noteText.default('') }).strict().default(() => ({ text: '' })),
  airQuality: z.object({ scale: airQualityScale.default('us') }).strict().default(() => ({ scale: 'us' as const })),
  dynamic: dynamicSources,
}).strict().default(() => defaultSettings().widgetData);
/** PATCH: exactly the supplied keys, never a default; arrays replace whole. */
const widgetDataPatch = z.object({
  worldClocks: worldClocks.optional(),
  calendar: z.object({ weekStart }).strict().partial().optional(),
  countdowns: countdowns.optional(),
  note: z.object({ text: noteText }).strict().partial().optional(),
  airQuality: z.object({ scale: airQualityScale }).strict().partial().optional(),
  dynamic: dynamicSourcesPatch.optional(),
}).strict();
function checkGrid(value: Pick<Settings, 'widgetGrid' | 'widgets'>, context: z.RefinementCtx) {
  // Strict, except that an enabled retired widget may overlap the target absorbing it (#74).
  const problem = absorbableGridProblem(value.widgetGrid, value.widgets);
  if (problem) context.addIssue({ code: 'custom', path: ['widgetGrid'], message: problem });
}
function migrateGrid<T extends Pick<Settings, 'widgetGrid' | 'widgets'>>(value: T): T {
  if (value.widgetGrid.revision === 2) return value;
  const fit = fitGridDensity({ ...value.widgetGrid, revision: 2 }, value.widgetGrid.density, value.widgets);
  if (!fit) throw new Error('This legacy widget layout cannot fit. Preserve the original settings and choose fewer widgets.');
  return { ...value, widgetGrid: fit.grid };
}
const visual = z.object(visualShape).strict().superRefine(checkGrid).transform(migrateGrid).transform(absorbRetiredWidgets);
const savedPresets = z.array(z.object({ id: z.string().min(1).max(80), name: z.string().trim().min(1).max(60), visual }).strict()).max(12)
  .refine(items => new Set(items.map(item => item.id)).size === items.length, 'Preset IDs must be unique');
export const settingsSchema = z.object({ ...visualShape, version: z.literal(1), location,
  // Missing source means legacy/manual, so upgrades cannot replace an existing city.
  locationSource: z.enum(['device', 'manual', 'fallback']).default('manual'),
  units: z.enum(['metric', 'imperial']), clockFormat: z.enum(['12h', '24h']), idle, savedPresets, widgetData, screen,
}).strict().superRefine(checkGrid).refine(value => value.locationSource !== 'manual' || value.location.timezone !== 'auto', 'A manual city needs an IANA timezone').transform(migrateGrid).transform(absorbRetiredWidgets).transform(value => {
  if (value.locationSource === 'fallback') return { ...value, location: defaultSettings().location };
  if (value.locationSource === 'device') return { ...value, location: {
    name: 'Device area', latitude: Math.round(value.location.latitude * 10) / 10,
    longitude: Math.round(value.location.longitude * 10) / 10, timezone: 'auto',
  } };
  return value;
});
export const automaticLocationSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('device'), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), automatic: z.boolean() }).strict(),
  z.object({ source: z.literal('fallback'), automatic: z.boolean() }).strict(),
]);
export const settingsPatchSchema = z.object({
  automaticLocation: z.boolean().optional(),
  location: location.partial().optional(), units: z.enum(['metric', 'imperial']).optional(), clockFormat: z.enum(['12h', '24h']).optional(),
  locationSource: z.enum(['device', 'manual', 'fallback']).optional(),
  appearance: appearancePatch.optional(),
  widgets: widgetsObject.partial().superRefine((value, context) => {
    for (const id of WIDGET_IDS) {
      if (value[id] === true && isPlannedWidget(id)) context.addIssue({ code: 'custom', path: [id], message: `${WIDGET_CATALOG[id].name} is not available yet` });
    }
  }).optional(),
  widgetOverrides: z.object(widgetShape(() => transform.partial().optional())).strict().optional(),
  widgetGrid: z.object({ revision: z.literal(2).optional(), density: z.enum(['spacious', 'balanced', 'fine']).optional(), placements: z.object(widgetShape(() => placement.partial().extend({ span: spanSchema.nullable().optional() }).optional())).strict().partial().optional() }).strict().optional(),
  photoChange: z.object({ pngBase64: z.string().max(2_796_204).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/) }).strict().superRefine((value, context) => {
    try { checkPhotoUpload(value.pngBase64); }
    catch (error) { context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'Invalid photo' }); }
  }).nullable().optional(),
  widgetBehavior: z.object({ reminders: z.object({ hideWhenEmpty: z.boolean().optional() }).strict().optional() }).strict().optional(),
  preview: preview.partial().optional(), idle: idle.partial().optional(), savedPresets: savedPresets.optional(),
  widgetData: widgetDataPatch.optional(),
  screen: screenPatch.optional(),
}).strict();
const dueAt = z.iso.datetime({ offset: true }).nullable();
export const reminderInputSchema = z.object({ text: z.string().trim().min(1).max(240), dueAt: dueAt.optional() }).strict();
/**
 * POST only: Undo after a delete re-creates the reminder with its original `createdAt` (#237), in
 * the persisted format and never later than the server's `now`. PATCH never accepts it.
 */
export function reminderCreateSchema(now: number) {
  return reminderInputSchema.extend({
    createdAt: z.iso.datetime().refine(value => Date.parse(value) <= now, 'Use a creation time that is not in the future').optional(),
  }).strict();
}
export const reminderPatchSchema = reminderInputSchema.partial().extend({ completed: z.boolean().optional() }).strict();
export const reminderSchema = reminderInputSchema.extend({ id: z.uuid(), completed: z.boolean(), dueAt, createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() }).strict();
const uniqueReminders = (data: { reminders: { id: string }[] }) => new Set(data.reminders.map(item => item.id)).size === data.reminders.length;
export const dataSchema = z.object({ version: z.literal(1), settings: settingsSchema, reminders: z.array(reminderSchema).max(1000), photoAsset: photoAssetSchema.nullable().default(null) }).strict()
  .refine(uniqueReminders, 'Reminder IDs must be unique');
/** Store saves only: the photo is the one already checked (unchanged, or just built from a checked upload), so only its shape is parsed (#245). */
export const checkedPhotoDataSchema = z.object({ version: z.literal(1), settings: settingsSchema, reminders: z.array(reminderSchema).max(1000), photoAsset: photoAssetShape.nullable().default(null) }).strict()
  .refine(uniqueReminders, 'Reminder IDs must be unique');
export const importSchema = z.object({ version: z.literal(1), exportedAt: z.iso.datetime(), settings: settingsSchema, reminders: z.array(reminderSchema).max(1000) }).strict();

export function mergeSettings(current: Settings, patch: SettingsPatch): Settings {
  const { automaticLocation, photoChange: _photoChange, ...changes } = patch;
  if (automaticLocation && current.locationSource === 'manual') {
    delete changes.location; delete changes.locationSource;
  }
  const next = { ...current, ...changes, location: { ...current.location, ...changes.location }, appearance: { ...current.appearance, ...changes.appearance },
    widgets: { ...current.widgets, ...patch.widgets }, preview: { ...current.preview, ...patch.preview }, idle: { ...current.idle, ...patch.idle },
    widgetOverrides: { ...current.widgetOverrides },
    widgetGrid: { ...current.widgetGrid, ...patch.widgetGrid, placements: { ...current.widgetGrid.placements } },
    widgetBehavior: { reminders: { ...current.widgetBehavior.reminders, ...patch.widgetBehavior?.reminders } },
    // Arrays replace whole (the editor sends whole lists); nested objects merge.
    widgetData: { ...current.widgetData, ...patch.widgetData,
      calendar: { ...current.widgetData.calendar, ...patch.widgetData?.calendar },
      note: { ...current.widgetData.note, ...patch.widgetData?.note },
      airQuality: { ...current.widgetData.airQuality, ...patch.widgetData?.airQuality },
      dynamic: { ...current.widgetData.dynamic, ...patch.widgetData?.dynamic } },
    screen: { ...current.screen, ...patch.screen },
  };
  // Existing API callers that explicitly edit a city are manual overrides too.
  if (changes.location && changes.locationSource === undefined) next.locationSource = 'manual';
  for (const id of Object.keys(patch.widgetOverrides ?? {}) as (keyof Settings['widgetOverrides'])[]) {
    next.widgetOverrides[id] = { ...current.widgetOverrides[id], ...patch.widgetOverrides?.[id] };
  }
  for (const id of Object.keys(patch.widgetGrid?.placements ?? {}) as WidgetId[]) {
    const change = patch.widgetGrid?.placements?.[id] ?? {};
    const { span, ...placement } = { ...current.widgetGrid.placements[id], ...change };
    // `span: null` clears a custom size, and so does a family selection (size without span).
    const cleared = change.span === null || (change.size !== undefined && change.span === undefined);
    next.widgetGrid.placements[id] = span && !cleared ? { ...placement, span } : placement;
  }
  return settingsSchema.parse(next);
}

export function validationMessage(error: z.ZodError): string {
  return error.issues.slice(0, 5).map(issue => `${issue.path.join('.') || 'request'}: ${issue.message}`).join('; ');
}
