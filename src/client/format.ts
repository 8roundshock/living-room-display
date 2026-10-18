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

export function forecastDay(date: string, index: number): string {
  if (index === 0) return 'Today';
  // A date-only provider value describes its local calendar day, not UTC midnight.
  return new Intl.DateTimeFormat('en', { weekday: 'short' }).format(
    new Date(`${date.slice(0, 10)}T12:00:00`),
  );
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
