/**
 * Text whose changes can transition: a new `value` remounts the inner span, so CSS (added by the
 * animation unit, #76) can fade it in. Numbers are never tweened.
 */
export function TransitionText({ value, className }: { value: string; className?: string }) {
  return <span className={className}><span className="value-transition" key={value}>{value}</span></span>;
}
