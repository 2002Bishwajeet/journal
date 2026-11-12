import { useEffect, useState } from 'react';
import { nativePlatform } from '@/lib/native';
import { isWaylandSession } from '@/lib/quickCapture';
import type { QuickCapture, QuickCaptureState } from '@/lib/premiumStub';

async function loadQuickCapture(): Promise<QuickCapture | null> {
    if (!['macos', 'windows', 'linux'].includes(nativePlatform() ?? '')) return null;
    return (await import('@premium')).quickCapture;
}

/**
 * The Settings -> Shortcuts row for the quick-capture hotkey (#1014). `state` is null where
 * there is no hotkey to set (web, phone, no premium module, and not yet read), and
 * `pickable` is false in a Wayland session: the plugin can't register anything there, so
 * the row shows no picker (#1094 adds the portal path).
 */
export function useQuickCaptureShortcut() {
    const [state, setState] = useState<QuickCaptureState | null>(null);

    useEffect(() => {
        let stale = false;
        loadQuickCapture()
            .then((capture) => capture?.state())
            .then((current) => {
                if (!stale && current) setState(current);
            })
            .catch((err: unknown) => console.error('[useQuickCaptureShortcut] Failed to read:', err));
        return () => {
            stale = true;
        };
    }, []);

    /** Rejects with the OS's reason when it refuses the combination; the old one stays. */
    const setShortcut = async (shortcut: string) => {
        const capture = await loadQuickCapture();
        if (!capture) return;
        setState(await capture.setShortcut(shortcut));
    };

    return { state, pickable: state !== null && !isWaylandSession(state.session), setShortcut };
}
