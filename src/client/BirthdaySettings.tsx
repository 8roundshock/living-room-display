import { useLayoutEffect, useRef, useState } from 'react';
import { BIRTHDAY_LABELS, BIRTHDAY_LIMIT, BIRTHDAY_TREATMENTS, validBirthdayDate, type BirthdayEntry } from '../shared/birthdays';
const MONTHS = Array.from({ length: 12 }, (_, month) => new Intl.DateTimeFormat('en', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, month, 1))));
const pad = (value: number) => String(value).padStart(2, '0');

export function BirthdaySettings({ entries, onChange }: { entries: BirthdayEntry[]; onChange: (entries: BirthdayEntry[]) => void }) {
  const [active, setActive] = useState<string | null>(null);
  const focusNew = useRef<string | null>(null), nameInput = useRef<HTMLInputElement>(null), addButton = useRef<HTMLButtonElement>(null);
  const mixedDate = entries.some(entry => validBirthdayDate(entry.date) && entries.some(other => other.date === entry.date && other.treatment !== entry.treatment));
  useLayoutEffect(() => {
    if (focusNew.current && active === focusNew.current && nameInput.current) {
      nameInput.current.focus(); focusNew.current = null;
    }
    if (focusNew.current === 'add') { addButton.current?.focus(); focusNew.current = null; }
  }, [active, entries]);
  function update(id: string, patch: Partial<BirthdayEntry>) { onChange(entries.map(entry => entry.id === id ? { ...entry, ...patch } : entry)); }
  function add() {
    const id = crypto.randomUUID(); focusNew.current = id; setActive(id);
    onChange([...entries, { id, name: '', date: '-', treatment: 'classic' }]);
  }
  return <details className="birthday-settings">
    <summary id="settings-birthdays"><strong>Birthdays</strong>{entries.length > 0 && <span className="birthday-count">{entries.length}</span>}</summary>
    <p className="muted">Annual birthday scenes appear with Seasonal &amp; holidays or Combined. Names and dates stay in your local settings and backups.</p>
    {mixedDate && <p className="muted">Birthdays sharing a date use Classic when their treatments differ.</p>}
    <div className="birthday-list">{entries.map(entry => {
      const [month = '', day = ''] = entry.date.split('-'), editing = active === entry.id;
      const dateLabel = validBirthdayDate(entry.date) ? `${MONTHS[Number(month) - 1]} ${Number(day)}` : 'Choose date';
      const invalidDate = !!month && !!day && !validBirthdayDate(entry.date);
      return <div className="birthday-entry" key={entry.id}>
        <button type="button" className="birthday-entry-toggle" aria-expanded={editing} aria-controls={`birthday-${entry.id}`} onClick={() => setActive(editing ? null : entry.id)}>
          <strong>{entry.name.trim() || 'New birthday'}</strong><span>{dateLabel} · {BIRTHDAY_LABELS[entry.treatment]}</span>
        </button>
        {editing && <div id={`birthday-${entry.id}`} className="birthday-fields">
          <label className="birthday-name"><span className="field-label">Name</span><input ref={nameInput} className="text-input" maxLength={60} value={entry.name} onChange={event => update(entry.id, { name: event.target.value })} /></label>
          <div className="birthday-date-fields">
            <label><span className="field-label">Month</span><select className="select-input" value={month} aria-invalid={invalidDate || undefined} aria-describedby={invalidDate ? `birthday-date-${entry.id}` : undefined} onChange={event => update(entry.id, { date: `${event.target.value}-${day}` })}><option value="">Month</option>{MONTHS.map((label, index) => <option key={label} value={pad(index + 1)}>{label}</option>)}</select></label>
            <label><span className="field-label">Day</span><select className="select-input" value={day} aria-invalid={invalidDate || undefined} aria-describedby={invalidDate ? `birthday-date-${entry.id}` : undefined} onChange={event => update(entry.id, { date: `${month}-${event.target.value}` })}><option value="">Day</option>{Array.from({ length: 31 }, (_, index) => <option key={index} value={pad(index + 1)}>{index + 1}</option>)}</select></label>
          </div>
          {invalidDate && <p className="birthday-problem" id={`birthday-date-${entry.id}`} role="status">This month does not have {Number(day)} days. Choose another day.</p>}
          {entry.date === '02-29' && <p className="muted">February 29 birthdays appear only in leap years.</p>}
          <label><span className="field-label">Treatment</span><select className="select-input" value={entry.treatment} onChange={event => update(entry.id, { treatment: event.target.value as BirthdayEntry['treatment'] })}>{BIRTHDAY_TREATMENTS.map(value => <option key={value} value={value}>{BIRTHDAY_LABELS[value]}</option>)}</select></label>
          <button type="button" className="button small" onClick={() => { focusNew.current = 'add'; onChange(entries.filter(value => value.id !== entry.id)); setActive(null); }}>Remove from draft</button>
        </div>}
      </div>;
    })}</div>
    <button ref={addButton} type="button" className="button small birthday-add" disabled={entries.length >= BIRTHDAY_LIMIT} onClick={add}>Add birthday</button>
  </details>;
}
