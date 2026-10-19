import type { WidgetContentProps, WidgetModule } from './types.ts';

function Clock({ settings, now, size }: WidgetContentProps) {
  const parts = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit', hour12: settings.clockFormat === '12h' }).formatToParts(now);
  const clock = parts.filter(part => part.type !== 'dayPeriod').map(part => part.value).join('').trim(); const period = parts.find(part => part.type === 'dayPeriod')?.value;
  return <div className={`clock-face clock-family-${size} clock-style-${settings.appearance.clockStyle}`}>
    <div className="clock-calendar"><div className="ambient-label">{new Intl.DateTimeFormat('en', { weekday: size === 'small' ? 'short' : 'long' }).format(now)}</div><div className="clock-date">{new Intl.DateTimeFormat('en', { month: size === 'small' ? 'short' : 'long', day: 'numeric' }).format(now)}</div></div>
    {settings.appearance.clockStyle === 'analog' ? <svg className="analog-clock" viewBox="0 0 100 100" role="img" aria-label={`${clock} ${period ?? ''}`}><line x1="50" y1="53" x2="50" y2="27" transform={`rotate(${(now.getHours() % 12 + now.getMinutes() / 60) * 30} 50 50)`} /><line className="analog-minute" x1="50" y1="54" x2="50" y2="12" transform={`rotate(${now.getMinutes() * 6} 50 50)`} /></svg> : <div className={`clock-time clock-${settings.appearance.clockStyle}`}><span className="clock-digits">{clock}</span>{period && <span className="clock-period">{period}</span>}</div>}
  </div>;
}

export const ClockWidget: WidgetModule = { Renderer: Clock };
