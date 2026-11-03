import type { WidgetModule } from './types.ts';

/** Synthetic data only, relative to the picker's public sample clock. Never reads private content. */
export const collectionSample: NonNullable<WidgetModule['sample']> = ({ state, settings }) => {
  const anchor = Date.parse(state.weather.updatedAt ?? '') || Date.now(),
    hour = Math.floor(anchor / 3600_000) * 3600_000;
  const at = (offset: number) => new Date(anchor + offset * 3600_000).toISOString();
  const next = {
    ...settings,
    widgetData: {
      ...settings.widgetData,
      worldClocks: [
        {
          id: 'collection-london',
          label: 'London',
          timezone: 'Europe/London',
          latitude: 51.51,
          longitude: -0.13,
        },
        {
          id: 'collection-new-york',
          label: 'New York',
          timezone: 'America/New_York',
          latitude: 40.71,
          longitude: -74.01,
        },
      ],
    },
  };
  return {
    settings: next,
    state: {
      ...state,
      settings: next,
      reminders: [1, 3, 26, 51].map((offset, index) => ({
        id: `collection-reminder-${index}`,
        text: ['Water the plants', 'Evening walk', 'Library books', 'Coffee with a friend'][index]!,
        dueAt: at(offset),
        completed: false,
        createdAt: at(-1),
        updatedAt: at(-1),
      })),
      timers: [
        {
          id: 'collection-timer',
          label: 'Tea',
          durationMs: 600_000,
          endsAt: new Date(anchor + 480_000).toISOString(),
          remainingMs: null,
          createdAt: at(0),
          updatedAt: at(0),
        },
      ],
      weather: {
        ...state.weather,
        details: Array.from({ length: 25 }, (_, index) => ({
          time: new Date(hour + index * 3600_000).toISOString(),
          temperature: 13 + Math.sin(index / 4) * 4,
          humidity: 65 - (index % 5) * 3,
          dewPoint: 8,
          pressure: 1012 + index / 3,
          visibility: 18000 + index * 500,
          cloudCover: 40 + (index % 4) * 10,
          windSpeed: 12 + (index % 4) * 2,
          windDirection: 225,
          windGust: 24 + (index % 4) * 2,
        })),
      },
      alerts: {
        status: 'fresh',
        provider: 'eccc',
        source: 'Environment and Climate Change Canada',
        sourceUrl: 'https://weather.gc.ca/',
        area: 'Sample area',
        checkedAt: at(0),
        error: null,
        alerts: [],
      },
    },
  };
};
