import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/auth';
import { isNativeApp } from '@/lib/native';
import type { NotesMirror } from '@/lib/premiumStub';

/** The desktop app's notes mirror (#1015), or null on the web, on a phone, and without the premium module. */
async function loadNotesMirror(): Promise<NotesMirror | null> {
    if (!isNativeApp()) return null;
    return (await import('@premium')).notesMirror;
}

/** Desktop app: keeps the folder the user picked in Settings -> Data in step with their notes. */
export function useNotesMirror(): void {
    const { getIdentity } = useAuth();
    useEffect(() => {
        const identity = getIdentity();
        if (!identity) return;
        let stopped = false;
        let stop: (() => void) | undefined;
        loadNotesMirror()
            .then((mirror) => {
                if (mirror && !stopped) stop = mirror.start(identity);
            })
            .catch((err: unknown) => console.error('[useNotesMirror] Failed to start:', err));
        return () => {
            stopped = true;
            stop?.();
        };
    }, [getIdentity]);
}

export interface NotesMirrorSettings {
    /** False where the mirror doesn't exist (web, phone, no premium module): show no row. */
    available: boolean;
    /** The mirrored folder; null while off; undefined until it has been read. */
    root: string | null | undefined;
    choose: () => Promise<void>;
    disable: () => Promise<void>;
    openFolder: () => Promise<void>;
}

/** The Settings -> Data row's state and actions. */
export function useNotesMirrorSettings(): NotesMirrorSettings {
    const { getIdentity } = useAuth();
    const [mirror, setMirror] = useState<NotesMirror | null>(null);
    const [root, setRoot] = useState<string | null | undefined>(undefined);

    useEffect(() => {
        let cancelled = false;
        loadNotesMirror()
            .then(async (loaded) => {
                if (!loaded || cancelled) return;
                setMirror(loaded);
                setRoot(await loaded.root());
            })
            .catch((err: unknown) => console.error('[useNotesMirrorSettings] Failed to load:', err));
        return () => {
            cancelled = true;
        };
    }, []);

    return {
        available: mirror !== null,
        root,
        choose: async () => {
            const identity = getIdentity();
            const picked = identity ? await mirror?.choose(identity) : null;
            if (picked) setRoot(picked);
        },
        disable: async () => {
            await mirror?.disable();
            setRoot(null);
        },
        openFolder: async () => {
            await mirror?.openFolder();
        },
    };
}
