import { useEffect, useState } from 'react';
import { hasNativePlugin, invokeNative, nativePlatform } from '@/lib/native';

/** native/rust/tray.rs keeps the setting and applies it at launch. */
const PLUGIN = 'journal-desktop';

/**
 * macOS app only: "Show in menu bar only" for the Settings row (#1116), which hides the Dock
 * icon. `mac` is false without the premium plugin; `enabled` is null until read.
 */
export function useMenuBarOnly() {
    const mac = nativePlatform() === 'macos' && hasNativePlugin(PLUGIN);
    const [enabled, setEnabledState] = useState<boolean | null>(null);

    useEffect(() => {
        if (!mac) return;
        let stale = false;
        invokeNative<boolean>(PLUGIN, 'menu_bar_only')
            .then((on) => {
                if (!stale) setEnabledState(on ?? false);
            })
            .catch((err: unknown) => console.error('[useMenuBarOnly] Failed to read:', err));
        return () => {
            stale = true;
        };
    }, [mac]);

    const setEnabled = async (on: boolean) => {
        await invokeNative(PLUGIN, 'set_menu_bar_only', { on });
        setEnabledState(on);
    };

    return { mac, enabled, setEnabled };
}
