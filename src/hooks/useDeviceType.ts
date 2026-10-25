import { useState, useEffect } from 'react';

export type DeviceType = 'mobile' | 'tablet' | 'desktop';

export function getDeviceType(): DeviceType {
    if (typeof window === 'undefined') return 'desktop';
    const width = window.innerWidth;
    if (width < 768) return 'mobile';
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
