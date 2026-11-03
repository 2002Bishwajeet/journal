import { TAB_ROOTS, type MobileTab } from '@/layouts/mobileTab';

/** The most screens a tab keeps; the oldest go first. */
export const MAX_TAB_STACK = 20;

const STORAGE_KEY = 'journal-tab-stacks';

type Stacks = Record<MobileTab, string[]>;
type Store = Pick<Storage, 'getItem' | 'setItem'>;

function load(store: Store | undefined): Stacks {
    const stacks: Stacks = { notes: [], shared: [] };
    try {
        const saved = JSON.parse(store?.getItem(STORAGE_KEY) ?? 'null') as Partial<Stacks> | null;
        for (const tab of Object.keys(stacks) as MobileTab[]) {
            const list = saved?.[tab];
            if (Array.isArray(list)) stacks[tab] = list.filter((l) => typeof l === 'string').slice(-MAX_TAB_STACK);
        }
    } catch {
        // A missing or damaged saved stack starts empty.
    }
    return stacks;
}

function sessionStore(): Store | undefined {
    try {
        return sessionStorage;
    } catch {
        return undefined;
    }
}

/**
 * A back stack for each route tab (#859): the locations (path and query) the tab walked
 * through, oldest first, the current screen last. It is saved in sessionStorage so a
 * reload keeps it, as the browser keeps its history. A tab with no stack starts at its root.
 */
export function createTabStacks(store: Store | undefined = sessionStore()) {
    const stacks = load(store);
    const set = (tab: MobileTab, list: string[]) => {
        stacks[tab] = list.slice(-MAX_TAB_STACK);
        try {
            store?.setItem(STORAGE_KEY, JSON.stringify(stacks));
        } catch {
            // Storage full or blocked: the stack still works until the page closes.
        }
    };

    return {
        /** The screens to rebuild the browser history from; the tab's root when it has none. */
        entries: (tab: MobileTab): string[] => (stacks[tab].length ? [...stacks[tab]] : [TAB_ROOTS[tab]]),
        set,
        push: (tab: MobileTab, location: string) => set(tab, [...stacks[tab], location]),
        /** Replaces the current screen; an empty stack just gets it. */
        replace: (tab: MobileTab, location: string) => set(tab, [...stacks[tab].slice(0, -1), location]),
        /** Back (or Forward) landed on `location`: drops what came after it. False when the stack never held it. */
        popTo(tab: MobileTab, location: string): boolean {
            const at = stacks[tab].lastIndexOf(location);
            if (at < 0) return false;
            if (at < stacks[tab].length - 1) set(tab, stacks[tab].slice(0, at + 1));
            return true;
        },
    };
}
