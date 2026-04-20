import { useState } from 'react';
import { Editor } from '@tiptap/react';
import { AlignLeft, AlignCenter, AlignRight, AlignJustify } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { safeEditorCommand } from './shared';

const alignments = [
  { value: 'left', icon: AlignLeft, label: 'Left (Cmd+Shift+L)' },
  { value: 'center', icon: AlignCenter, label: 'Center (Cmd+Shift+E)' },
  { value: 'right', icon: AlignRight, label: 'Right (Cmd+Shift+R)' },
  { value: 'justify', icon: AlignJustify, label: 'Justify (Cmd+Shift+J)' },
] as const;

interface TextAlignPickerProps {
  editor: Editor;
  currentAlign?: string;
  className?: string;
  iconSize?: number;
}

export function TextAlignPicker({ editor, currentAlign = 'left', className, iconSize = 18 }: TextAlignPickerProps) {
  const [open, setOpen] = useState(false);
  const ActiveIcon = alignments.find(a => a.value === currentAlign)?.icon ?? AlignLeft;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
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
      </PopoverTrigger>
      <PopoverContent className="w-auto p-1.5 flex gap-0.5" align="start">
        {alignments.map(({ value, icon: Icon, label }) => (
          <button
            key={value}
            type="button"
            title={label}
            onClick={() => {
              safeEditorCommand(editor, () => {
                editor.chain().focus().setTextAlign(value).run();
              });
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
