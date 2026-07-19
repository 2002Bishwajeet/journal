/**
 * Popup list for the `[[` note-link picker. Mirrors SlashCommandList: keyboard
 * navigation + click selection, driven by @tiptap/suggestion render props.
 */
import { useState, useEffect, useCallback, forwardRef, useImperativeHandle, Fragment } from 'react';
import { FileText, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NoteLinkItem } from './NoteLinkExtension';

export interface NoteLinkListRef {
    onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface NoteLinkListProps {
    items: NoteLinkItem[];
    command: (item: NoteLinkItem) => void;
    query: string;
}

export const NoteLinkList = forwardRef<NoteLinkListRef, NoteLinkListProps>(
    ({ items, command, query }, ref) => {
        const [selectedIndex, setSelectedIndex] = useState(0);

        useEffect(() => {
            setSelectedIndex(0);
        }, [items]);

        const selectItem = useCallback(
            (index: number) => {
                const item = items[index];
                if (item) command(item);
            },
            [items, command],
        );

        useImperativeHandle(
            ref,
            () => ({
                onKeyDown: ({ event }: { event: KeyboardEvent }) => {
                    if (event.key === 'ArrowUp') {
                        setSelectedIndex((prev) => (prev <= 0 ? items.length - 1 : prev - 1));
                        return true;
                    }
                    if (event.key === 'ArrowDown') {
                        setSelectedIndex((prev) => (prev >= items.length - 1 ? 0 : prev + 1));
                        return true;
                    }
                    if (event.key === 'Enter') {
                        selectItem(selectedIndex);
                        return true;
                    }
                    return false;
                },
            }),
            [items, selectItem, selectedIndex],
        );

        if (items.length === 0) {
            return (
                <div className="z-50 w-72 rounded-lg border border-border bg-popover p-2 shadow-lg">
                    <p className="text-sm text-muted-foreground px-2 py-1">
                        {query ? 'No notes found' : 'Type to search notes…'}
                    </p>
                </div>
            );
        }

        return (
            <div className="z-50 w-72 max-h-80 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg animate-in fade-in-0 zoom-in-95">
                {items.map((item, index) => {
                    const isSelected = index === selectedIndex;
                    const isCreate = item.type === 'create';
                    const Icon = isCreate ? Plus : FileText;
                    // Section label ("Frequent" / "Recent") above the first item
                    // of each group. Labels are plain <p>s, not list items, so
                    // keyboard navigation indices are untouched.
                    const section = item.type === 'note' ? item.section : undefined;
                    const prev = items[index - 1];
                    const prevSection = prev?.type === 'note' ? prev.section : undefined;
                    const label = section !== undefined && section !== prevSection
                        ? section === 'frequent' ? 'Frequent' : 'Recent'
                        : null;
                    return (
                        <Fragment key={isCreate ? '__create__' : item.docId}>
                        {label && (
                            <p className="px-2 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                {label}
                            </p>
                        )}
                        <button
                            onClick={() => selectItem(index)}
                            onMouseEnter={() => setSelectedIndex(index)}
                            className={cn(
                                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                                isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50',
                            )}
                        >
                            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="truncate">
                                {isCreate ? (
                                    <>Create “<span className="font-medium">{item.title}</span>”</>
                                ) : (
                                    item.title
                                )}
                            </span>
                        </button>
                        </Fragment>
                    );
                })}
            </div>
        );
    },
);

NoteLinkList.displayName = 'NoteLinkList';
