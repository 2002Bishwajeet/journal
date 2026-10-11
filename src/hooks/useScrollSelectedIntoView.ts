import { useEffect, useRef } from 'react';

/**
 * Keeps the highlighted item of a suggestion menu visible. Attach the returned
 * ref to the scroll container and put `data-index={i}` on each item.
 */
export function useScrollSelectedIntoView<T extends HTMLElement>(selectedIndex: number) {
  const containerRef = useRef<T>(null);
  useEffect(() => {
    containerRef.current
      ?.querySelector(`[data-index="${selectedIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);
  return containerRef;
}
