import { useEffect, useRef } from 'react';

/**
 * Global keyboard shortcuts.
 *
 * Every handler is guarded against firing while the user is typing — the single
 * most common way a keyboard-driven UI becomes infuriating is `j` jumping rows
 * while you are halfway through naming a tag.
 */

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable ||
    target.getAttribute('role') === 'textbox'
  );
}

export type Hotkey = {
  /** Single key ('j'), a modifier combo ('mod+k'), or a chord ('g d'). */
  keys: string;
  handler: (event: KeyboardEvent) => void;
  /** Set for shortcuts that must work inside inputs, e.g. ⌘K and Escape. */
  allowInInputs?: boolean;
};

const CHORD_TIMEOUT_MS = 1200;

export function useHotkeys(hotkeys: Hotkey[], enabled = true) {
  const latest = useRef(hotkeys);
  latest.current = hotkeys;

  useEffect(() => {
    if (!enabled) return;

    let pendingChord: string | null = null;
    let chordTimer: number | undefined;

    const clearChord = () => {
      pendingChord = null;
      if (chordTimer) window.clearTimeout(chordTimer);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const typing = isTypingTarget(event.target);
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      for (const hotkey of latest.current) {
        if (typing && !hotkey.allowInInputs) continue;

        // Chord, e.g. "g d" — Linear's go-to pattern.
        if (hotkey.keys.includes(' ')) {
          const [first, second] = hotkey.keys.split(' ');
          if (pendingChord === first && key === second) {
            event.preventDefault();
            clearChord();
            hotkey.handler(event);
            return;
          }
          continue;
        }

        if (hotkey.keys.startsWith('mod+')) {
          if (mod && key === hotkey.keys.slice(4)) {
            event.preventDefault();
            hotkey.handler(event);
            return;
          }
          continue;
        }

        if (!mod && !event.altKey && key === hotkey.keys) {
          event.preventDefault();
          hotkey.handler(event);
          return;
        }
      }

      // Nothing matched: if this key opens a chord anyone registered, remember it.
      if (!typing && !mod) {
        const opensChord = latest.current.some(
          (hotkey) => hotkey.keys.includes(' ') && hotkey.keys.split(' ')[0] === key,
        );
        if (opensChord) {
          pendingChord = key;
          if (chordTimer) window.clearTimeout(chordTimer);
          chordTimer = window.setTimeout(clearChord, CHORD_TIMEOUT_MS);
          return;
        }
      }
      clearChord();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      clearChord();
    };
  }, [enabled]);
}
