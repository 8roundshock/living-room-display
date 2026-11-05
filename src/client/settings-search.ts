/** Navigation only: finding a setting never changes its value or runs its action. */
export const SETTINGS_SEARCH_ITEMS = [
  { id: 'city', label: 'City', section: 'Location & weather', selector: '#city-search', terms: 'location weather place forecast area town' },
  { id: 'location', label: 'Use device location', section: 'Location & weather', selector: '#settings-device-location', terms: 'gps position automatic locate permission' },
  { id: 'units', label: 'Units', section: 'Time & units', selector: '#settings-units', terms: 'temperature celsius fahrenheit metric imperial distance speed degrees c f' },
  { id: 'time', label: 'Time format', section: 'Time & units', selector: '#settings-clock-format', terms: 'clock hours 12 24 am pm' },
  { id: 'screen', label: 'Keep the screen on', section: 'This device', selector: '.settings-device-card .toggle', terms: 'awake sleep power monitor display' },
  { id: 'schedule', label: 'Edit schedule', section: 'Schedule', selector: '#settings-schedule .schedule-disclosure > summary', terms: 'automatic styles weekday weekend morning night rules timetable' },
  { id: 'birthdays', label: 'Birthdays', section: 'Birthdays', selector: '#settings-birthdays', terms: 'birthday annual celebration date russian korean classic' },
  { id: 'export', label: 'Export saved data', section: 'Data & recovery', selector: '#settings-recovery .data-actions a', terms: 'backup download save copy' },
  { id: 'restore', label: 'Restore from backup', section: 'Data & recovery', selector: '#settings-recovery .data-actions button', terms: 'import upload recover reset recovery' },
] as const;

export type SettingsSearchItem = typeof SETTINGS_SEARCH_ITEMS[number];

export function findSettings(query: string): SettingsSearchItem[] {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return SETTINGS_SEARCH_ITEMS.filter(item => {
    const text = `${item.label} ${item.section} ${item.terms}`.toLocaleLowerCase();
    return words.every(word => text.includes(word));
  });
}
