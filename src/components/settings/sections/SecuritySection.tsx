import { Switch } from "@/components/ui/switch";
import { useShowNotesOutsideApp } from "@/hooks/useNativeBridge";
import { SettingsRow } from "../SettingsRow";

/** Native app only. */
export default function SecuritySection() {
  const { on, setOn } = useShowNotesOutsideApp();

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <SettingsRow
        id="security-notes-outside-app"
        label="Show notes outside the app"
        description="Note titles and snippets in widgets, search, shortcuts and on your watch. Turn off to show only “Open Journal”."
        control={<Switch checked={on} onCheckedChange={setOn} />}
      />
    </div>
  );
}
