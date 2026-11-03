// Synthetic collection fixtures. Idempotent: existing checks' reminder/city fixtures are preserved.
export function prepareCollection(state, { now = Date.parse(state.weather?.updatedAt ?? '') || Date.now() } = {}) {
  const at = offset => new Date(now + offset * 3600_000).toISOString();
  state.timers ??= [{ id: 'collection-timer', label: 'Tea', durationMs: 600000, endsAt: new Date(now + 480000).toISOString(), remainingMs: null, createdAt: at(0), updatedAt: at(0) }];
  state.weather.details = Array.from({ length: 25 }, (_, index) => ({ time: new Date(Math.floor(now / 3600000) * 3600000 + index * 3600000).toISOString(), temperature: 13 + Math.sin(index / 4) * 4, humidity: 65 - index % 5 * 3, dewPoint: 8, pressure: 1012 + index / 3, visibility: 18000 + index * 500, cloudCover: 40 + index % 4 * 10, windSpeed: 12 + index % 4 * 2, windDirection: 225, windGust: 24 + index % 4 * 2 }));
  state.alerts ??= { status: 'fresh', provider: 'eccc', source: 'Environment and Climate Change Canada', sourceUrl: 'https://weather.gc.ca/', area: 'Sample area', checkedAt: at(0), error: null, alerts: [] };
}
