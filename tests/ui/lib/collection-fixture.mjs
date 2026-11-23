// Synthetic collection fixtures. Idempotent: existing checks' reminder/city fixtures are preserved.
export function prepareCollection(state, { now = Date.parse(state.weather?.updatedAt ?? '') || Date.now() } = {}) {
  const at = offset => new Date(now + offset * 3600_000).toISOString();
  state.timers ??= [{ id: 'collection-timer', label: 'Tea', durationMs: 600000, endsAt: new Date(now + 480000).toISOString(), remainingMs: null, createdAt: at(0), updatedAt: at(0) }];
  // Conditions are clear to overcast only (WMO 0-3), so no widget reads a hazard from them; Hourly forecast (#714) draws their glyphs.
  // The cycle puts a clear hour before the fixture's sunset and a partly cloudy one after it, so both glyphs depend on the sun.
  state.weather.details = Array.from({ length: 25 }, (_, index) => ({ time: new Date(Math.floor(now / 3600000) * 3600000 + index * 3600000).toISOString(), weatherCode: [1, 0, 2, 3][index % 4], temperature: 13 + Math.sin(index / 4) * 4, humidity: 65 - index % 5 * 3, dewPoint: 8, pressure: 1012 + index / 3, visibility: 18000 + index * 500, cloudCover: 40 + index % 4 * 10, windSpeed: 12 + index % 4 * 2, windDirection: 225, windGust: 24 + index % 4 * 2 }));
  state.alerts ??= { status: 'fresh', provider: 'eccc', source: 'Environment and Climate Change Canada', sourceUrl: 'https://weather.gc.ca/', area: 'Sample area', checkedAt: at(0), error: null, alerts: [] };
}
