/**
 * React node view for the toggle block: a chevron button and a title input
 * above the block content. Open/closed is local state (default open) and is
 * never synced. Typing in the input stays out of ProseMirror because TipTap's
 * default NodeView.stopEvent already swallows events from inputs and buttons.
 */
import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { cn } from '@/lib/utils';

export function ToggleNodeView({ node, updateAttributes }: NodeViewProps) {
  const [open, setOpen] = useState(true);

  return (
    <NodeViewWrapper className="my-2" data-type="toggle">
      <div contentEditable={false} className="flex items-center gap-1">
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? 'Collapse' : 'Expand'}
          onClick={() => setOpen(!open)}
          className="rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ChevronRight className={cn('size-4 transition-transform duration-200', open && 'rotate-90')} />
        </button>
        <input
          aria-label="Toggle title"
          placeholder="Toggle"
          value={node.attrs.summary as string}
          onChange={(e) => updateAttributes({ summary: e.target.value })}
          className="min-w-0 flex-1 bg-transparent font-medium outline-none placeholder:text-muted-foreground/70"
        />
      </div>
      <NodeViewContent hidden={!open} className="pl-6" />
    </NodeViewWrapper>
  );
}
