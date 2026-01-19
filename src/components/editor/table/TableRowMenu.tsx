
import { Editor } from '@tiptap/react';
import { useFloating, offset, autoUpdate, shift } from '@floating-ui/react';
import { useState, useMemo, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { GripVertical, ArrowUp, ArrowDown, Trash2 } from 'lucide-react';
import { useTableState } from './hooks';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface TableRowMenuProps {
  editor: Editor;
}

export function TableRowMenu({ editor }: TableRowMenuProps) {
   
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

  // Virtual element
  const virtualElement = useMemo(() => {
    const cell = hoveredCell || activeCell;
    if (!cell?.node) return null;

    const node = cell.node;
    const rect = cell.rect;
    
    // Find table left
    const table = node.closest('table');
    const tableRect = table?.getBoundingClientRect();

    if (!tableRect) return null;

    return {
      getBoundingClientRect: () => {
        return {
            width: 20,
            height: rect.height,
            x: tableRect.left - 24, // Position to the left of the table
            y: rect.y,
            top: rect.top,
            left: tableRect.left - 24,
            right: tableRect.left - 4,
            bottom: rect.bottom,
        };
      },
      contextElement: node
    };
  }, [hoveredCell, activeCell]);

  useEffect(() => {
     if (hoveredCell || isMenuHovered || handleOpen) {
         setIsOpen(true);
     } else {
         const t = setTimeout(() => setIsOpen(false), 200);
         return () => clearTimeout(t);
     }
  }, [hoveredCell, isMenuHovered, handleOpen]);

  const { refs, floatingStyles } = useFloating({
    open: isOpen, 
    placement: 'left', // Position to the left of the row
    middleware: [
        offset(0), 
        shift(), 
    ],
    whileElementsMounted: autoUpdate,
  });
  
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
                className="h-full w-6 rounded-none hover:bg-muted active:bg-muted-foreground/20 flex flex-col items-center justify-center transition-colors"
            >
                <GripVertical className="h-4 w-4 text-muted-foreground/50 hover:text-foreground" />
           </Button>
         </PopoverTrigger>
         <PopoverContent className="w-auto p-1 flex gap-1 z-[9999]" side="left" align="center">
             <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => editor.chain().focus().addRowBefore().run()}>
                <ArrowUp className="w-4 h-4" />
             </Button>
             <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => editor.chain().focus().addRowAfter().run()}>
                <ArrowDown className="w-4 h-4" />
             </Button>
             <Separator orientation="vertical" className="h-4 my-auto" />
             <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => editor.chain().focus().deleteRow().run()}>
                <Trash2 className="w-4 h-4" />
             </Button>
         </PopoverContent>
       </Popover>
    </div>
  );
}
