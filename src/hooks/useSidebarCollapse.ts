import { useState } from 'react';
import { SIDEBAR_COLLAPSE_KEY, readJson, writeJson } from '@/lib/storage';

export type SidebarPart = 'sidebar' | 'folders' | 'tags';

type CollapseState = Record<SidebarPart, boolean>;

const PARTS: SidebarPart[] = ['sidebar', 'folders', 'tags'];

/** Anything missing, malformed, or unreadable falls back to expanded. */
function load(): CollapseState {
    const stored = readJson<Partial<Record<SidebarPart, unknown>>>(SIDEBAR_COLLAPSE_KEY);
    return Object.fromEntries(PARTS.map((p) => [p, stored?.[p] === true])) as CollapseState;
}

/** Collapsed state of the whole sidebar and its Folders/Tags sections, remembered across reloads. */
export function useSidebarCollapse() {
    const [state, setState] = useState<CollapseState>(load);

    const toggle = (part: SidebarPart) => {
        const next = { ...state, [part]: !state[part] };
        setState(next);
        writeJson(SIDEBAR_COLLAPSE_KEY, next);
    };

    return { collapsed: state, toggle };
}
