import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { getDeviceType, useDeviceType, type DeviceType } from './useDeviceType';
import { iosCanRunAI, isIOSApp, probeIOS, takeCrashedModel, TOO_LARGE_MESSAGE } from '@/lib/webllm/ios';
import { checkAppleModel } from '@/lib/webllm/apple';
import { adoptAppleModel } from './useAISettings';

let iosSupported = false;
let iosCheck: Promise<void> | undefined;

/**
 * Once per launch in the iOS app (#1143): tells about a model that crashed the page, then probes
 * the device and asks whether Apple's on-device model can run (#1266), which then is the default.
 */
function checkIOS(): Promise<void> {
  iosCheck ??= (async () => {
    const crashed = takeCrashedModel();
    const [probe, apple] = await Promise.all([probeIOS(), checkAppleModel()]);
    iosSupported = iosCanRunAI(probe);
    if (apple) adoptAppleModel();
    if (crashed) toast.error(TOO_LARGE_MESSAGE);
  })();
  return iosCheck;
}

/**
 * On-device AI runs here: in the iOS app when the device passed the check (false
 * until it has), elsewhere on anything but a phone-sized screen.
 */
export function aiSupportedOn(deviceType: DeviceType = getDeviceType()): boolean {
  return isIOSApp() ? iosSupported : deviceType !== 'mobile';
}

export function useAISupported(): boolean {
  const deviceType = useDeviceType();
  const [, setChecked] = useState(false);
  useEffect(() => {
    if (isIOSApp()) void checkIOS().then(() => setChecked(true));
  }, []);
  return aiSupportedOn(deviceType);
}
