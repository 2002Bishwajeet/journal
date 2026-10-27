/**
 * React node view for the callout block: a variant icon (opens a popover, or an action
 * sheet on touch layouts, to switch variant) beside the block content.
 */
import { useState } from 'react';
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ActionSheet } from '@/components/ui/action-sheet';
import { cn } from '@/lib/utils';
import { useSheetMode } from '@/hooks/useSheetMode';
import { useRestoreEditorFocus } from '@/hooks/useRestoreEditorFocus';
import { CALLOUT_ICONS, CalloutIcon } from './CalloutIcon';
import { CALLOUT_CLASSES, CALLOUT_VARIANTS, toCalloutVariant } from './calloutVariants';

export function CalloutNodeView({ editor, node, updateAttributes }: NodeViewProps) {
  const variant = toCalloutVariant(node.attrs.variant);
  const asSheet = useSheetMode();
  const [sheetOpen, setSheetOpen] = useState(false);
  const onCloseAutoFocus = useRestoreEditorFocus(editor, sheetOpen);

  const trigger = (
    <button
      type="button"
      aria-label={`Callout type: ${variant}`}
      onClick={asSheet ? () => setSheetOpen(true) : undefined}
      className="rounded-sm p-0.5 hover:bg-accent"
    >
      <CalloutIcon variant={variant} />
    </button>
  );

  return (
    <NodeViewWrapper
      data-type="callout"
      data-variant={variant}
      className={cn('my-2 flex gap-2 rounded-md border-l-4 px-3 py-1', CALLOUT_CLASSES[variant])}
    >
      <div contentEditable={false} className="pt-3">
        {asSheet ? (
          <>
            {trigger}
            <ActionSheet
              open={sheetOpen}
              onOpenChange={setSheetOpen}
              title="Callout type"
              onCloseAutoFocus={onCloseAutoFocus}
              items={CALLOUT_VARIANTS.map((v) => ({
                label: v.charAt(0).toUpperCase() + v.slice(1),
                icon: CALLOUT_ICONS[v],
                checked: v === variant,
                action: () => updateAttributes({ variant: v }),
              }))}
            />
          </>
        ) : (
          <Popover>
            <PopoverTrigger asChild>{trigger}</PopoverTrigger>
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
        )}
      </div>
      <NodeViewContent className="min-w-0 flex-1" />
    </NodeViewWrapper>
  );
}
