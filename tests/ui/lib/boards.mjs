// Shared synthetic boards for the browser suites.

/**
 * Every active widget on one Balanced 12 x 8 board, every cell used; a newly activated widget must be
 * added here. The palette, motion and widgets suites still keep identical copies until #388.
 */
export const FULL_BOARD = Object.freeze({
  clock: { column: 0, row: 0, size: 'medium' }, worldClocks: { column: 4, row: 0, size: 'medium' }, weather: { column: 8, row: 0, size: 'large' },
  sunMoon: { column: 0, row: 2, size: 'medium' }, dynamic: { column: 0, row: 4, size: 'medium' }, calendar: { column: 4, row: 2, size: 'medium' }, airQuality: { column: 4, row: 4, size: 'medium' },
  reminders: { column: 8, row: 4, size: 'medium' }, forecast: { column: 0, row: 6, size: 'medium' }, countdown: { column: 4, row: 6, size: 'small' },
  note: { column: 6, row: 6, size: 'small' }, preview: { column: 8, row: 6, size: 'small' }, photo: { column: 10, row: 6, size: 'small' },
});

/** Second Balanced board: every addition from #565 at its smallest useful family. */
export const COLLECTION_BOARD = Object.freeze({
  timers: { column: 0, row: 0, size: 'small' }, dayProgress: { column: 2, row: 0, size: 'small' }, yearProgress: { column: 4, row: 0, size: 'small' }, wind: { column: 6, row: 0, size: 'small' }, humidity: { column: 8, row: 0, size: 'small' }, pressure: { column: 10, row: 0, size: 'small' },
  visibility: { column: 0, row: 2, size: 'small' }, cloudCover: { column: 2, row: 2, size: 'small' }, agenda: { column: 4, row: 2, size: 'medium' }, weekAhead: { column: 8, row: 2, size: 'medium' },
  timeOverlap: { column: 0, row: 4, size: 'medium' }, weatherAlerts: { column: 4, row: 4, size: 'medium' }, hourlyTemperature: { column: 8, row: 4, size: 'medium' },
  precipitation: { column: 0, row: 6, size: 'medium' }, quietScene: { column: 4, row: 6, size: 'medium' },
});
export const WIDGET_BOARDS = [FULL_BOARD, COLLECTION_BOARD];
