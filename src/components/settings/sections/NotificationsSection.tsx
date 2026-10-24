import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePushNotifications, type PushStatus } from "@/hooks/usePushNotifications";
import { SettingsRow } from "../SettingsRow";

const STATUS_TEXT: Record<PushStatus, string> = {
  on: "On on this device",
  off: "Off on this device",
  blocked: "Blocked by the browser. Allow notifications for Journal in the site settings.",
  "ios-hint": "Add Journal to your Home Screen to get notifications",
  unsupported: "This browser cannot show notifications",
};

export default function NotificationsSection() {
  const { status, busy, failed, turnOn, turnOff } = usePushNotifications();
  const canToggle = status === "on" || status === "off";

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
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
    </div>
  );
}
