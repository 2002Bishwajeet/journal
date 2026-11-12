import { useEffect, useState } from 'react';
import { nativePlatform } from '@/lib/native';

/** Desktop app only: "Launch at login" for the Settings row. `enabled` is null until read. */
export function useLaunchAtLogin() {
    const desktop = ['macos', 'windows', 'linux'].includes(nativePlatform() ?? '');
    const [enabled, setEnabledState] = useState<boolean | null>(null);

    useEffect(() => {
        if (!desktop) return;
        let stale = false;
        import('@premium')
            .then(({ getLaunchAtLogin }) => getLaunchAtLogin())
            .then((on) => {
                if (!stale) setEnabledState(on);
            })
            .catch((err: unknown) => console.error('[useLaunchAtLogin] Failed to read:', err));
        return () => {
            stale = true;
        };
    }, [desktop]);

    const setEnabled = async (on: boolean) => {
        const { setLaunchAtLogin } = await import('@premium');
        await setLaunchAtLogin(on);
        setEnabledState(on);
    };

    return { desktop, enabled, setEnabled };
}
