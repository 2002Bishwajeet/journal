
import { Editor } from '@tiptap/react';
import { useFloating, offset, autoUpdate, shift } from '@floating-ui/react';
import { useState, useMemo, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { GripHorizontal, ArrowLeft, ArrowRight, Trash2 } from 'lucide-react';
import { useTableState } from './hooks';
import { TABLE_DESTRUCTIVE_CLASS, TABLE_HANDLE_CLASS, TABLE_MENU_CLASS } from './styles';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface TableColumnMenuProps {
  editor: Editor;
}

export function TableColumnMenu({ editor }: TableColumnMenuProps) {
  const { hoveredCell } = useTableState(editor, false);
  const [isOpen, setIsOpen] = useState(false);
  const [handleOpen, setHandleOpen] = useState(false);
  const [isMenuHovered, setIsMenuHovered] = useState(false);

  const [activeCell, setActiveCell] = useState(hoveredCell);
  const [prevHoveredCell, setPrevHoveredCell] = useState(hoveredCell);
  if (hoveredCell !== prevHoveredCell) {
    setPrevHoveredCell(hoveredCell);
    if (hoveredCell) {
      setActiveCell(hoveredCell);
    }
  }

  const shouldBeOpen = !!(hoveredCell || isMenuHovered || handleOpen);
  const [prevShouldBeOpen, setPrevShouldBeOpen] = useState(false);
  if (shouldBeOpen !== prevShouldBeOpen) {
    setPrevShouldBeOpen(shouldBeOpen);
    if (shouldBeOpen) {
      setIsOpen(true);
    }
  }

  // Virtual element for the Menu's reference (based on hovered column)
  const virtualElement = useMemo(() => {
    const cell = hoveredCell || activeCell;
    if (!cell?.node) return null;
    
    // We want the menu to appear at the TOP of the column, regardless of which row we are hovering.
    // So we find the table, then find the top-most cell (or closest header) for this column.
    
    // Actually, just tracking the top of the hovered cell is okay, but it's better if it's at the top of the table.
    // Let's rely on the rect of the hovered cell for X position, but try to find the Table's top for Y.
    
    const node = cell.node;
    const rect = cell.rect;
    
    // Find table top
    const table = node.closest('table');
    const tableRect = table?.getBoundingClientRect();

    if (!tableRect) return null;

    // The table's top edge over this column; the handle sits just above it, centred on the column.
    return {
      getBoundingClientRect: () => {
        return {
            width: rect.width,
            height: 0,
            x: rect.x,
            y: tableRect.top,
            top: tableRect.top,
            left: rect.left,
            right: rect.right,
            bottom: tableRect.top,
        };
      },
      contextElement: node
    };
  }, [hoveredCell, activeCell]);

  useEffect(() => {
    if (!shouldBeOpen) {
      const t = setTimeout(() => setIsOpen(false), 200);
      return () => clearTimeout(t);
    }
  }, [shouldBeOpen]);

  const { refs, floatingStyles } = useFloating({
    open: isOpen,
    placement: 'top',
    middleware: [
        offset(2),
        shift(),
    ],
    whileElementsMounted: autoUpdate,
  });
  
  // Use explicit effect to set reference to virtual element
  useEffect(() => {
      refs.setPositionReference(virtualElement);
  }, [virtualElement, refs]);

  if (!isOpen || !virtualElement) return null;

  return (
    <div 
        // eslint-disable-next-line react-hooks/refs -- refs.setFloating is a callback setter from @floating-ui/react, not a ref value access
        ref={refs.setFloating}
        style={{ ...floatingStyles, zIndex: 50 }} 
        onMouseEnter={() => setIsMenuHovered(true)}
        onMouseLeave={() => setIsMenuHovered(false)}
    >
       <Popover open={handleOpen} onOpenChange={setHandleOpen}>
         <PopoverTrigger asChild>
           <Button 
                variant="ghost" 
                size="icon" 
                aria-label="Column options"
                className={TABLE_HANDLE_CLASS + ' h-4 w-6'}
            >
                <GripHorizontal />
           </Button>
         </PopoverTrigger>
         <PopoverContent className={TABLE_MENU_CLASS} side="top" align="center">
             <Button variant="ghost" size="icon" aria-label="Insert column left" title="Insert column left" className="h-7 w-7" onClick={() => editor.chain().focus().addColumnBefore().run()}>
                <ArrowLeft />
             </Button>
             <Button variant="ghost" size="icon" aria-label="Insert column right" title="Insert column right" className="h-7 w-7" onClick={() => editor.chain().focus().addColumnAfter().run()}>
                <ArrowRight />
             </Button>
             <Separator orientation="vertical" className="h-4 my-auto" />
             <Button variant="ghost" size="icon" aria-label="Delete column" title="Delete column" className={TABLE_DESTRUCTIVE_CLASS} onClick={() => editor.chain().focus().deleteColumn().run()}>
                <Trash2 />
             </Button>
         </PopoverContent>
       </Popover>
    </div>
  );
}
