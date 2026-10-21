/** Synthetic provider responses and data used only by automated tests. */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import type { Settings } from '../shared/contracts.ts';
import { defaultSettings } from '../shared/defaults.ts';
import { defaultWidgetGrid, defaultWidgetVisibility } from '../shared/widgets.ts';
import { persistableData } from './persistence.ts';

/**
 * Today's defaults on the catalog board: Clock, Weather, Forecast, Reminders and Last screen at the
 * catalog placements, which older data backfills from and which new installs started with before
 * #435. A fresh data folder starts on the default board (`DEFAULT_BOARD`), which fills the grid;
 * tests whose geometry was written for the catalog board, or that need free cells, start here.
 */
export function catalogBoardDefaults(): Settings {
  const settings = defaultSettings();
  settings.widgets = defaultWidgetVisibility();
  settings.widgetGrid = defaultWidgetGrid();
  return settings;
}

/**
 * Default data as an existing user has it: the catalog board (before #435) with a colour accent
 * (before #75). A fresh data folder starts Native on the default board; tests that need a choice to
 * be a real change in the files, or the data an upgraded install holds, start from these settings.
 */
export function colorAccentDefaults(): Settings {
  const settings = catalogBoardDefaults();
  settings.appearance.accentMode = 'color';
  return settings;
}

/** Writes colorAccentDefaults() in its at-rest form into an empty data folder before the store opens it. */
export async function seedColorAccentData(directory: string): Promise<void> {
  await writeFile(join(directory, 'state.json'), JSON.stringify(persistableData({ version: 1, settings: colorAccentDefaults(), reminders: [], photoAsset: null }), null, 2));
}

export function photoFixture(width = 2, height = 2, pixels?: Buffer): Buffer {
  const chunk = (type: string, content: Buffer) => {
    const result = Buffer.alloc(content.length + 12); result.writeUInt32BE(content.length); result.write(type, 4); content.copy(result, 8);
    let crc = 0xffffffff;
    for (const byte of result.subarray(4, 8 + content.length)) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + content.length); return result;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels ?? Buffer.alloc((width * 4 + 1) * height))), chunk('IEND', Buffer.alloc(0))]);
}

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
