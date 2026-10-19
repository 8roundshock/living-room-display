/**
 * Text whose changes can transition: a new `value` remounts the inner span, and motion.css fades
 * the new span in (opacity only) when the Animation level allows it (#76). The first value of a
 * newly shown widget never animates. Numbers are never tweened through invented values: the old
 * value disappears and the new one fades in.
 */
export function TransitionText({ value, className }: { value: string; className?: string }) {
  return <span className={className}><span className="value-transition" key={value}>{value}</span></span>;
}
