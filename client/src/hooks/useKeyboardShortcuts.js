import { useEffect, useCallback } from 'react';

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

export const MOD_KEY = isMac ? '⌘' : 'Ctrl';

function isInputFocused() {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return document.activeElement?.isContentEditable === true;
}

/**
 * Register global keyboard shortcuts.
 *
 * @param {Array<{ key: string, mod?: boolean, shift?: boolean, handler: () => void, allowInInput?: boolean }>} shortcuts
 */
export default function useKeyboardShortcuts(shortcuts) {
  const handleKeyDown = useCallback(
    (e) => {
      for (const s of shortcuts) {
        const wantsMod = s.mod ?? false;
        const wantsShift = s.shift ?? false;

        const modPressed = isMac ? e.metaKey : e.ctrlKey;
        if (wantsMod && !modPressed) continue;
        if (!wantsMod && (e.metaKey || e.ctrlKey)) continue;

        if (wantsShift && !e.shiftKey) continue;
        if (!wantsShift && e.shiftKey) continue;

        if (e.key.toLowerCase() !== s.key.toLowerCase()) continue;
        if (e.altKey) continue;

        if (!s.allowInInput && isInputFocused()) continue;

        e.preventDefault();
        s.handler();
        return;
      }
    },
    [shortcuts],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
