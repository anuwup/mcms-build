import { MOD_KEY } from '../hooks/useKeyboardShortcuts';

const SHIFT_SYMBOL = '⇧';

function resolveKey(k) {
  if (k === 'mod') return MOD_KEY;
  if (k.toLowerCase() === 'shift') return SHIFT_SYMBOL;
  return k;
}

/**
 * Renders a styled keyboard shortcut badge.
 *
 * @param {{ keys: string[], className?: string }} props
 *   keys — array of key labels, use 'mod' for Ctrl/⌘, 'shift' for ⇧
 */
export default function Kbd({ keys, className = '' }) {
  return (
    <span className={`kbd-group ${className}`}>
      {keys.map((k, i) => (
        <kbd key={i} className="kbd">
          {resolveKey(k)}
        </kbd>
      ))}
    </span>
  );
}
