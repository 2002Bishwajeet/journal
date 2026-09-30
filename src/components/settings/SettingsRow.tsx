import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { Label } from "@/components/ui/label";

/**
 * One labelled control in a Settings group. The label is bound to the control
 * (`htmlFor={id}`) and stretched over the whole row, so the row is the touch
 * target and clicking anywhere on it operates the control. Group rows in an
 * `overflow-hidden rounded-xl border bg-card` container; rows draw their own
 * dividers. A control too wide to sit beside the text wraps under it.
 */
export function SettingsRow({
  id,
  label,
  description,
  control,
}: {
  id: string;
  label: string;
  description?: ReactNode;
  control: ReactNode;
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
    <div className="relative flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3 last:border-b-0">
      <div className="min-w-36 flex-1 space-y-0.5">
        <Label
          htmlFor={id}
          className="cursor-pointer text-sm leading-5 font-medium after:absolute after:inset-0 after:content-['']"
        >
          {label}
        </Label>
        {description && (
          <p id={descId} className="text-xs leading-relaxed text-muted-foreground text-pretty">
            {description}
          </p>
        )}
      </div>
      <div className="relative">{boundControl}</div>
    </div>
  );
}
