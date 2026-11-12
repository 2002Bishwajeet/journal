import { nativePlatform } from "@/lib/native";

export type SettingsPlatform = "web-desktop" | "web-phone" | "native-phone" | "native-desktop";

/** Which Settings variant applies (#1182). iOS and Android shells are the native phone. */
export function settingsPlatform(isPhone: boolean): SettingsPlatform {
  const native = nativePlatform();
  if (native === "ios" || native === "android") return "native-phone";
  if (native) return "native-desktop";
  return isPhone ? "web-phone" : "web-desktop";
}

export const isNativeSettings = (p: SettingsPlatform) => p === "native-phone" || p === "native-desktop";
export const isPhoneSettings = (p: SettingsPlatform) => p === "web-phone" || p === "native-phone";
