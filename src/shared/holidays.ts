/** Offline display observances, not an employment/bank-closure calendar. See docs/holiday-calendar.md. */
import { holidayScenePolicy, type HolidayScenePolicy } from './theme-registry.ts';

export const HOLIDAY_REGIONS = ['CA', 'KR', 'RU'] as const;
export type HolidayRegion = typeof HOLIDAY_REGIONS[number];
export const HOLIDAY_REGION_NAMES: Readonly<Record<HolidayRegion, string>> = { CA: 'Canada', KR: 'Korea', RU: 'Russia' };
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export interface Observance {
  readonly id: string;
  readonly name: string;
  readonly shortName: string;
  readonly region: HolidayRegion;
  /** Central holiday date; start/end include the regular surrounding holiday days, not substitute days. */
  readonly date: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly category: 'public' | 'cultural' | 'commemorative';
  readonly kind: 'celebration' | 'commemoration';
}
export interface HolidayWindow {
  observance: Observance;
  policy: Exclude<HolidayScenePolicy, { role: 'card' }>;
  phase: 'approaching' | 'today';
}
const DAY = 86_400_000;
const MIN_YEAR = 1900, MAX_YEAR = 2199;
const cache = new Map<number, readonly Observance[]>();
const CACHE_YEARS = 12;
const iso = (date: Date) => date.toISOString().slice(0, 10);
const fixed = (year: number, month: number, day: number) => iso(new Date(Date.UTC(year, month - 1, day, 12)));
function validDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T12:00:00Z`)) && iso(new Date(`${date}T12:00:00Z`)) === date;
}
export function shiftHolidayDate(date: string, days: number): string {
  if (!validDate(date) || !Number.isInteger(days)) throw new RangeError('Expected a civil date and whole days');
  return iso(new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY));
}
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
function nthMonday(year: number, month: number, nth: number): string {
  const first = fixed(year, month, 1);
  return shiftHolidayDate(first, (8 - weekday(first)) % 7 + 7 * (nth - 1));
}

/** Gregorian ecclesiastical Easter, Oudin algorithm published by the US Naval Observatory. */
export function westernEaster(year: number): string {
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) throw new RangeError('Unsupported calendar year');
  const div = (a: number, b: number) => Math.floor(a / b);
  const c = div(year, 100), n = year - 19 * div(year, 19), k = div(c - 17, 25);
  let i = c - div(c, 4) - div(c - k, 3) + 19 * n + 15;
  i -= 30 * div(i, 30);
  i -= div(i, 28) * (1 - div(i, 28) * div(29, i + 1) * div(21 - n, 11));
  let j = year + div(year, 4) + i + 2 - c + div(c, 4);
  j -= 7 * div(j, 7);
  const l = i - j, month = 3 + div(l + 40, 44), day = l + 28 - 31 * div(month, 4);
  return fixed(year, month, day);
}

/** Julian ecclesiastical Pascha converted to a Gregorian civil date, with its changing century offset. */
export function orthodoxEaster(year: number): string {
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) throw new RangeError('Unsupported calendar year');
  const moon = (19 * (year % 19) + 15) % 30;
  const nextSunday = (2 * (year % 4) + 4 * (year % 7) - moon + 34) % 7;
  const index = moon + nextSunday + 114;
  const julianMonth = Math.floor(index / 31), julianDay = index % 31 + 1;
  // Pascha is after February, so the current year's Gregorian century correction applies.
  const calendarOffset = Math.floor(year / 100) - Math.floor(year / 400) - 2;
  return shiftHolidayDate(fixed(year, julianMonth, julianDay), calendarOffset);
}

let dangi: Intl.DateTimeFormat | null | undefined;
/** No Chinese-calendar fallback: the Korean and Chinese dates differ in some years, including 2027. */
function koreanFormatter(): Intl.DateTimeFormat | null {
  if (dangi !== undefined) return dangi;
  try {
    const candidate = new Intl.DateTimeFormat('en-u-ca-dangi', { calendar: 'dangi', timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric' });
    if (candidate.resolvedOptions().calendar !== 'dangi') return dangi = null;
    const parts = candidate.formatToParts(new Date('2027-02-07T12:00:00Z'));
    if (parts.find(part => part.type === 'month')?.value !== '1' || parts.find(part => part.type === 'day')?.value !== '1') return dangi = null;
    return dangi = candidate;
  } catch { return dangi = null; }
}
export function koreanCalendarAvailable(): boolean { return koreanFormatter() !== null; }
function koreanLunarDates(year: number): Map<string, string> {
  const formatter = koreanFormatter(), result = new Map<string, string>();
  if (!formatter) return result;
  const nextYear = Date.UTC(year + 1, 0, 1, 12);
  for (let at = Date.UTC(year, 0, 1, 12); at < nextYear; at += DAY) {
    const parts = formatter.formatToParts(new Date(at));
    const month = parts.find(part => part.type === 'month')?.value ?? '';
    const day = parts.find(part => part.type === 'day')?.value ?? '';
    // ICU marks leap months with a suffix (for example 4bis). Never parseInt it into a regular month.
    if (!/^\d+$/.test(month) || !/^\d+$/.test(day)) continue;
    result.set(`${Number(month)}/${Number(day)}`, iso(new Date(at)));
  }
  return result;
}

function buildYear(year: number): readonly Observance[] {
  const values: Observance[] = [];
  type Options = Partial<Pick<Observance, 'shortName' | 'startDate' | 'endDate' | 'category' | 'kind'>>;
  const add = (region: HolidayRegion, id: string, name: string, date: string, options: Options = {}) => {
    values.push(Object.freeze({ id: `${region.toLowerCase()}:${id}`, name, shortName: name, region, date, startDate: date, endDate: date,
      category: 'public', kind: 'celebration', ...options }));
  };
  const commemorative = { kind: 'commemoration' } as const;
  const easter = westernEaster(year);
  add('CA', 'new-year', 'New Year’s Day', fixed(year, 1, 1));
  add('CA', 'valentines', 'Valentine’s Day', fixed(year, 2, 14), { category: 'cultural' });
  add('CA', 'flag-day', 'National Flag of Canada Day', fixed(year, 2, 15), { category: 'commemorative', shortName: 'Flag Day' });
  add('CA', 'good-friday', 'Good Friday', shiftHolidayDate(easter, -2), commemorative);
  add('CA', 'easter', 'Easter', easter, { category: 'cultural' });
  add('CA', 'easter-monday', 'Easter Monday', shiftHolidayDate(easter, 1));
  const victoria = fixed(year, 5, 24);
  add('CA', 'victoria', 'Victoria Day', shiftHolidayDate(victoria, -((weekday(victoria) + 6) % 7)));
  add('CA', 'indigenous', 'National Indigenous Peoples Day', fixed(year, 6, 21), { category: 'commemorative', shortName: 'Indigenous Peoples Day' });
  add('CA', 'canada-day', 'Canada Day', fixed(year, 7, 1));
  add('CA', 'labour', 'Labour Day', nthMonday(year, 9, 1));
  add('CA', 'reconciliation', 'National Day for Truth and Reconciliation', fixed(year, 9, 30), { ...commemorative, shortName: 'Truth and Reconciliation' });
  add('CA', 'thanksgiving', 'Thanksgiving', nthMonday(year, 10, 2));
  add('CA', 'halloween', 'Halloween', fixed(year, 10, 31), { category: 'cultural' });
  add('CA', 'remembrance', 'Remembrance Day', fixed(year, 11, 11), commemorative);
  add('CA', 'christmas', 'Christmas', fixed(year, 12, 25));
  add('CA', 'boxing-day', 'Boxing Day', fixed(year, 12, 26));

  add('KR', 'new-year', 'New Year’s Day', fixed(year, 1, 1));
  add('KR', 'independence-movement', 'Independence Movement Day', fixed(year, 3, 1), { ...commemorative, shortName: 'March 1st Movement' });
  add('KR', 'labour', 'Labour Day', fixed(year, 5, 1));
  add('KR', 'children', 'Children’s Day', fixed(year, 5, 5));
  add('KR', 'memorial', 'Memorial Day', fixed(year, 6, 6), commemorative);
  add('KR', 'constitution', 'Constitution Day', fixed(year, 7, 17));
  add('KR', 'liberation', 'Liberation Day', fixed(year, 8, 15));
  add('KR', 'foundation', 'National Foundation Day', fixed(year, 10, 3), { shortName: 'Foundation Day' });
  add('KR', 'hangeul', 'Hangeul Day', fixed(year, 10, 9));
  add('KR', 'christmas', 'Christmas', fixed(year, 12, 25));
  const lunar = koreanLunarDates(year);
  const lunarDay = (key: string, id: string, name: string, options: Options = {}, multiDay = false) => {
    const date = lunar.get(key);
    if (date) add('KR', id, name, date, { ...options, ...(multiDay ? { startDate: shiftHolidayDate(date, -1), endDate: shiftHolidayDate(date, 1) } : {}) });
  };
  lunarDay('1/1', 'seollal', 'Seollal', {}, true);
  lunarDay('1/15', 'daeboreum', 'Jeongwol Daeboreum', { category: 'cultural', shortName: 'First Full Moon' });
  lunarDay('4/8', 'buddha', 'Buddha’s Birthday');
  lunarDay('5/5', 'dano', 'Dano', { category: 'cultural' });
  lunarDay('7/7', 'chilseok', 'Chilseok', { category: 'cultural' });
  lunarDay('8/15', 'chuseok', 'Chuseok', {}, true);

  add('RU', 'new-year', 'New Year holidays', fixed(year, 1, 1), { endDate: fixed(year, 1, 8) });
  add('RU', 'christmas', 'Orthodox Christmas', fixed(year, 1, 7));
  add('RU', 'old-new-year', 'Old New Year', fixed(year, 1, 14), { category: 'cultural' });
  const pascha = orthodoxEaster(year);
  add('RU', 'easter', 'Orthodox Easter', pascha, { category: 'cultural' });
  add('RU', 'maslenitsa', 'Maslenitsa', shiftHolidayDate(pascha, -49), {
    category: 'cultural', startDate: shiftHolidayDate(pascha, -55), endDate: shiftHolidayDate(pascha, -49),
  });
  add('RU', 'defender', 'Defender of the Fatherland Day', fixed(year, 2, 23), { ...commemorative, shortName: 'Defender’s Day' });
  add('RU', 'women', 'International Women’s Day', fixed(year, 3, 8));
  add('RU', 'spring-labour', 'Spring and Labour Day', fixed(year, 5, 1));
  add('RU', 'victory', 'Victory Day', fixed(year, 5, 9), commemorative);
  add('RU', 'russia', 'Russia Day', fixed(year, 6, 12));
  add('RU', 'unity', 'Unity Day', fixed(year, 11, 4));
  return Object.freeze(values.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)));
}

export function observancesForYear(year: number, regions: readonly HolidayRegion[] = HOLIDAY_REGIONS): readonly Observance[] {
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) return [];
  let values = cache.get(year);
  if (!values) {
    values = buildYear(year);
    if (cache.size >= CACHE_YEARS) cache.delete(cache.keys().next().value!);
    cache.set(year, values);
  }
  return values.filter(value => regions.includes(value.region));
}

/** Only authored scene policies compete: quiet days, central major dates, ongoing holidays, then anticipation. */
export function holidayWindow(date: string, regions: readonly HolidayRegion[] = HOLIDAY_REGIONS): HolidayWindow | null {
  if (!validDate(date)) return null;
  const year = Number(date.slice(0, 4));
  if (year < MIN_YEAR || year > MAX_YEAR) return null;
  const candidates: HolidayWindow[] = [year - 1, year, year + 1].flatMap(value => observancesForYear(value, regions)).flatMap((observance): HolidayWindow[] => {
    const policy = holidayScenePolicy(observance.id);
    if (policy.role === 'card') return [];
    if (policy.role === 'quiet') return date === observance.date ? [{ observance, policy, phase: 'today' }] : [];
    const approach = shiftHolidayDate(observance.date, -policy.leadDays);
    const starts = approach < observance.startDate ? approach : observance.startDate;
    const ends = policy.endOffset === undefined ? observance.endDate : shiftHolidayDate(observance.date, policy.endOffset);
    if (date < starts || date > ends) return [];
    const phase = date < observance.startDate ? 'approaching' as const : 'today' as const;
    return [{ observance, policy, phase }];
  });
  const priority = (candidate: HolidayWindow) => candidate.policy.role === 'major' ? candidate.policy.priority : 0;
  candidates.sort((a, b) => Number(b.policy.role === 'quiet') - Number(a.policy.role === 'quiet')
    || Number(b.observance.date === date) - Number(a.observance.date === date)
    || Number(b.phase === 'today') - Number(a.phase === 'today')
    || priority(b) - priority(a)
    || Math.abs(Date.parse(a.observance.date) - Date.parse(date)) - Math.abs(Date.parse(b.observance.date) - Date.parse(date))
    || a.observance.id.localeCompare(b.observance.id));
  return candidates[0] ?? null;
}

/** Meteorological seasons: use the weather location hemisphere; north is the documented missing-location fallback. */
export function seasonForDate(date: string, hemisphere: 'north' | 'south' = 'north'): Season {
  const month = validDate(date) ? Number(date.slice(5, 7)) : 1;
  const index = Math.floor(month % 12 / 3);
  return (hemisphere === 'south' ? ['summer', 'autumn', 'winter', 'spring'] : ['winter', 'spring', 'summer', 'autumn'])[index] as Season;
}
