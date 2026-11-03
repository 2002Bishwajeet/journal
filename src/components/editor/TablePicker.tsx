import { useState } from 'react';
import { Editor } from '@tiptap/react';
import { Minus, Plus, Table as TableIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useSheetMode } from '@/hooks/useSheetMode';
import { safeEditorCommand } from './shared';
import { PickerSurface } from './shared/PickerSurface';

interface TablePickerProps {
  editor: Editor;
}

const SHEET_MAX = 10;
const stepButton =
  'flex size-11 items-center justify-center rounded-full bg-background text-foreground active:bg-accent disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-5';

// Touch has no hover to preview a size, so the sheet counts rows and columns with steppers (#827).
function Stepper({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <div role="group" aria-label={label} className="bg-muted flex h-14 items-center justify-between rounded-xl pr-2 pl-4">
      <span className="text-base">{label}</span>
      <div className="flex items-center gap-1">
        <button type="button" aria-label={`Fewer ${label.toLowerCase()}`} className={stepButton} disabled={value <= 1} onClick={() => onChange(value - 1)}>
          <Minus aria-hidden />
        </button>
        <output className="w-8 text-center text-base tabular-nums">{value}</output>
        <button type="button" aria-label={`More ${label.toLowerCase()}`} className={stepButton} disabled={value >= SHEET_MAX} onClick={() => onChange(value + 1)}>
          <Plus aria-hidden />
        </button>
      </div>
    </div>
  );
}

export function TablePicker({ editor }: TablePickerProps) {
  const [open, setOpen] = useState(false);
  const [hoveredCell, setHoveredCell] = useState<{ rows: number; cols: number } | null>(null);
  const [size, setSize] = useState({ rows: 3, cols: 3 });
  const asSheet = useSheetMode();

  const MAX_ROWS = 6;
  const MAX_COLS = 6;

  const insertTable = (rows: number, cols: number) => {
    safeEditorCommand(editor, () => {
      editor.chain().focus().insertTable({ rows, cols, withHeaderRow: false }).run();
    });
    setOpen(false);
    setHoveredCell(null);
  };

  return (
    <PickerSurface
      editor={editor}
      asSheet={asSheet}
      open={open}
      onOpenChange={setOpen}
      title="Insert table"
      popoverClassName="w-auto p-3"
      trigger={
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          className={cn(
            'p-2 rounded-md transition-colors',
            'hover:bg-accent hover:text-accent-foreground',
            open && 'bg-accent text-accent-foreground'
          )}
          title="Insert Table"
        >
          <TableIcon size={18} />
        </button>
      }
      popover={
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
      }
      sheet={
        <div className="flex flex-col gap-2 pb-1">
          <Stepper label="Rows" value={size.rows} onChange={(rows) => setSize({ ...size, rows })} />
          <Stepper label="Columns" value={size.cols} onChange={(cols) => setSize({ ...size, cols })} />
        </div>
      }
      sheetFooter={
        <Button type="button" onClick={() => insertTable(size.rows, size.cols)}>
          Insert table
        </Button>
      }
    />
  );
}
