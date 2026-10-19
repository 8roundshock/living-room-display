import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { RainInterval } from '../shared/contracts.ts';
import { compactWeatherRange, compactWeatherTime } from './format.ts';
import { PRECIPITATION_POSSIBLE_CHANCE, RAIN_ELEVATED_LEAD_HOURS, RAIN_LIKELY_CHANCE, RAIN_OUTLOOK_HOURS, rainOutlook, rainOutlookCopy, type RainOutlook } from './weather-outlook.ts';

const HOUR = 3_600_000;
// 9 AM in Toronto (EDT, UTC-4).
const NOW = Date.parse('2026-10-18T13:00:00Z');
const TORONTO = 'America/Toronto';

type Hour = Partial<Omit<RainInterval, 'intervalStart' | 'intervalEnd'>>;
function series(start: number, hours: Hour[]): RainInterval[] {
  return hours.map((hour, index) => ({
    intervalStart: new Date(start + index * HOUR).toISOString(), intervalEnd: new Date(start + (index + 1) * HOUR).toISOString(),
    precipitationProbability: 10, precipitationAmount: 0, rainAmount: 0, ...hour,
  }));
}
const wet = (rain = 1, chance = 60): Hour => ({ rainAmount: rain, precipitationAmount: rain, precipitationProbability: chance });
function hours(count: number, at: Record<number, Hour> = {}): Hour[] { return Array.from({ length: count }, (_, index) => at[index] ?? {}); }
function outlook(hourly: RainInterval[], now = NOW, unit: 'mm' | 'in' = 'mm'): RainOutlook {
  return rainOutlook({ hourly, units: { temperature: '°C', windSpeed: 'km/h', precipitation: unit } }, now);
}
function copy(value: RainOutlook, variant: 'compact' | 'full' = 'full', { timeZone = TORONTO, clock = '12h' as '12h' | '24h', now = NOW } = {}) {
  return rainOutlookCopy(value, timeZone, clock, now, variant);
}

test('the outlook constants match the documented thresholds', () => {
  assert.deepEqual([RAIN_OUTLOOK_HOURS, RAIN_ELEVATED_LEAD_HOURS, RAIN_LIKELY_CHANCE, PRECIPITATION_POSSIBLE_CHANCE], [12, 6, 60, 30]);
});

test('a complete dry forecast is calm and says nothing about rain', () => {
  const value = outlook(series(NOW, hours(12)));
  assert.equal(value.kind, 'calm'); assert.equal(value.emphasis, 'calm'); assert.equal(value.firstSpell, null);
  assert.equal(value.hours.length, 12); assert.equal(value.hours.some(hour => hour.inSpell), false);
  assert.deepEqual(copy(value), { headline: '', detail: '', confidence: 'Forecast estimate' });
  assert.deepEqual(copy(value, 'compact'), { headline: '', detail: '', confidence: 'Forecast estimate' });
});

test('rain including now is elevated with a bounded end, likely at 60% and possible at 59%', () => {
  const value = outlook(series(NOW, hours(12, { 0: wet(1), 1: wet(1), 2: wet(2, 50) })));
  assert.equal(value.kind, 'now'); assert.equal(value.emphasis, 'elevated'); assert.equal(value.qualifier, 'likely');
  assert.deepEqual(value.firstSpell, { start: '2026-10-18T13:00:00.000Z', end: '2026-10-18T16:00:00.000Z', openEnded: false, amount: 4, knownAmountOnly: false, peakChance: 60 });
  assert.deepEqual(value.hours.map(hour => hour.inSpell), [true, true, true, false, false, false, false, false, false, false, false, false]);
  assert.deepEqual(copy(value), { headline: 'Rain likely until 12 PM', detail: 'Peak 60% · 4 mm rain', confidence: 'Forecast estimate' });
  assert.equal(copy(value, 'compact').headline, 'Rain likely until 12 PM');
  const possible = outlook(series(NOW, hours(12, { 0: wet(1, 59), 1: wet(1, 59), 2: wet(2, 50) })));
  assert.equal(possible.qualifier, 'possible');
  assert.deepEqual(copy(possible), { headline: 'Rain possible until 12 PM', detail: 'Peak 59% · 4 mm rain', confidence: 'Forecast estimate' });
});

test('a spell reaching the end of known coverage is open-ended', () => {
  const value = outlook(series(NOW, hours(12).map(() => wet(1, 70))));
  assert.equal(value.kind, 'now'); assert.equal(value.firstSpell?.openEnded, true);
  assert.equal(copy(value).headline, 'Rain likely beyond 9 PM');
  assert.equal(copy(value, 'compact').headline, 'Rain likely now');
  assert.equal(copy(value).detail, 'Peak 70% · 12 mm rain');
});

test('a spell starting at +6h00 is soon (elevated) and at +6h01 is later (hint)', () => {
  const at = hours(13, { 7: wet(), 8: wet(), 9: wet() });
  const start = NOW - HOUR;
  const soon = outlook(series(start, at));
  assert.equal(soon.kind, 'soon'); assert.equal(soon.emphasis, 'elevated');
  assert.deepEqual(copy(soon), { headline: 'Rain likely 3–6 PM', detail: 'Peak 60% · 3 mm rain', confidence: 'Forecast estimate' });
  assert.equal(copy(soon, 'compact').headline, 'Rain likely 3–6 PM');
  const later = outlook(series(start, at), NOW - 60_000);
  assert.equal(later.kind, 'later'); assert.equal(later.emphasis, 'hint');
  assert.equal(copy(later, 'full', { now: NOW - 60_000 }).headline, 'Rain likely from 3 PM', 'the same day needs no day label');
  assert.equal(copy(later, 'compact', { now: NOW - 60_000 }).headline, 'Rain likely from 3 PM');
});

test('several spells read “on and off from” in full and “from” compactly; an open-ended soon spell reads “from”', () => {
  const several = outlook(series(NOW, hours(12, { 1: wet(1, 40), 2: wet(1, 70), 4: wet(1, 80), 5: wet() })));
  assert.equal(several.kind, 'soon'); assert.equal(several.laterSpells.length, 1);
  assert.equal(several.qualifier, 'likely', 'the qualifier follows the first spell peak (40% then 70%)');
  assert.equal(copy(several).headline, 'Rain likely on and off from 10 AM');
  assert.equal(copy(several, 'compact').headline, 'Rain likely from 10 AM');
  assert.equal(copy(several).detail, 'Peak 80% · 4 mm rain', 'the detail covers every spell in the window');
  const open = outlook(series(NOW, hours(12, Object.fromEntries(Array.from({ length: 9 }, (_, index) => [index + 3, wet()]))))) ;
  assert.equal(open.kind, 'soon'); assert.equal(open.firstSpell?.openEnded, true);
  assert.equal(copy(open).headline, 'Rain likely from 12 PM'); assert.equal(copy(open, 'compact').headline, 'Rain likely from 12 PM');
});

test('later rain names the day in full form when the date differs', () => {
  const evening = Date.parse('2026-10-19T01:00:00Z'); // 9 PM in Toronto
  const value = outlook(series(evening, hours(12, { 10: wet(1, 65), 11: wet(1, 65) })), evening);
  assert.equal(value.kind, 'later'); assert.equal(value.emphasis, 'hint');
  assert.equal(copy(value, 'full', { now: evening }).headline, 'Rain likely from Tomorrow 7 AM');
  assert.equal(copy(value, 'compact', { now: evening }).headline, 'Rain likely from 7 AM');
});

test('missing rain amounts without a spell are unknown rain timing', () => {
  const value = outlook(series(NOW, hours(12, { 4: { rainAmount: null } })));
  assert.equal(value.kind, 'unknown'); assert.equal(value.unknownReason, 'rain-data'); assert.equal(value.emphasis, 'hint');
  assert.deepEqual(copy(value), { headline: 'Rain timing unavailable', detail: '', confidence: 'Partial data' });
});

test('a chance alone, or snow without rain, is possible precipitation with no rain words', () => {
  const chance = outlook(series(NOW, hours(12, { 3: { precipitationProbability: 40 } })));
  assert.equal(chance.kind, 'possible'); assert.equal(chance.emphasis, 'hint');
  assert.deepEqual(copy(chance), { headline: 'Precipitation possible · 40%', detail: '', confidence: 'Forecast estimate' });
  const snow = outlook(series(NOW, hours(12, { 2: { precipitationAmount: 2, rainAmount: 0, precipitationProbability: 20 } })));
  assert.equal(snow.kind, 'possible'); assert.equal(snow.firstSpell, null);
  const text = copy(snow);
  assert.equal(text.headline, 'Precipitation possible · 20%');
  assert.doesNotMatch(`${text.headline} ${text.detail}`, /rain/i);
});

test('no future intervals, or partial dry coverage, are unknown outlooks', () => {
  const none = outlook([]);
  assert.equal(none.kind, 'unknown'); assert.equal(none.unknownReason, 'none');
  assert.deepEqual(copy(none), { headline: 'Rain outlook unavailable', detail: '', confidence: '' });
  const partial = outlook(series(NOW, hours(6)));
  assert.equal(partial.kind, 'unknown'); assert.equal(partial.unknownReason, 'partial');
  assert.deepEqual(copy(partial), { headline: 'Rain outlook partial', detail: '', confidence: 'Partial forecast' });
  const gapped = outlook(series(NOW, hours(12)).filter((_, index) => index !== 5));
  assert.equal(gapped.kind, 'unknown'); assert.equal(gapped.hasGaps, true);
  assert.deepEqual(copy(gapped), { headline: 'Rain outlook partial', detail: '', confidence: 'Partial forecast · coverage gaps' });
});

test('partial coverage with a spell still elevates, labelled as a partial forecast; a gap ends a spell', () => {
  const value = outlook(series(NOW, hours(6, { 2: wet(), 3: wet() })));
  assert.equal(value.kind, 'soon');
  assert.deepEqual(copy(value), { headline: 'Rain likely 11 AM–1 PM', detail: 'Peak 60% · 2 mm rain', confidence: 'Partial forecast' });
  const gapped = outlook(series(NOW, hours(12, { 1: wet(), 2: wet(), 3: wet() })).filter((_, index) => index !== 2));
  assert.equal(gapped.firstSpell?.end, '2026-10-18T15:00:00.000Z'); assert.equal(gapped.laterSpells.length, 1);
  assert.equal(copy(gapped, 'compact').confidence, 'Partial forecast · coverage gaps');
});

test('an unknown chance makes the qualifier “possible” and says so', () => {
  const value = outlook(series(NOW, hours(12, { 0: { ...wet(2), precipitationProbability: null }, 1: { ...wet(2), precipitationProbability: null } })));
  assert.equal(value.kind, 'now'); assert.equal(value.qualifier, 'possible'); assert.equal(value.firstSpell?.peakChance, null); assert.equal(value.chanceMissing, true);
  assert.deepEqual(copy(value), { headline: 'Rain possible until 11 AM', detail: 'Chance unavailable · 4 mm rain', confidence: 'Partial data' });
});

test('partial rain data reports only the known amount', () => {
  const value = outlook(series(NOW, hours(12, { 0: wet(2), 1: wet(2), 6: { rainAmount: null } })));
  assert.equal(value.firstSpell?.knownAmountOnly, true);
  assert.deepEqual(copy(value), { headline: 'Rain likely until 11 AM', detail: 'Peak 60% · Known rain 4 mm', confidence: 'Partial data' });
});

test('imperial amounts and the 24-hour format', () => {
  const imperial = outlook(series(NOW, hours(12, { 0: wet(0.05), 1: wet(0.05), 2: wet(0.06) })), NOW, 'in');
  assert.equal(copy(imperial).detail, 'Peak 60% · 0.16 in rain');
  const below = outlook(series(NOW, hours(12, { 0: wet(0.003) })), NOW, 'in');
  assert.equal(below.firstSpell, null, '0.003 in is below the 0.004 in rain threshold');
  const now = outlook(series(NOW, hours(12, { 0: wet(), 1: wet(), 2: wet() })));
  assert.equal(copy(now, 'full', { clock: '24h' }).headline, 'Rain likely until 12:00');
  const soon = outlook(series(NOW, hours(12, { 6: wet(), 7: wet(), 8: wet() })));
  assert.equal(copy(soon, 'compact', { clock: '24h' }).headline, 'Rain likely 15:00–18:00');
});

test('compact times drop “:00”, share AM/PM and keep half-hour minutes', () => {
  const at = (iso: string) => new Date(iso).toISOString();
  assert.equal(compactWeatherRange(at('2026-10-18T19:00:00Z'), at('2026-10-18T22:00:00Z'), TORONTO, '12h'), '3–6 PM');
  assert.equal(compactWeatherRange(at('2026-10-18T15:00:00Z'), at('2026-10-18T18:00:00Z'), TORONTO, '12h'), '11 AM–2 PM');
  assert.equal(compactWeatherRange(at('2026-10-18T19:00:00Z'), at('2026-10-18T22:00:00Z'), TORONTO, '24h'), '15:00–18:00');
  assert.equal(compactWeatherRange(at('2026-10-18T09:00:00Z'), at('2026-10-18T12:00:00Z'), 'Asia/Kolkata', '12h'), '2:30–5:30 PM');
  assert.equal(compactWeatherRange(at('2026-10-18T05:00:00Z'), at('2026-10-18T08:00:00Z'), 'Asia/Kolkata', '12h'), '10:30 AM–1:30 PM');
  assert.equal(compactWeatherTime(at('2026-10-18T16:00:00Z'), TORONTO, '12h'), '12 PM');
  assert.equal(compactWeatherTime(at('2026-10-18T04:00:00Z'), TORONTO, '12h'), '12 AM');
  assert.equal(compactWeatherTime(at('2026-10-18T04:00:00Z'), TORONTO, '24h'), '00:00');
  const kolkata = outlook(series(Date.parse('2026-10-18T08:00:00Z'), hours(13, { 1: wet(), 2: wet() })), Date.parse('2026-10-18T09:00:00Z'));
  assert.equal(copy(kolkata, 'compact', { timeZone: 'Asia/Kolkata', now: Date.parse('2026-10-18T09:00:00Z') }).headline, 'Rain likely until 4:30 PM');
});

test('times use the weather city timezone, not the computer timezone', () => {
  const value = outlook(series(NOW, hours(12, { 0: wet(), 1: wet(), 2: wet() })));
  assert.equal(copy(value, 'full', { timeZone: 'Asia/Tokyo' }).headline, 'Rain likely until 1 AM');
  assert.equal(copy(value, 'full', { timeZone: 'Europe/London' }).headline, 'Rain likely until 5 PM');
  assert.equal(copy(value).headline, 'Rain likely until 12 PM');
});

test('the America/Toronto fall-back hour keeps instants honest across the repeated 1 AM', () => {
  const night = Date.parse('2026-11-01T04:00:00Z'); // 12 AM EDT; 06:00Z is 1 AM EST
  const value = outlook(series(night, hours(12, { 1: wet(), 2: wet(), 3: wet() })), night);
  assert.equal(value.kind, 'soon');
  assert.equal(Date.parse(value.firstSpell!.end) - Date.parse(value.firstSpell!.start), 3 * HOUR, 'the spell spans three real hours');
  assert.equal(copy(value, 'full', { now: night }).headline, 'Rain likely 1–3 AM');
  const during = outlook(series(night, hours(12, { 0: wet(), 1: wet(), 2: wet() })), night);
  assert.equal(copy(during, 'full', { now: night }).headline, 'Rain likely until 2 AM', '07:00Z is 2 AM EST after the repeated hour');
});

test('expired intervals are ignored, including one ending exactly now', () => {
  const past = series(NOW - 3 * HOUR, hours(15, { 0: wet(), 1: wet(), 2: wet() }));
  const value = outlook(past);
  assert.equal(value.kind, 'calm'); assert.equal(value.hours[0]!.start, new Date(NOW).toISOString());
  assert.equal(value.hours.length, 12);
});
