import { koreanCalendarAvailable } from '../shared/holidays';
import { CALENDAR_LABELS, HOLIDAY_CALENDARS, type ThemeCalendar } from '../shared/themes';

/** One shared binding for Style and Dynamic's holiday-only configuration. */
export function HolidayCalendars({ value, onChange, disabled = false }: { value: ThemeCalendar[]; onChange: (value: ThemeCalendar[]) => void; disabled?: boolean }) {
  return <>
    <fieldset className="theme-calendars" disabled={disabled}><legend>Holiday calendars</legend>
      {HOLIDAY_CALENDARS.map(calendar => <label key={calendar}><input type="checkbox" checked={value.includes(calendar)} onChange={event => onChange(HOLIDAY_CALENDARS.filter(item => item === calendar ? event.target.checked : value.includes(item)))} />{CALENDAR_LABELS[calendar]}</label>)}
    </fieldset>
    {value.includes('KR') && !koreanCalendarAvailable() && <p className="theme-current">Korean lunar dates are unavailable in this browser. Fixed dates still appear.</p>}
  </>;
}
