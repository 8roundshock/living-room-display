import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './context-help.css';

const OPEN_HELP = 'lrd-context-help-open';

/** Text-only context help: preview with hover/focus, pin with a click or tap. */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const pinned = useRef(false);
  const pointerFocus = useRef(false);
  const hovering = useRef(false);
  const overTip = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number; maxWidth: number } | null>(null);
  const clearTimer = () => clearTimeout(timer.current);
  const close = () => {
    clearTimer();
    pinned.current = false;
    overTip.current = false;
    setOpen(false);
    setPosition(null);
  };
  const show = () => {
    clearTimer();
    document.dispatchEvent(new CustomEvent(OPEN_HELP, { detail: id }));
    setOpen(true);
  };
  const leave = () => {
    clearTimer();
    timer.current = setTimeout(() => {
      if (!pinned.current && !hovering.current && !overTip.current && document.activeElement !== button.current) close();
    }, 120);
  };
  useEffect(() => {
    const otherHelp = (event: Event) => { if ((event as CustomEvent).detail !== id) close(); };
    document.addEventListener(OPEN_HELP, otherHelp);
    return () => { clearTimer(); document.removeEventListener(OPEN_HELP, otherHelp); };
  }, [id]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!button.current?.contains(event.target as Node) && !tip.current?.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // A blur's grace period can outlive focus moving into a picker or dialog.
      // Dismiss that old help without taking the new control's Escape.
      const active = document.activeElement;
      if (active && (button.current?.contains(active) || tip.current?.contains(active))) {
        event.preventDefault();
        event.stopPropagation();
      }
      close();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!button.current || !tip.current) return;
      const anchor = button.current.getBoundingClientRect();
      const viewport = window.visualViewport;
      const x = viewport?.offsetLeft ?? 0;
      const y = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      const maxWidth = Math.min(280, width - 24);
      tip.current.style.maxWidth = `${maxWidth}px`;
      const box = tip.current.getBoundingClientRect();
      const left = Math.max(x + 12, Math.min(anchor.right - box.width, x + width - box.width - 12));
      const below = anchor.bottom + 4;
      const top = Math.max(y + 12, below + box.height <= y + height - 12 ? below : anchor.top - box.height - 4);
      setPosition({ left, top, maxWidth });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
    };
  }, [open]);
  return <>
    <button ref={button} type="button" className="context-help" aria-label={label} aria-describedby={open ? id : undefined}
      onPointerEnter={(event) => { if (event.pointerType !== 'touch') { hovering.current = true; show(); } }}
      onPointerLeave={() => { hovering.current = false; leave(); }}
      onPointerDown={() => { pointerFocus.current = true; }}
      onPointerCancel={() => { pointerFocus.current = false; }}
      onFocus={() => { if (!pointerFocus.current) show(); }}
      onBlur={() => { pointerFocus.current = false; pinned.current = false; leave(); }}
      onClick={() => { pointerFocus.current = false; if (pinned.current) close(); else { pinned.current = true; show(); } }}>
      <span aria-hidden="true">i</span>
    </button>
    {open && createPortal(<span ref={tip} id={id} role="tooltip" className="context-help-tip"
      style={{ ...position, visibility: position ? 'visible' : 'hidden' }}
      onPointerEnter={() => { overTip.current = true; clearTimer(); }}
      onPointerLeave={() => { overTip.current = false; leave(); }}>{children}</span>, document.body)}
  </>;
}
