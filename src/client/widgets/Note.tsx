import type { Settings } from '../../shared/contracts.ts';
import { Icon } from '../icons.tsx';
import { TransitionText } from './TransitionText.tsx';
import type { WidgetContentProps, WidgetModule, WidgetSettingsProps } from './types.ts';
import './note.css';

/** Same limits as the server, which remains the authority. */
export const NOTE_MAX_LENGTH = 200, NOTE_MAX_LINES = 4;

/** Short notes are set large; longer ones step down so a full note fits each family. */
export function noteLength(text: string): 'xs' | 's' | 'm' | 'l' {
  const score = text.length + (text.split('\n').length - 1) * 12;
  return score <= 20 ? 'xs' : score <= 60 ? 's' : score <= 120 ? 'm' : 'l';
}

/** Keeps a draft within 4 lines and 200 characters, with Windows line endings normalized. */
export function limitNote(value: string): string {
  return value.replace(/\r\n?/g, '\n').split('\n').slice(0, NOTE_MAX_LINES).join('\n').slice(0, NOTE_MAX_LENGTH);
}

function Note({ settings, embedded }: WidgetContentProps) {
  const text = settings.widgetData.note.text.trim();
  if (!text) return embedded ? <div className="widget-body image-placeholder note-placeholder">
    <Icon name="note" /><div className="ambient-label">Note</div><div className="ambient-description">Write a note</div>
  </div> : null;
  return <div className={`note-face note-length-${noteLength(text)}`}><TransitionText className="note-text" value={text} /></div>;
}

function NoteSettings({ settings, onChange }: WidgetSettingsProps) {
  const text = settings.widgetData.note.text;
  const set = (value: string) => onChange((previous: Settings) => ({ ...previous, widgetData: { ...previous.widgetData, note: { ...previous.widgetData.note, text: value } } }));
  return <div className="note-settings">
    <label>
      <span className="field-label">Note</span>
      <textarea
        className="text-input note-input"
        rows={4}
        maxLength={NOTE_MAX_LENGTH}
        value={text}
        placeholder="A short message for the display"
        aria-describedby="note-count note-hint"
        onChange={event => set(limitNote(event.target.value))}
        onBlur={event => { const trimmed = event.target.value.trim(); if (trimmed !== text) set(trimmed); }}
      />
    </label>
    <div className="note-settings-row">
      <span id="note-count" className="note-count">{text.length}/{NOTE_MAX_LENGTH}</span>
      <button type="button" className="text-button" disabled={!text} onClick={() => set('')}>Clear</button>
    </div>
    <p id="note-hint" className="hint">Up to {NOTE_MAX_LINES} lines. Stored on this device and included in exports.</p>
  </div>;
}

export const NoteWidget: WidgetModule = {
  Renderer: Note,
  visible: props => props.embedded || props.settings.widgetData.note.text.trim() !== '',
  Settings: NoteSettings,
  // Synthetic sample only; the saved note never reaches the picker.
  sample: ({ state, settings }) => {
    const next = { ...settings, widgetData: { ...settings.widgetData, note: { text: 'Dinner at seven' } } };
    return { state: { ...state, settings: next }, settings: next };
  },
};
