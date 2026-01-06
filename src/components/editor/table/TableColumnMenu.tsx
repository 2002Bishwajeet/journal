
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
  
  const activeCell = useTableState(editor, false);
  const [handleOpen, setHandleOpen] = useState(false);

  // Virtual element for the Handle's reference (the active cell)
  const virtualElement = useMemo(() => {
    if (!activeCell?.node) return null;

    return {
      getBoundingClientRect: () => {
        const rect = activeCell.node!.getBoundingClientRect();
        return {
            width: rect.width,
            height: rect.height,
            x: rect.x,
            y: rect.y,
            top: rect.top,
            left: rect.left,
            right: rect.right,
            bottom: rect.bottom,
        };
      },
      contextElement: activeCell.node
    };
  }, [activeCell?.node]);

  const { refs, floatingStyles } = useFloating({
    open: true, // Handle is always "open" if there is an active cell
    placement: 'top',
    middleware: [
        offset(activeCell ? -activeCell.node!.clientHeight / 2 - 12 : 0), // Hacky shift? No, let's just put it at 'top' with offset
        offset(6), // gap
        shift(), // ensure it stays on screen
    ],
    whileElementsMounted: autoUpdate,
  });
  
  // Use explicit effect to set reference to virtual element
  useEffect(() => {
      refs.setPositionReference(virtualElement);
  }, [virtualElement, refs]);

  if (!activeCell) return null;

  return (
    <div 
        ref={refs.setFloating}
        style={{ ...floatingStyles, zIndex: 50 }} 
        // Force fixed just in case floatingStyles comes back absolute and we have scrolling issues, 
        // though standard is usually absolute.
    >
       <Popover open={handleOpen} onOpenChange={setHandleOpen}>
         <PopoverTrigger asChild>
           <Button 
                variant="secondary" 
                size="icon" 
                className="h-6 w-10 rounded-sm shadow-sm border border-border/50 cursor-grab hover:bg-accent active:cursor-grabbing"
            >
                <GripHorizontal className="h-4 w-4 text-muted-foreground" />
           </Button>
         </PopoverTrigger>
         <PopoverContent className="w-auto p-1 flex gap-1" side="top" align="center">
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
