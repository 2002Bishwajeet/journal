
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
    open: true, 
    placement: 'left', // Position to the left of the row
    middleware: [
        offset(6), // gap
        shift(), // ensure it stays on screen
    ],
    whileElementsMounted: autoUpdate,
  });
  
  useEffect(() => {
      refs.setPositionReference(virtualElement);
  }, [virtualElement, refs]);

  if (!activeCell) return null;

  return (
    <div 
        // eslint-disable-next-line react-hooks/refs -- refs.setFloating is a callback setter from @floating-ui/react, not a ref value access
        ref={refs.setFloating}
        style={{ ...floatingStyles, zIndex: 50 }} 
    >
       <Popover open={handleOpen} onOpenChange={setHandleOpen}>
         <PopoverTrigger asChild>
           <Button 
                variant="secondary" 
                size="icon" 
                className="h-10 w-6 rounded-sm shadow-sm border border-border/50 cursor-grab hover:bg-accent active:cursor-grabbing flex flex-col items-center justify-center"
            >
                <GripVertical className="h-4 w-4 text-muted-foreground" />
           </Button>
         </PopoverTrigger>
         <PopoverContent className="w-auto p-1 flex gap-1" side="left" align="center">
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
