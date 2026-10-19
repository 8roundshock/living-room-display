import { useRef, type CSSProperties } from 'react';
import type { Settings } from '../../shared/contracts.ts';
import type { WidgetSize } from '../../shared/widgets.ts';
import { Icon } from '../icons.tsx';
import { atNaturalWidth, useMeasured } from './measure.ts';
import { TransitionText } from './TransitionText.tsx';
import type { WidgetContentProps, WidgetModule, WidgetSettingsProps } from './types.ts';
import './note.css';

/** Same limits as the server, which remains the authority. */
export const NOTE_MAX_LENGTH = 200, NOTE_MAX_LINES = 4;

/** Keeps a draft within 4 lines and 200 characters, with Windows line endings normalized. */
export function limitNote(value: string): string {
  return value.replace(/\r\n?/g, '\n').split('\n').slice(0, NOTE_MAX_LINES).join('\n').slice(0, NOTE_MAX_LENGTH);
}

/**
 * The largest text size, between the display's text floor and the family's cap (--note-cap), at which
 * the whole note fits the widget's box (#194). Sizing from the actual box and wrapping lets a short
 * multi-line note fill the cell instead of following a character score. When even the floor
 * overflows, the floor stays and the shared fit zooms the widget out. Sizes are before Text size,
 * which multiplies the result in CSS. Measured from layout sizes at the natural width, so the fit's
 * transform never affects the result.
 */
function measureNote(face: HTMLElement): number | null {
  const content = face.parentElement, section = face.closest<HTMLElement>('.ambient-widget');
  if (!content || !section) return null;
  const box = getComputedStyle(section), style = getComputedStyle(face);
  // The same box and test as the shared Widget fit, so a size that fits here never zooms out there.
  const width = section.clientWidth - parseFloat(box.paddingLeft) - parseFloat(box.paddingRight);
  const height = section.clientHeight - parseFloat(box.paddingTop) - parseFloat(box.paddingBottom);
  const cap = parseFloat(style.getPropertyValue('--note-cap')), floor = Math.min(parseFloat(style.getPropertyValue('--min-text')) || 0, cap);
  if (!(height > 0) || !(cap > 0)) return null;
  const saved = face.style.getPropertyValue('--note-size');
  const fits = (size: number) => {
    face.style.setProperty('--note-size', `${size}px`);
    return content.scrollHeight <= height + 1 && content.scrollWidth <= width + 1;
  };
  try {
    return atNaturalWidth(face, () => {
      if (fits(cap)) return cap;
      if (!fits(floor)) return floor;
      let low = floor, high = cap;
      while (high - low > 0.25) { const middle = (low + high) / 2; if (fits(middle)) low = middle; else high = middle; }
      return Math.floor(low * 4) / 4;
    });
  } finally {
    if (saved) face.style.setProperty('--note-size', saved); else face.style.removeProperty('--note-size');
  }
}

function NoteFace({ text, size, settings }: { text: string; size: WidgetSize; settings: Settings }) {
  const face = useRef<HTMLDivElement>(null);
  const key = JSON.stringify([text, size, settings.appearance.fontScale, settings.appearance.fontFamily]);
  const fitted = useMeasured<number | null>(face, key, measureNote, null);
  return <div ref={face} className="note-face" style={fitted === null ? undefined : { '--note-size': `${fitted}px` } as CSSProperties}>
    <TransitionText className="note-text" value={text} />
  </div>;
}

function Note({ settings, size, embedded }: WidgetContentProps) {
  const text = settings.widgetData.note.text.trim();
  if (!text) return embedded ? <div className="widget-body image-placeholder note-placeholder">
    <Icon name="note" /><div className="ambient-label">Note</div><div className="ambient-description">Write a note</div>
  </div> : null;
  return <NoteFace text={text} size={size} settings={settings} />;
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
