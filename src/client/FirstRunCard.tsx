import { Icon } from './icons';

/**
 * #252: while no location has ever been saved (`locationSource` is `fallback`), a small card above
 * the inspector tabs says the weather is the default city and offers the two location actions.
 * Both act as drafts through the editor's normal location handlers. Dismissal is kept in this
 * browser's storage only, never in the saved data, so older releases can still read the data.
 */
const DISMISSED_KEY = 'lrd.firstRunLocationDismissed';

export function readFirstRunDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}
export function rememberFirstRunDismissed(): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, '1');
  } catch {
    /* Storage unavailable: the card stays hidden for this editor session only. */
  }
}

export function FirstRunCard({
  place,
  draft,
  busy,
  saving,
  message,
  onUseLocation,
  onChooseCity,
  onDismiss,
}: {
  /** The saved default location's name, for example Toronto. */
  place: string;
  /** The unsaved location choice, if any ("Your area" or a city name). */
  draft: string | null;
  busy: boolean;
  saving: boolean;
  /** The editor's location message from the last explicit lookup. */
  message: string;
  onUseLocation: () => void;
  onChooseCity: () => void;
  onDismiss: () => void;
}) {
  const status = busy
    ? 'Finding your area…'
    : draft
      ? `${draft} is ready. Save changes to use it.`
      : message.startsWith('Location blocked')
        ? 'Location is blocked in this browser. Choose a city instead.'
        : message.startsWith('Location unavailable')
          ? 'Location unavailable. Choose a city instead.'
          : '';
  return (
    <section className="first-run-card" aria-labelledby="first-run-title">
      <div className="first-run-heading">
        <span className="first-run-icon" aria-hidden="true">
          <Icon name="location" size={16} />
        </span>
        <h2 id="first-run-title">Showing {place} weather</h2>
        <button
          type="button"
          className="icon-button first-run-dismiss"
          aria-label="Hide location tip"
          title="Hide location tip"
          onClick={onDismiss}
        >
          <Icon name="close" size={15} />
        </button>
      </div>
      <p className="first-run-status" role="status">
        {status}
      </p>
      <div className="first-run-actions">
        <button
          type="button"
          className="button small"
          disabled={busy || saving}
          onClick={onUseLocation}
        >
          <Icon name="location" size={14} />
          Use my location
        </button>
        <button type="button" className="button small" onClick={onChooseCity}>
          Choose a city
        </button>
      </div>
    </section>
  );
}
