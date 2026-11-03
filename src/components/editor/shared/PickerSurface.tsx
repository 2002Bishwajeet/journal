import { cloneElement, type ReactElement, type ReactNode } from 'react';
import type { Editor } from '@tiptap/react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useRestoreEditorFocus } from '@/hooks/useRestoreEditorFocus';

interface PickerSurfaceProps {
  editor: Editor;
  /** True on a phone or a touch tablet: a bottom sheet instead of the popover (#827). */
  asSheet: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The toolbar button that opens the picker. */
  trigger: ReactElement<{ onClick?: () => void }>;
  title: string;
  popoverClassName?: string;
  popover: ReactNode;
  /** Defaults to `popover`. */
  sheet?: ReactNode;
  sheetFooter?: ReactNode;
  sheetBodyClassName?: string;
}

/** A toolbar picker: the popover on desktop, a bottom sheet that returns focus to the note on touch. */
export function PickerSurface({
  editor,
  asSheet,
  open,
  onOpenChange,
  trigger,
  title,
  popoverClassName,
  popover,
  sheet = popover,
  sheetFooter,
  sheetBodyClassName,
}: PickerSurfaceProps) {
  const onCloseAutoFocus = useRestoreEditorFocus(editor, open && asSheet);

  if (!asSheet) {
    return (
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent className={popoverClassName} align="start">
          {popover}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <>
      {cloneElement(trigger, { onClick: () => onOpenChange(true) })}
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent variant="bottom" aria-describedby={undefined} onCloseAutoFocus={onCloseAutoFocus}>
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
          </SheetHeader>
          <SheetBody className={sheetBodyClassName}>{sheet}</SheetBody>
          {sheetFooter && <SheetFooter>{sheetFooter}</SheetFooter>}
        </SheetContent>
      </Sheet>
    </>
  );
}
