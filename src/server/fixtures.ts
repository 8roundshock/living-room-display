/** Synthetic provider response used only by automated tests. */
export function forecastFixture(start = Date.parse('2026-10-18T04:00:00Z') / 1000) {
  const daily = Array.from({ length: 7 }, (_, index) => start + index * 86400);
  const hourly = Array.from({ length: 168 }, (_, index) => start + index * 3600);
  return {
    timezone: 'America/Toronto',
    utc_offset_seconds: -14400,
    current: { time: start + 2 * 3600, temperature_2m: 14, apparent_temperature: 13, weather_code: 3, is_day: 0, wind_speed_10m: 8 },
    daily: { time: daily, weather_code: daily.map(() => 3), temperature_2m_max: daily.map(() => 17), temperature_2m_min: daily.map(() => 9), precipitation_probability_max: daily.map(() => 60), precipitation_sum: daily.map(() => 2) },
    hourly: { time: hourly, precipitation_probability: hourly.map(() => 60), precipitation: hourly.map(() => 1), rain: hourly.map(() => 0.6), showers: hourly.map(() => 0.2) },
  };
}
