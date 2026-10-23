import type { SavedPreset, Settings, VisualSettings } from './contracts.ts';

export const SCHEDULE_RULE_LIMIT = 24;
export const MANUAL_OVERRIDE_MS = 60 * 60 * 1000;
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
/** Days name the day an interval starts; equal times mean until that local time the next day. */
export interface ScheduleRule { id: string; presetId: string; days: number[]; start: string; end: string }
export interface PresetSchedule { enabled: boolean; fallbackPresetId: string | null; rules: ScheduleRule[] }
export interface ScheduleSelection {
  source: 'manual' | 'override' | 'rule' | 'fallback';
  presetId: string | null;
  ruleId: string | null;
  missingPresetIds: string[];
}
export interface ScheduleSnapshot {
  config: PresetSchedule;
  overrideUntil: string | null;
  selection: ScheduleSelection;
  /** API-only effective visual: canonical manual settings and their revision never change on a timer. */
  visual: VisualSettings | null;
  revision: string;
  timeZone: string;
  warning: string | null;
}
export function emptySchedule(): PresetSchedule { return { enabled: false, fallbackPresetId: null, rules: [] }; }
export function minuteOfDay(time: string): number { const [hours, minutes] = time.split(':').map(Number); return hours! * 60 + minutes!; }

/** Local civil-time membership, not elapsed UTC time. Missing DST minutes never occur; repeated ones match twice. */
export function ruleMatches(rule: ScheduleRule, now: Date): boolean {
  const day = now.getDay(), minute = now.getHours() * 60 + now.getMinutes();
  const start = minuteOfDay(rule.start), end = minuteOfDay(rule.end);
  if (end > start) return rule.days.includes(day) && minute >= start && minute < end;
  return (rule.days.includes(day) && minute >= start) || (rule.days.includes((day + 6) % 7) && minute < end);
}

/** First usable matching rule wins. A deleted style is skipped; it can never leave the display blank. */
export function selectScheduledPreset(config: PresetSchedule, presets: readonly SavedPreset[], now: Date, overrideUntil: string | null = null): ScheduleSelection {
  const available = new Set(presets.map(preset => preset.id));
  const missingPresetIds = [...new Set([...config.rules.map(rule => rule.presetId), ...(config.fallbackPresetId ? [config.fallbackPresetId] : [])].filter(id => !available.has(id)))];
  const result = (source: ScheduleSelection['source'], presetId: string | null = null, ruleId: string | null = null): ScheduleSelection => ({ source, presetId, ruleId, missingPresetIds });
  if (!config.enabled) return result('manual');
  if (overrideUntil && Date.parse(overrideUntil) > now.getTime()) return result('override');
  const rule = config.rules.find(item => available.has(item.presetId) && ruleMatches(item, now));
  if (rule) return result('rule', rule.presetId, rule.id);
  if (config.fallbackPresetId && available.has(config.fallbackPresetId)) return result('fallback', config.fallbackPresetId);
  return result('manual');
}

/** Overlay only the saved visual, retaining location, content, timers, idle settings and saved styles. */
export function scheduledSettings(settings: Settings, snapshot?: Pick<ScheduleSnapshot, 'visual'>): Settings {
  return snapshot?.visual ? { ...settings, ...snapshot.visual } : settings;
}

/** Weekly civil-time intervals, split at week rollover, for deterministic overlap explanations. */
function weeklyIntervals(rule: ScheduleRule): [number, number][] {
  const start = minuteOfDay(rule.start), end = minuteOfDay(rule.end);
  const duration = end > start ? end - start : 1440 - start + end;
  return rule.days.flatMap(day => {
    const from = day * 1440 + start, to = from + duration;
    return to <= 10080 ? [[from, to] as [number, number]] : [[from, 10080], [0, to - 10080]] as [number, number][];
  });
}
export function overlappingRules(rules: readonly ScheduleRule[]): [string, string][] {
  const pairs: [string, string][] = [];
  rules.forEach((rule, index) => rules.slice(index + 1).forEach(other => {
    if (weeklyIntervals(rule).some(([from, to]) => weeklyIntervals(other).some(([otherFrom, otherTo]) => from < otherTo && otherFrom < to))) pairs.push([rule.id, other.id]);
  }));
  return pairs;
}
