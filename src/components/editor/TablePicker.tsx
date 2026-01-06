
import { useState } from 'react';
import { Editor } from '@tiptap/react';
import { Table as TableIcon } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { safeEditorCommand } from './shared';

interface TablePickerProps {
  editor: Editor;
}

export function TablePicker({ editor }: TablePickerProps) {
  const [open, setOpen] = useState(false);
  const [hoveredCell, setHoveredCell] = useState<{ rows: number; cols: number } | null>(null);

  const MAX_ROWS = 6;
  const MAX_COLS = 6;

  const insertTable = (rows: number, cols: number) => {
    safeEditorCommand(editor, () => {
      editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
    });
    setOpen(false);
    setHoveredCell(null);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'p-2 rounded-md transition-colors',
            'hover:bg-accent hover:text-accent-foreground',
            open && 'bg-accent text-accent-foreground'
          )}
          title="Insert Table"
        >
          <TableIcon size={18} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start">
        <div className="flex flex-col gap-2">
          <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${MAX_COLS}, minmax(0, 1fr))` }}>
            {Array.from({ length: MAX_ROWS }).map((_, rowIndex) => (
              Array.from({ length: MAX_COLS }).map((_, colIndex) => {
                const row = rowIndex + 1;
                const col = colIndex + 1;
                const isActive = hoveredCell && row <= hoveredCell.rows && col <= hoveredCell.cols;

                return (
                  <button
                    key={`${row}-${col}`}
                    className={cn(
                      "w-6 h-6 border rounded-sm transition-colors duration-75",
                      isActive 
                        ? "bg-primary border-primary" 
                        : "bg-background border-border hover:border-muted-foreground/50",
                      // Highlight interaction path
                      hoveredCell && row <= hoveredCell.rows && col <= hoveredCell.cols && !isActive && "bg-accent/50"
                    )}
                    onMouseEnter={() => setHoveredCell({ rows: row, cols: col })}
                    onClick={() => insertTable(row, col)}
                    aria-label={`${row} by ${col} table`}
                  />
                );
              })
            ))}
          </div>
          <div className="text-center text-sm text-gray-500 dark:text-gray-400">
            {hoveredCell ? `${hoveredCell.rows} x ${hoveredCell.cols}` : 'Insert Table'}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
