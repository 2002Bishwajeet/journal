import { useEffect, useRef, useState } from 'react';

/**
 * iOS large title (#830): `collapsed` turns true once the large title has scrolled out of its
 * scroll area (under the bar), so the bar can show its small title. One IntersectionObserver,
 * no scroll listener. `enabled` false (desktop) observes nothing.
 */
export function useLargeTitle(enabled: boolean) {
    const ref = useRef<HTMLHeadingElement>(null);
    const [collapsed, setCollapsed] = useState(false);

    useEffect(() => {
        const el = ref.current;
        if (!enabled || !el) return;
        const observer = new IntersectionObserver(([entry]) => setCollapsed(!entry.isIntersecting), {
            root: el.closest('[data-slot="scroll-area-viewport"]'),
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, [enabled]);

    return { ref, collapsed: enabled && collapsed };
}
