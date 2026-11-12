import { useDeviceType } from "@/hooks";
import { settingsPlatform } from "@/lib/settingsPlatform";

export function useSettingsPlatform() {
  return settingsPlatform(useDeviceType() === "mobile");
}
