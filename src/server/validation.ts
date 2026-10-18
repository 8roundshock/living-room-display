import { z } from 'zod';
import type { Settings, SettingsPatch } from '../shared/contracts.ts';
import { defaultSettings } from '../shared/defaults.ts';

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
}).strict();
const widgets = z.object({ clock: z.boolean(), weather: z.boolean(), forecast: z.boolean(), reminders: z.boolean(), preview: z.boolean() }).strict();
const transform = z.object({ offsetX: z.number().min(-25).max(25), offsetY: z.number().min(-25).max(25), scale: z.number().min(0.5).max(2) }).strict();
const widgetOverrides = z.object({ clock: transform, weather: transform, forecast: transform, reminders: transform, preview: transform }).strict();
const preview = z.object({ enabled: z.boolean(), opacity: z.number().min(0.02).max(0.3), widthPercent: z.number().min(12).max(35) }).strict();
const idle = z.object({ enabled: z.boolean(), idleMinutes: z.number().int().min(1).max(120) }).strict();
const visual = z.object({ appearance, widgets, widgetOverrides, preview }).strict();
const savedPresets = z.array(z.object({ id: z.string().min(1).max(80), name: z.string().trim().min(1).max(60), visual }).strict()).max(12)
  .refine(items => new Set(items.map(item => item.id)).size === items.length, 'Preset IDs must be unique');
export const settingsSchema = visual.extend({ version: z.literal(1), location,
  // Missing source means legacy/manual, so upgrades cannot replace an existing city.
  locationSource: z.enum(['device', 'manual', 'fallback']).default('manual'),
  units: z.enum(['metric', 'imperial']), clockFormat: z.enum(['12h', '24h']), idle, savedPresets,
}).refine(value => value.locationSource !== 'manual' || value.location.timezone !== 'auto', 'A manual city needs an IANA timezone').transform(value => {
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
  location: location.partial().optional(), units: z.enum(['metric', 'imperial']).optional(), clockFormat: z.enum(['12h', '24h']).optional(),
  locationSource: z.enum(['device', 'manual', 'fallback']).optional(),
  appearance: appearance.partial().optional(), widgets: widgets.partial().optional(),
  widgetOverrides: z.object({ clock: transform.partial().optional(), weather: transform.partial().optional(), forecast: transform.partial().optional(), reminders: transform.partial().optional(), preview: transform.partial().optional() }).strict().optional(),
  preview: preview.partial().optional(), idle: idle.partial().optional(), savedPresets: savedPresets.optional(),
}).strict();
const dueAt = z.iso.datetime({ offset: true }).nullable();
export const reminderInputSchema = z.object({ text: z.string().trim().min(1).max(240), dueAt: dueAt.optional() }).strict();
export const reminderPatchSchema = reminderInputSchema.partial().extend({ completed: z.boolean().optional() }).strict();
export const reminderSchema = reminderInputSchema.extend({ id: z.uuid(), completed: z.boolean(), dueAt, createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() }).strict();
export const dataSchema = z.object({ version: z.literal(1), settings: settingsSchema, reminders: z.array(reminderSchema).max(1000) }).strict()
  .refine(data => new Set(data.reminders.map(item => item.id)).size === data.reminders.length, 'Reminder IDs must be unique');
export const importSchema = z.object({ version: z.literal(1), exportedAt: z.iso.datetime(), settings: settingsSchema, reminders: z.array(reminderSchema).max(1000) }).strict();

export function mergeSettings(current: Settings, patch: SettingsPatch): Settings {
  const next = { ...current, ...patch, location: { ...current.location, ...patch.location }, appearance: { ...current.appearance, ...patch.appearance },
    widgets: { ...current.widgets, ...patch.widgets }, preview: { ...current.preview, ...patch.preview }, idle: { ...current.idle, ...patch.idle },
    widgetOverrides: { ...current.widgetOverrides },
  };
  // Existing API callers that explicitly edit a city are manual overrides too.
  if (patch.location && patch.locationSource === undefined) next.locationSource = 'manual';
  for (const id of Object.keys(patch.widgetOverrides ?? {}) as (keyof Settings['widgetOverrides'])[]) {
    next.widgetOverrides[id] = { ...current.widgetOverrides[id], ...patch.widgetOverrides?.[id] };
  }
  return settingsSchema.parse(next);
}

export function validationMessage(error: z.ZodError): string {
  return error.issues.slice(0, 5).map(issue => `${issue.path.join('.') || 'request'}: ${issue.message}`).join('; ');
}
