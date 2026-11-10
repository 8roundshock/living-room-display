/**
 * Follow daylight's dim time (#591): the local clock time, at the weather location, when the display
 * leaves its evening level and glides to Dimmest. Shared by validation, the editor and the curve.
 */

/** 11 PM: the owner's default (2026-11-09). Data saved before #591 reads as this. */
export const DEFAULT_DIM_TIME = '23:00';

/** Half-hour choices from 8 PM through midnight to 3 AM, in evening order. */
export const DIM_TIMES: readonly string[] = (() => {
  const times: string[] = [];
  for (let minutes = 20 * 60; minutes <= 27 * 60; minutes += 30) {
    const hour = Math.floor(minutes / 60) % 24;
    times.push(`${String(hour).padStart(2, '0')}:${minutes % 60 === 0 ? '00' : '30'}`);
  }
  return times;
})();

export function isDimTime(value: unknown): value is string {
  return typeof value === 'string' && DIM_TIMES.includes(value);
}

/** Minutes after local midnight for a dim time; anything else reads as the default. */
export function dimTimeMinutes(value: string | null | undefined): number {
  const time = isDimTime(value) ? value : DEFAULT_DIM_TIME;
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}
