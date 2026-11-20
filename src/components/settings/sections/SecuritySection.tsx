import { Button } from "@/components/ui/button";
import { ExperimentalBadge } from "@/components/LocalAIExperimental";
import ConfirmDialog from "@/components/modals/ConfirmDialog";
import { Switch } from "@/components/ui/switch";
import { useSecuritySettings } from "@/hooks/useAppLock";
import { useShowNotesOutsideApp } from "@/hooks/useNativeBridge";
import { LOCK_AFTER_MINUTES } from "@/lib/appLock";
import { nativePlatform, type NativePlatform } from "@/lib/native";
import { SettingsRow } from "../SettingsRow";
import { SettingsSelect } from "../SettingsSelect";

const minutesLabel = (minutes: number) =>
  minutes === 60 ? "1 hour" : `${minutes} minute${minutes === 1 ? "" : "s"}`;

/** What the app lock asks for (src-tauri/src/app_lock.rs). A Mac otherwise. */
const UNLOCK_WITH: Partial<Record<NativePlatform, string>> = {
  windows: "Windows Hello",
  ios: "Face ID, Touch ID or your passcode",
  android: "your fingerprint, face or screen lock",
};

/**
 * Native app only. Encryption and the app lock only in the Tauri app, desktop and phone (#1363, #1364);
 * on Android only after "Encrypt notes on this device" (#1435).
 */
export default function SecuritySection() {
  const { on, setOn } = useShowNotesOutsideApp();
  const {
    encrypted,
    android,
    changingEncryption,
    confirmingEncryption,
    setEncryptionOn,
    confirmEncryption,
    cancelEncryption,
    status,
    changingLock,
    setLockOn,
    lockAfter,
    setLockAfter,
    lockNow,
  } = useSecuritySettings();
  const platform = nativePlatform();
  const unlockWith = (platform && UNLOCK_WITH[platform]) ?? "Touch ID or your password";

  return (
    <div className="space-y-6">
      {android && (
        <div className="overflow-hidden rounded-xl border bg-card">
          <SettingsRow
            id="security-encryption"
            label={
              <>
                Encrypt notes on this device <ExperimentalBadge />
              </>
            }
            description="Slower to open on large accounts."
            control={<Switch checked={encrypted} disabled={changingEncryption} onCheckedChange={setEncryptionOn} />}
          />
        </div>
      )}
      {encrypted && (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3 last:border-b-0">
            <div className="min-w-36 flex-1 space-y-0.5">
              <h4 className="text-sm leading-5 font-medium">Notes on this device are encrypted</h4>
              <p className="text-xs leading-relaxed text-muted-foreground text-pretty">
                {status?.passphrase
                  ? "This computer has no keychain (Secret Service), so your passphrase protects the key. Journal asks for it each time it opens."
                  : platform === "android"
                    ? "The key is protected by the Android Keystore."
                    : "The key is in the system keychain."}
              </p>
            </div>
          </div>
          {status?.lockAvailable && (
            <>
              <SettingsRow
                id="security-app-lock"
                label="App lock"
                description={`Ask for ${unlockWith} before Journal shows your notes.`}
                control={<Switch checked={status.lockOn} disabled={changingLock} onCheckedChange={setLockOn} />}
              />
              {status.lockOn && (
                <>
                  <SettingsRow
                    id="security-lock-after"
                    label="Lock after"
                    description="Lock when Journal has been hidden this long."
                    control={
                      <SettingsSelect
                        value={lockAfter ?? ""}
                        onChange={(e) => setLockAfter(e.target.value ? Number(e.target.value) : null)}
                      >
                        <option value="">Never</option>
                        {LOCK_AFTER_MINUTES.map((minutes) => (
                          <option key={minutes} value={minutes}>
                            {minutesLabel(minutes)}
                          </option>
                        ))}
                      </SettingsSelect>
                    }
                  />
                  <SettingsRow
                    id="security-lock-now"
                    label="Lock now"
                    description="Hide your notes until you unlock Journal."
                    control={
                      <Button variant="outline" size="sm" className="min-h-11 md:min-h-0" onClick={lockNow}>
                        Lock
                      </Button>
                    }
                  />
                </>
              )}
            </>
          )}
        </div>
      )}
      <div className="overflow-hidden rounded-xl border bg-card">
        <SettingsRow
          id="security-notes-outside-app"
          label="Show notes outside the app"
          description={`Note titles and snippets in widgets, search, shortcuts and on your watch. Turn off to show only “Open Journal”.${status?.lockOn ? " Off while the app lock is on, unless you turn it on." : ""}`}
          control={<Switch checked={on} onCheckedChange={setOn} />}
        />
      </div>
      <ConfirmDialog
        isOpen={confirmingEncryption}
        onClose={cancelEncryption}
        onConfirm={confirmEncryption}
        title="Encrypt notes on this device?"
        description="Journal syncs your changes, restarts, and downloads your notes from Homebase into an encrypted store. This is experimental: it can be slow to open on large accounts."
        confirmText="Encrypt"
        variant="default"
      />
    </div>
  );
}
