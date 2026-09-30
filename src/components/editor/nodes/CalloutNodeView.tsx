/**
 * React node view for the callout block: a variant icon (opens a popover to
 * switch variant) beside the block content.
 */
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { CalloutIcon } from './CalloutIcon';
import { CALLOUT_CLASSES, CALLOUT_VARIANTS, toCalloutVariant } from './calloutVariants';

export function CalloutNodeView({ node, updateAttributes }: NodeViewProps) {
  const variant = toCalloutVariant(node.attrs.variant);

  return (
    <NodeViewWrapper
      data-type="callout"
      data-variant={variant}
      className={cn('my-2 flex gap-2 rounded-md border-l-4 px-3 py-1', CALLOUT_CLASSES[variant])}
    >
      <div contentEditable={false} className="pt-3">
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Callout type: ${variant}`}
              className="rounded-sm p-0.5 hover:bg-accent"
            >
              <CalloutIcon variant={variant} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-1">
            {CALLOUT_VARIANTS.map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={v === variant}
                onClick={() => updateAttributes({ variant: v })}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-sm capitalize hover:bg-accent aria-pressed:bg-accent"
              >
                <CalloutIcon variant={v} />
                {v}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      </div>
      <NodeViewContent className="min-w-0 flex-1" />
    </NodeViewWrapper>
  );
}
