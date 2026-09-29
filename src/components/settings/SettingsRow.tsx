import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import type { LucideIcon } from "lucide-react";
import { Label } from "@/components/ui/label";

/**
 * One labelled control in a Settings group. The label is bound to the control
 * (`htmlFor={id}`) and stretched over the whole row, so the row is the touch
 * target and clicking anywhere on it operates the control. Group rows in a
 * `rounded-lg border` container; rows draw their own dividers.
 */
export function SettingsRow({
  id,
  label,
  description,
  control,
  icon: Icon,
}: {
  id: string;
  label: string;
  description?: string;
  control: ReactNode;
  icon?: LucideIcon;
}) {
  const descId = `${id}-desc`;
  // Bind the control to this row's label and description.
  const boundControl = isValidElement(control)
    ? cloneElement(control as ReactElement<{ id?: string; "aria-describedby"?: string }>, {
        id,
        "aria-describedby": description ? descId : undefined,
      })
    : control;

  return (
    <div className="relative flex min-h-14 items-center gap-3 border-b px-4 py-3 last:border-b-0">
      {Icon && (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/60">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
      )}
      <div className="min-w-0 flex-1 space-y-0.5">
        <Label
          htmlFor={id}
          className="cursor-pointer text-sm font-semibold after:absolute after:inset-0 after:content-['']"
        >
          {label}
        </Label>
        {description && (
          <p id={descId} className="text-xs text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <div className="relative">{boundControl}</div>
    </div>
  );
}
