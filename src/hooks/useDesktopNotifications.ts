import { useState } from 'react';
import { nativePlatform } from '@/lib/native';
import { desktopNotificationsOn, setDesktopNotificationsOn } from '@/lib/notifyNative';

/** Desktop app only: the "Desktop notifications" toggle for Settings > Notifications. */
export function useDesktopNotifications() {
    const desktop = ['macos', 'windows', 'linux'].includes(nativePlatform() ?? '');
    const [enabled, setEnabledState] = useState(desktopNotificationsOn);

    const setEnabled = (on: boolean) => {
        setDesktopNotificationsOn(on);
        setEnabledState(on);
    };

    return { desktop, enabled, setEnabled };
}
