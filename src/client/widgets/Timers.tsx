import { orderTimers, timerName, timerPhase, timerRemaining, visibleTimers } from '../../shared/timers.ts';
import { timerDigits, timeLeft } from '../timer.ts';
import { CollectionEmpty, CollectionFace } from './CollectionParts.tsx';
import { TransitionText } from './TransitionText.tsx';
import { collectionSample } from './collection-samples.ts';
import type { WidgetContentProps, WidgetModule } from './types.ts';
import './timers.css';

function Timers({ state, size, now, disconnected }: WidgetContentProps) {
  const at = now.getTime(),
    timers = orderTimers(visibleTimers(state.timers ?? [], at, true), at),
    count = size === 'small' ? 1 : size === 'medium' ? 2 : 4;
  return (
    <CollectionFace name="Timers" size={size} className="timers-face">
      {!timers.length ? (
        <CollectionEmpty>
          {disconnected
            ? 'Timers unavailable · offline'
            : state.timersWarning
              ? 'Timers unavailable'
              : 'No active timers'}
        </CollectionEmpty>
      ) : (
        <ul className="collection-list">
          {timers.slice(0, count).map((timer) => {
            const phase = timerPhase(timer, at),
              remaining = timerRemaining(timer, at);
            return (
              <li key={timer.id}>
                <div className={`timers-digits ${phase === 'done' ? 'status-caution' : ''}`}>
                  {phase === 'done' ? 'Done' : timerDigits(remaining)}
                </div>
                <p className="collection-title">{timerName(timer)}</p>
                <p className="collection-detail">
                  <TransitionText
                    value={
                      phase === 'paused'
                        ? 'Paused'
                        : phase === 'done'
                          ? 'Finished'
                          : `${timeLeft(remaining)} left`
                    }
                  />
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {timers.length > count && <p className="collection-detail">+{timers.length - count} more</p>}
      {disconnected && !!timers.length && (
        <p className="status-caution collection-detail">Saved timers · offline</p>
      )}
    </CollectionFace>
  );
}
export const TimersWidget: WidgetModule = {
  Renderer: Timers,
  sample: collectionSample,
  Settings: () => (
    <p className="hint">
      Start, pause and dismiss silent timers on Home. Finished timers stay on the display for ten minutes.
    </p>
  ),
};
