import type { ReactNode } from "react";
import { Monitor } from "lucide-react";
import { Label } from "@/components/ui/label";

export function SettingsRow({
  icon: Icon,
  label,
  description,
  trailing,
}: {
  icon: typeof Monitor;
  label: string;
  description: string;
  trailing: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between p-4 rounded-xl border border-border/60 bg-card hover:bg-accent/30 transition-colors">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-muted/60 flex items-center justify-center shrink-0">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="space-y-0.5">
          <Label className="text-sm font-semibold">{label}</Label>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      {trailing}
    </div>
  );
}
