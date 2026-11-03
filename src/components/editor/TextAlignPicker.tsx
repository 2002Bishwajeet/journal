import { useState } from 'react';
import { Editor } from '@tiptap/react';
import { AlignLeft, AlignCenter, AlignRight, AlignJustify } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ActionSheet } from '@/components/ui/action-sheet';
import { cn } from '@/lib/utils';
import { useSheetMode } from '@/hooks/useSheetMode';
import { useRestoreEditorFocus } from '@/hooks/useRestoreEditorFocus';
import { safeEditorCommand } from './shared';

const alignments = [
  { value: 'left', icon: AlignLeft, label: 'Left (Cmd+Shift+L)', name: 'Left' },
  { value: 'center', icon: AlignCenter, label: 'Center (Cmd+Shift+E)', name: 'Center' },
  { value: 'right', icon: AlignRight, label: 'Right (Cmd+Shift+R)', name: 'Right' },
  { value: 'justify', icon: AlignJustify, label: 'Justify (Cmd+Shift+J)', name: 'Justify' },
] as const;

interface TextAlignPickerProps {
  editor: Editor;
  currentAlign?: string;
  className?: string;
  iconSize?: number;
}

export function TextAlignPicker({ editor, currentAlign = 'left', className, iconSize = 18 }: TextAlignPickerProps) {
  const [open, setOpen] = useState(false);
  const asSheet = useSheetMode();
  const onCloseAutoFocus = useRestoreEditorFocus(editor, open && asSheet);
  const ActiveIcon = alignments.find(a => a.value === currentAlign)?.icon ?? AlignLeft;
  const setAlign = (value: (typeof alignments)[number]['value']) => {
    safeEditorCommand(editor, () => {
      editor.chain().focus().setTextAlign(value).run();
    });
  };

  const trigger = (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={asSheet ? () => setOpen(true) : undefined}
      className={cn(
        'p-2 rounded-md transition-colors',
        'hover:bg-muted',
        open && 'bg-accent text-accent-foreground',
        className
      )}
      title="Text Alignment"
    >
      <ActiveIcon size={iconSize} />
    </button>
  );

  if (asSheet) {
    return (
      <>
        {trigger}
        <ActionSheet
          open={open}
          onOpenChange={setOpen}
          title="Text alignment"
          onCloseAutoFocus={onCloseAutoFocus}
          items={alignments.map(({ value, icon, name }) => ({
            label: name,
            icon,
            checked: currentAlign === value,
            action: () => setAlign(value),
          }))}
        />
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-auto p-1.5 flex gap-0.5" align="start">
        {alignments.map(({ value, icon: Icon, label }) => (
          <button
            key={value}
            type="button"
            title={label}
            onClick={() => {
              setAlign(value);
              setOpen(false);
            }}
            className={cn(
              'p-2 rounded-md transition-colors',
              'hover:bg-muted',
              currentAlign === value && 'bg-accent text-accent-foreground'
            )}
          >
            <Icon size={iconSize} />
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
