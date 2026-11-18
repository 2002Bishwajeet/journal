import { useState, useEffect } from 'react';
import { isFinePointerDevice } from '@/lib/utils';

export type DeviceType = 'mobile' | 'tablet' | 'desktop';

export function getDeviceType(): DeviceType {
    if (typeof window === 'undefined') return 'desktop';
    const width = window.innerWidth;
    // A phone held sideways (852x393) is still a phone: no room for two panes (#832). From 640 px a
    // screen is a small tablet (iPhone Duo's inner display is 669 wide, #1289): two panes.
    if (width < 640 || (width < 1024 && window.innerHeight < 500)) return 'mobile';
    if (width < 1024) return 'tablet';
    return 'desktop';
}

export function useDeviceType(): DeviceType {
    const [deviceType, setDeviceType] = useState<DeviceType>(getDeviceType);

    useEffect(() => {
        const handleResize = () => setDeviceType(getDeviceType());

        window.addEventListener('resize', handleResize);

        // Initial check
        handleResize();

        return () => window.removeEventListener('resize', handleResize);
    }, []);

    return deviceType;
}

/**
 * True where the editor shows its top toolbar and selection bubble: a desktop width, or any width on
 * a machine with a mouse or trackpad and no touch screen. Layout follows the width; these controls
 * follow the input device (#1392). A touch device at a narrow width keeps the bottom toolbar.
 */
export function useDesktopControls(): boolean {
    return useDeviceType() === 'desktop' || isFinePointerDevice();
}
