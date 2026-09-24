import { useEffect, useState } from 'react';

/**
 * Subscribes to a CSS media query.
 *
 * Used to pick a component rather than to hide one. The domains list renders a
 * table on desktop and cards on a phone; toggling those with `hidden`/`md:block`
 * would keep several hundred table rows mounted and would run the table's
 * `scrollIntoView` effect against elements that are not on screen.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const list = window.matchMedia(query);
    // Re-read on subscribe: the query can have changed between render and here.
    setMatches(list.matches);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
