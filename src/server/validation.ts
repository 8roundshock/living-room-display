import { z } from 'zod';
import type { Settings, SettingsPatch, WidgetId } from '../shared/contracts.ts';
import { defaultSettings } from '../shared/defaults.ts';
import { WIDGET_CATALOG, WIDGET_IDS, GRID_DENSITIES, defaultWidgetGrid, firstPlacement, gridProblem, placementFits, type WidgetDefinition } from '../shared/widgets.ts';
import { inspectPhoto, photoAssetSchema } from './photo.ts';

const widgetShape = <T>(factory: (id: WidgetId) => T) => Object.fromEntries(WIDGET_IDS.map(id => [id, factory(id)])) as Record<WidgetId, T>;
function legacyWidgets(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const source = value as Record<string, unknown>;
  return { ...Object.fromEntries(WIDGET_IDS.map(id => {
    const definition: WidgetDefinition = WIDGET_CATALOG[id];
    return [id, definition.legacyEnabledFrom && Object.hasOwn(source, definition.legacyEnabledFrom) ? source[definition.legacyEnabledFrom] : definition.defaultEnabled];
  })), ...source };
}

const timezone = z.string().max(100).refine(value => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
}, 'Use an IANA timezone, for example America/Toronto');
const location = z.object({
  name: z.string().trim().min(1).max(100), latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180), timezone: z.union([timezone, z.literal('auto')]),
}).strict();
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit hex color');
const appearance = z.object({
  preset: z.enum(['phone', 'room', 'night', 'custom']), accentColor: color, textColor: color,
  brightness: z.number().min(0.1).max(1), fontScale: z.number().min(0.7).max(1.5),
  fontFamily: z.enum(['sans', 'serif', 'mono']), layout: z.enum(['balanced', 'minimal', 'weather-first']),
  motionEnabled: z.boolean(), motionIntervalSeconds: z.number().int().min(30).max(1800),
  fadeSeconds: z.number().min(0).max(10),
  clockStyle: z.enum(['outline', 'digital', 'analog']).default('outline'),
}).strict();
const widgetsObject = z.object(widgetShape(() => z.boolean())).strict();
const widgets = z.preprocess(legacyWidgets, widgetsObject);
const transform = z.object({ offsetX: z.number().min(-25).max(25), offsetY: z.number().min(-25).max(25), scale: z.number().min(0.5).max(2) }).strict();
const widgetOverrides = z.preprocess(value => value && typeof value === 'object' && !Array.isArray(value)
  ? { ...Object.fromEntries(WIDGET_IDS.map(id => [id, { offsetX: 0, offsetY: 0, scale: 1 }])), ...value } : value,
z.object(widgetShape(() => transform)).strict());
const placement = z.object({ column: z.number().int().min(0).max(15), row: z.number().int().min(0).max(9), size: z.enum(['small', 'medium', 'large']) }).strict();
const widgetGrid = z.preprocess(value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const source = value as { density?: string; placements?: Record<string, unknown> };
  if (!source.placements || typeof source.placements !== 'object' || Array.isArray(source.placements)) return value;
  const defaults = defaultWidgetGrid();
  if (source.density && source.density in GRID_DENSITIES) defaults.density = source.density as typeof defaults.density;
  for (const id of WIDGET_IDS) {
    const candidate = placementFits(defaults, id, defaults.placements[id], {}) ? defaults.placements[id] : firstPlacement(defaults, id, WIDGET_CATALOG[id].defaultSize, {});
    if (candidate) defaults.placements[id] = candidate;
  }
  return { ...source, placements: { ...defaults.placements, ...source.placements } };
}, z.object({ density: z.enum(['spacious', 'balanced', 'fine']), placements: z.object(widgetShape(() => placement)).strict() }).strict()).default(defaultWidgetGrid);
const reminderBehavior = z.object({ hideWhenEmpty: z.boolean().default(true) }).strict();
// Additive version-one migration applies to settings and every saved visual preset.
const widgetBehavior = z.object({ reminders: reminderBehavior.default({ hideWhenEmpty: true }) }).strict()
  .default({ reminders: { hideWhenEmpty: true } });
const preview = z.object({ enabled: z.boolean(), opacity: z.number().min(0.02).max(0.3), widthPercent: z.number().min(12).max(35) }).strict();
const idle = z.object({ enabled: z.boolean(), idleMinutes: z.number().int().min(1).max(120) }).strict();
const visualShape = { appearance, widgets, widgetOverrides, widgetBehavior, widgetGrid, preview };
function checkGrid(value: Pick<Settings, 'widgetGrid' | 'widgets'>, context: z.RefinementCtx) {
  const problem = gridProblem(value.widgetGrid, value.widgets);
  if (problem) context.addIssue({ code: 'custom', path: ['widgetGrid'], message: problem });
}
const visual = z.object(visualShape).strict().superRefine(checkGrid);
const savedPresets = z.array(z.object({ id: z.string().min(1).max(80), name: z.string().trim().min(1).max(60), visual }).strict()).max(12)
  .refine(items => new Set(items.map(item => item.id)).size === items.length, 'Preset IDs must be unique');
export const settingsSchema = z.object({ ...visualShape, version: z.literal(1), location,
  // Missing source means legacy/manual, so upgrades cannot replace an existing city.
  locationSource: z.enum(['device', 'manual', 'fallback']).default('manual'),
  units: z.enum(['metric', 'imperial']), clockFormat: z.enum(['12h', '24h']), idle, savedPresets,
}).strict().superRefine(checkGrid).refine(value => value.locationSource !== 'manual' || value.location.timezone !== 'auto', 'A manual city needs an IANA timezone').transform(value => {
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
  appearance: appearance.partial().optional(), widgets: widgetsObject.partial().optional(),
  widgetOverrides: z.object(widgetShape(() => transform.partial().optional())).strict().optional(),
  widgetGrid: z.object({ density: z.enum(['spacious', 'balanced', 'fine']).optional(), placements: z.object(widgetShape(() => placement.partial().optional())).strict().partial().optional() }).strict().optional(),
  photoChange: z.object({ pngBase64: z.string().max(2_796_204).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/) }).strict().superRefine((value, context) => {
    try { inspectPhoto(Buffer.from(value.pngBase64, 'base64')); }
    catch (error) { context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'Invalid photo' }); }
  }).nullable().optional(),
  widgetBehavior: z.object({ reminders: z.object({ hideWhenEmpty: z.boolean().optional() }).strict().optional() }).strict().optional(),
  preview: preview.partial().optional(), idle: idle.partial().optional(), savedPresets: savedPresets.optional(),
}).strict();
const dueAt = z.iso.datetime({ offset: true }).nullable();
export const reminderInputSchema = z.object({ text: z.string().trim().min(1).max(240), dueAt: dueAt.optional() }).strict();
export const reminderPatchSchema = reminderInputSchema.partial().extend({ completed: z.boolean().optional() }).strict();
export const reminderSchema = reminderInputSchema.extend({ id: z.uuid(), completed: z.boolean(), dueAt, createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() }).strict();
export const dataSchema = z.object({ version: z.literal(1), settings: settingsSchema, reminders: z.array(reminderSchema).max(1000), photoAsset: photoAssetSchema.nullable().default(null) }).strict()
  .refine(data => new Set(data.reminders.map(item => item.id)).size === data.reminders.length, 'Reminder IDs must be unique');
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
  };
  // Existing API callers that explicitly edit a city are manual overrides too.
  if (changes.location && changes.locationSource === undefined) next.locationSource = 'manual';
  for (const id of Object.keys(patch.widgetOverrides ?? {}) as (keyof Settings['widgetOverrides'])[]) {
    next.widgetOverrides[id] = { ...current.widgetOverrides[id], ...patch.widgetOverrides?.[id] };
  }
  for (const id of Object.keys(patch.widgetGrid?.placements ?? {}) as WidgetId[]) {
    next.widgetGrid.placements[id] = { ...current.widgetGrid.placements[id], ...patch.widgetGrid?.placements?.[id] };
  }
  return settingsSchema.parse(next);
}

export function validationMessage(error: z.ZodError): string {
  return error.issues.slice(0, 5).map(issue => `${issue.path.join('.') || 'request'}: ${issue.message}`).join('; ');
}
