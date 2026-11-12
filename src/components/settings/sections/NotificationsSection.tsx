import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useDailyReminderSettings } from "@/hooks/useDailyReminder";
import { useDesktopNotifications } from "@/hooks/useDesktopNotifications";
import { usePushNotifications, type PushStatus, type TestPush } from "@/hooks/usePushNotifications";
import { SettingsRow } from "../SettingsRow";

const STATUS_TEXT: Record<PushStatus, string> = {
  on: "On for this device",
  off: "Off for this device",
  blocked: "Blocked by the browser. Allow notifications for Journal in your browser's site settings.",
  "ios-hint": "Add Journal to your Home Screen to get notifications",
  unsupported: "This browser cannot show notifications",
};

const EVERY_DEVICE = "Every device where you turned on notifications gets it.";

function testPushText(testPush: TestPush): string {
  switch (testPush.state) {
    case "sent":
      return `Sent. ${EVERY_DEVICE}`;
    case "forbidden":
      return "Journal does not have permission to send notifications. Grant it in Settings > Account > Permissions.";
    case "failed":
      return `Homebase did not send the test notification${testPush.httpStatus ? ` (error ${testPush.httpStatus})` : ""}. Try again.`;
    default:
      return `Sends a test notification. ${EVERY_DEVICE}`;
  }
}

/** Native app only (a scheduler is registered): a nudge at a time the user picks, skipped on days they wrote. */
function DailyReminderRows() {
  const { available, prefs, denied, setEnabled, setTime, openSystemSettings } = useDailyReminderSettings();
  if (!available) return null;

  return (
    <>
      <SettingsRow
        id="notifications-daily-reminder"
        label="Daily reminder"
        description="A gentle nudge to write. Skipped on days you already wrote."
        control={<Switch checked={prefs.enabled} onCheckedChange={(on) => void setEnabled(on)} />}
      />
      {prefs.enabled && (
        <SettingsRow
          id="notifications-daily-reminder-time"
          label="Reminder time"
          control={
            <Input
              type="time"
              className="min-h-11 w-32 md:min-h-0"
              value={prefs.time}
              onChange={(e) => setTime(e.target.value)}
            />
          }
        />
      )}
      {denied && (
        <SettingsRow
          id="notifications-daily-reminder-denied"
          label="Notifications are blocked"
          description={
            <span role="status" className="text-destructive dark:text-red-400">
              Allow Journal to send notifications in your system settings, then turn the reminder on again.
            </span>
          }
          control={
            <Button variant="outline" size="sm" className="min-h-11 md:min-h-0" onClick={() => void openSystemSettings()}>
              Open settings
            </Button>
          }
        />
      )}
    </>
  );
}

export default function NotificationsSection() {
  const desktopNotifications = useDesktopNotifications();
  const { status, busy, failed, turnOn, turnOff, testPush, sendTest } = usePushNotifications();
  const testFailed = testPush.state === "forbidden" || testPush.state === "failed";
  const sending = testPush.state === "sending";
  const canToggle = status === "on" || status === "off";

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <DailyReminderRows />
      <SettingsRow
        id="notifications-push"
        label="Notify me when someone shares a note"
        description={
          <span role="status" aria-live="polite" className={failed ? "text-destructive dark:text-red-400" : undefined}>
            {failed ? "Could not change notifications. Try again." : STATUS_TEXT[status]}
          </span>
        }
        control={
          canToggle ? (
            <Button
              variant="outline"
              size="sm"
              className="min-h-11 md:min-h-0"
              disabled={busy}
              onClick={() => (status === "on" ? turnOff() : turnOn())}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {status === "on" ? "Turn off" : "Turn on"}
            </Button>
          ) : null
        }
      />
      {desktopNotifications.desktop && (
        <SettingsRow
          id="notifications-desktop"
          label="Desktop notifications"
          description="Show a system notification for a shared note while Journal is hidden or in the background."
          control={<Switch checked={desktopNotifications.enabled} onCheckedChange={desktopNotifications.setEnabled} />}
        />
      )}
      {status === "on" && (
        <SettingsRow
          id="notifications-test"
          label="Test notification"
          description={
            <span role="status" aria-live="polite" className={testFailed ? "text-destructive dark:text-red-400" : undefined}>
              {testPushText(testPush)}
            </span>
          }
          control={
            <Button
              variant="outline"
              size="sm"
              className="min-h-11 md:min-h-0"
              // The row label would otherwise name it; keep the visible text.
              aria-label="Send test notification"
              disabled={sending}
              onClick={() => sendTest()}
            >
              {sending && <Loader2 className="h-4 w-4 animate-spin" />}
              Send test
            </Button>
          }
        />
      )}
    </div>
  );
}
