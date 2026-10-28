/**
 * Slash Command List Component
 * 
 * React component that renders the popup menu for slash commands.
 * Supports keyboard navigation and search filtering.
 */

import { useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import type { Editor } from '@tiptap/react';
import { cn } from '@/lib/utils';
import { useScrollSelectedIntoView } from '@/hooks/useScrollSelectedIntoView';
import { availableSlashItems, filterCommands, type SlashCommandItem } from './slashCommandItems';

export interface SlashCommandListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface SlashCommandListProps {
  editor: Editor;
  range: { from: number; to: number };
  query: string;
  clientRect?: (() => DOMRect | null) | null;
  /** On a phone: a full-width panel above the keyboard toolbar with 48 px rows (#827). */
  docked?: boolean;
}

export const SlashCommandList = forwardRef<SlashCommandListRef, SlashCommandListProps>(
  ({ editor, range, query, docked }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    // Ranked from the query directly (not the async `items` prop), so the
    // list never shows an empty in-between state while items resolve.
    const items = filterCommands(availableSlashItems(), query);
    // Show groups in the order of their best match, so the top-ranked item is
    // first and highlighted; keyboard indexes follow this display order.
    const groups = [...new Set(items.map((item) => item.group))];
    const filteredItems = groups.flatMap((group) => items.filter((item) => item.group === group));
    const listRef = useScrollSelectedIntoView<HTMLDivElement>(selectedIndex);

    // Reset selection when query changes (adjust state during render)
    const [prevQuery, setPrevQuery] = useState(query);
    if (query !== prevQuery) {
      setPrevQuery(query);
      setSelectedIndex(0);
    }

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
        <div className={cn('z-50 border-border bg-popover p-2 shadow-lg', docked ? 'w-full border-t' : 'w-72 rounded-lg border')}>
          <p className="text-sm text-muted-foreground px-2 py-1">No commands found</p>
        </div>
      );
    }

    // Calculate absolute index for each item
    let absoluteIndex = 0;

    const renderItem = (item: SlashCommandItem, index: number) => {
      const Icon = item.icon;
      const isSelected = index === selectedIndex;

      return (
        <button
          key={item.title}
          data-index={index}
          onClick={() => selectItem(index)}
          onMouseEnter={() => setSelectedIndex(index)}
          className={cn(
            'flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
            docked && 'min-h-12',
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
      <div
        ref={listRef}
        // Tapping a row must not take focus from the note, or the keyboard drops.
        onMouseDown={docked ? (e) => e.preventDefault() : undefined}
        className={cn(
          'z-50 overflow-y-auto border-border bg-popover shadow-lg',
          docked
            ? 'max-h-[min(20rem,35dvh)] w-full overscroll-contain border-t'
            : 'max-h-80 w-72 rounded-lg border animate-in fade-in-0 zoom-in-95'
        )}
      >
        {groups.map((group, groupIndex) => (
          <div key={group} className={cn('p-1', groupIndex > 0 && 'border-t border-border')}>
            {group === 'formatting' ? (
              <p className="px-2 py-1 text-xs font-medium text-muted-foreground">Formatting</p>
            ) : (
              <p className="px-2 py-1 text-xs font-medium text-muted-foreground flex items-center gap-1">
                <span>AI Actions</span>
                <span className="text-[10px] bg-primary/10 text-primary px-1 rounded">Beta</span>
              </p>
            )}
            {items
              .filter((item) => item.group === group)
              .map((item) => renderItem(item, absoluteIndex++))}
          </div>
        ))}
      </div>
    );
  }
);

SlashCommandList.displayName = 'SlashCommandList';
