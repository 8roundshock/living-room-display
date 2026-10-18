export function temperature(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)}°`;
}

export function precipitation(value: number, unit: 'mm' | 'in'): string {
  if (unit === 'in') return `${value.toFixed(2)} in`;
  return `${value < 1 ? value.toFixed(1) : Math.round(value)} mm`;
}

export function ageLabel(
  timestamp: string | null | undefined,
  now = Date.now(),
): string {
  if (!timestamp) return 'Not updated yet';
  const minutes = Math.max(
    0,
    Math.floor((now - new Date(timestamp).getTime()) / 60_000),
  );
  if (!Number.isFinite(minutes)) return 'Update time unknown';
  if (minutes < 1) return 'Updated just now';
  if (minutes < 60) return `Updated ${minutes} min ago`;
  if (minutes < 24 * 60) return `Updated ${Math.floor(minutes / 60)} hr ago`;
  return `Updated ${Math.floor(minutes / 1440)} days ago`;
}

function civilDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) =>
    parts.find((value) => value.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function forecastDay(
  date: string,
  timeZone: string,
  now: Date | number,
  compact = false,
): string {
  const today = civilDate(new Date(now), timeZone);
  if (date === today) return 'Today';
  // Advance the civil calendar, rather than adding 24 hours across a DST change.
  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (date === tomorrow.toISOString().slice(0, 10))
    return compact ? 'Tom.' : 'Tomorrow';
  // Provider date-only values are calendar days; UTC here preserves that weekday.
  return new Intl.DateTimeFormat('en', {
    weekday: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${date.slice(0, 10)}T12:00:00Z`));
}

export function forecastPeriod(
  start: string,
  end: string,
  timeZone: string,
  format: '12h' | '24h',
  now: Date | number,
): string {
  const today = civilDate(new Date(now), timeZone);
  const startDate = civilDate(new Date(start), timeZone);
  const endDate = civilDate(new Date(end), timeZone);
  const startDay =
    startDate === today ? '' : `${forecastDay(startDate, timeZone, now)} `;
  const endDay =
    endDate === startDate ? '' : `${forecastDay(endDate, timeZone, now)} `;
  return `${startDay}${weatherTime(start, timeZone, format)}–${endDay}${weatherTime(end, timeZone, format)}`;
}

export function weatherTime(
  timestamp: string,
  timeZone: string,
  format: '12h' | '24h',
): string {
  return new Intl.DateTimeFormat('en', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: format === '12h',
    timeZone,
  }).format(new Date(timestamp));
}

export function nextComposition(current: number): number {
  return (current + 1) % 4;
}

export function localInputDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function reminderDate(iso: string | null, now = new Date()): string {
  if (!iso) return 'Anytime';
  const date = new Date(iso);
  const sameDay = date.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const day = sameDay
    ? 'Today'
    : date.toDateString() === tomorrow.toDateString()
      ? 'Tomorrow'
      : new Intl.DateTimeFormat('en', {
          month: 'short',
          day: 'numeric',
        }).format(date);
  return `${day} · ${new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(date)}`;
}
