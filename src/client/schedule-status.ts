import type { SavedPreset } from '../shared/contracts';
import type { ScheduleSnapshot } from '../shared/schedule';

/** Uses the scheduler's timezone, even when another browser has a different local clock. */
export function scheduleStatus(snapshot: ScheduleSnapshot | undefined, presets: readonly SavedPreset[]): string {
  if (!snapshot?.config.enabled) return 'Schedule off. Your manual style is on the display.';
  const { selection } = snapshot;
  if (selection.source === 'override' && snapshot.overrideUntil) {
    const until = new Date(snapshot.overrideUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: snapshot.timeZone });
    return `Manual style until ${until}. The schedule resumes automatically.`;
  }
  const name = presets.find(item => item.id === selection.presetId)?.name;
  if (selection.source === 'rule') return `${name ?? 'Saved style'} · scheduled now`;
  if (selection.source === 'fallback') return `${name ?? 'Saved style'} · outside scheduled times`;
  return 'Manual style · outside scheduled times';
}
