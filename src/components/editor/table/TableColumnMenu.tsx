
import { Editor } from '@tiptap/react';
import { useFloating, offset, autoUpdate, shift } from '@floating-ui/react';
import { useState, useMemo, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { GripHorizontal, ArrowLeft, ArrowRight, Trash2 } from 'lucide-react';
import { useTableState } from './hooks';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface TableColumnMenuProps {
  editor: Editor;
}

export function TableColumnMenu({ editor }: TableColumnMenuProps) {
  // Logic: 
  // 1. Find active cell.
  // 2. Position a "Grip" button centered on top of that cell.
  // 3. That Grip button is a PopoverTrigger.
  
  const { hoveredCell } = useTableState(editor, false); 
  const [isOpen, setIsOpen] = useState(false);
  const [handleOpen, setHandleOpen] = useState(false);
  const [isMenuHovered, setIsMenuHovered] = useState(false);
  const [activeCell, setActiveCell] = useState(hoveredCell);

  useEffect(() => {
    if (hoveredCell) {
        setActiveCell(hoveredCell);
    }
  }, [hoveredCell]);

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

    return {
      getBoundingClientRect: () => {
        return {
            width: rect.width,
            height: 20, // arbitrary height for the handle area
            x: rect.x,
            y: tableRect.y - 12 - 5, // Position explicitly above the table
            top: tableRect.top - 12 - 5,
            left: rect.left,
            right: rect.right,
            bottom: tableRect.top - 5,
        };
      },
      contextElement: node
    };
  }, [hoveredCell, activeCell]);

  // Keep menu open if we are hovering it or the cell
  useEffect(() => {
     if (hoveredCell || isMenuHovered || handleOpen) {
         setIsOpen(true);
     } else {
         const t = setTimeout(() => setIsOpen(false), 200); // Increased timeout slightly
         return () => clearTimeout(t);
     }
  }, [hoveredCell, isMenuHovered, handleOpen]);

  const { refs, floatingStyles } = useFloating({
    open: isOpen,
    placement: 'top',
    middleware: [
        offset(0), 
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
                className="h-6 w-full rounded-none hover:bg-muted active:bg-muted-foreground/20 transition-colors"
                // Match width to column roughly, or just be a small pill centered
            >
                <GripHorizontal className="h-4 w-4 text-muted-foreground/50 hover:text-foreground" />
           </Button>
         </PopoverTrigger>
         <PopoverContent className="w-auto p-1 flex gap-1 z-[9999]" side="top" align="center">
             <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => editor.chain().focus().addColumnBefore().run()}>
                <ArrowLeft className="w-4 h-4" />
             </Button>
             <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => editor.chain().focus().addColumnAfter().run()}>
                <ArrowRight className="w-4 h-4" />
             </Button>
             <Separator orientation="vertical" className="h-4 my-auto" />
             <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => editor.chain().focus().deleteColumn().run()}>
                <Trash2 className="w-4 h-4" />
             </Button>
         </PopoverContent>
       </Popover>
    </div>
  );
}
