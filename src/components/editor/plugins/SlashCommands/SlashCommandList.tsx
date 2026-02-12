/**
 * Slash Command List Component
 * 
 * React component that renders the popup menu for slash commands.
 * Supports keyboard navigation and search filtering.
 */

import { useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import type { Editor } from '@tiptap/react';
import { cn } from '@/lib/utils';
import { slashCommandItems, filterCommands, type SlashCommandItem } from './slashCommandItems';

export interface SlashCommandListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface SlashCommandListProps {
  editor: Editor;
  range: { from: number; to: number };
  query: string;
  clientRect?: (() => DOMRect | null) | null;
}

export const SlashCommandList = forwardRef<SlashCommandListRef, SlashCommandListProps>(
  ({ editor, range, query }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const filteredItems = filterCommands(slashCommandItems, query);

    // Reset selection when query changes
    useEffect(() => {
      setSelectedIndex(0);
    }, [query]);

    const selectItem = useCallback(
      (index: number) => {
        const item = filteredItems[index];
        if (item) {
          item.command({ editor, range });
        }
      },
      [editor, range, filteredItems]
    );

    // Expose keyboard handler to the extension
    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: { event: KeyboardEvent }) => {
        if (event.key === 'ArrowUp') {
          setSelectedIndex((prev) => (prev <= 0 ? filteredItems.length - 1 : prev - 1));
          return true;
        }

        if (event.key === 'ArrowDown') {
          setSelectedIndex((prev) => (prev >= filteredItems.length - 1 ? 0 : prev + 1));
          return true;
        }

        if (event.key === 'Enter') {
          selectItem(selectedIndex);
          return true;
        }

        if (event.key === 'Escape') {
          // Let the extension handle closing
          return false;
        }

        return false;
      },
    }), [filteredItems, selectItem, selectedIndex]);

    if (filteredItems.length === 0) {
      return (
        <div className="z-50 w-72 rounded-lg border border-border bg-popover p-2 shadow-lg">
          <p className="text-sm text-muted-foreground px-2 py-1">No commands found</p>
        </div>
      );
    }

    // Group items by category
    const formattingItems = filteredItems.filter((item) => item.group === 'formatting');
    const aiItems = filteredItems.filter((item) => item.group === 'ai');

    // Calculate absolute index for each item
    let absoluteIndex = 0;

    const renderItem = (item: SlashCommandItem, index: number) => {
      const Icon = item.icon;
      const isSelected = index === selectedIndex;

      return (
        <button
          key={item.title}
          onClick={() => selectItem(index)}
          onMouseEnter={() => setSelectedIndex(index)}
          className={cn(
            'flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
            isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50'
          )}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background">
            <Icon className="h-4 w-4" />
          </div>
          <div className="flex flex-col">
            <span className="font-medium">{item.title}</span>
            <span className="text-xs text-muted-foreground">{item.description}</span>
          </div>
        </button>
      );
    };

    return (
      <div className="z-50 w-72 max-h-80 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg animate-in fade-in-0 zoom-in-95">
        {formattingItems.length > 0 && (
          <div className="p-1">
            <p className="px-2 py-1 text-xs font-medium text-muted-foreground">Formatting</p>
            {formattingItems.map((item) => {
              const itemIndex = absoluteIndex++;
              return renderItem(item, itemIndex);
            })}
          </div>
        )}

        {aiItems.length > 0 && (
          <div className="p-1 border-t border-border">
            <p className="px-2 py-1 text-xs font-medium text-muted-foreground flex items-center gap-1">
              <span>AI Actions</span>
              <span className="text-[10px] bg-primary/10 text-primary px-1 rounded">Beta</span>
            </p>
            {aiItems.map((item) => {
              const itemIndex = absoluteIndex++;
              return renderItem(item, itemIndex);
            })}
          </div>
        )}
      </div>
    );
  }
);

SlashCommandList.displayName = 'SlashCommandList';
