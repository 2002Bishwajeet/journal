import type { ReactNode } from 'react';
import { MoreHorizontal, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { haptic } from '@/lib/haptics';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
    ContextMenuShortcut,
} from '@/components/ui/context-menu';

export interface ContextMenuItemConfig {
    label: string;
    icon?: LucideIcon;
    action: () => void;
    variant?: 'default' | 'destructive';
    shortcut?: string;
    disabled?: boolean;
}

interface ContextMenuWrapperProps {
    children: ReactNode;
    items: ContextMenuItemConfig[];
}

export function ContextMenuWrapper({ children, items }: ContextMenuWrapperProps) {
    return (
        // A touch long press opens this menu: give the same feedback as other gestures (#856).
        <ContextMenu onOpenChange={(open) => open && haptic('medium')}>
            <ContextMenuTrigger asChild>
                {children}
            </ContextMenuTrigger>
            <ContextMenuContent className="w-64">
                {items.map((item, index) => {
                    const Icon = item.icon;
                    return (
                        <ContextMenuItem
                            key={index}
                            inset={!Icon}
                            variant={item.variant}
                            disabled={item.disabled}
                            onClick={item.action}
                        >
                            {Icon && <Icon className="mr-2 h-4 w-4" />}
                            {item.label}
                            {item.shortcut && (
                                <ContextMenuShortcut>{item.shortcut}</ContextMenuShortcut>
                            )}
                        </ContextMenuItem>
                    );
                })}
            </ContextMenuContent>
        </ContextMenu>
    );
}

interface RowOptionsMenuProps {
    items: ContextMenuItemConfig[];
    label: string;
    className?: string;
}

// The touch way into the same items as the context menu: a visible button that is
// only shown on coarse pointers (desktop keeps right-click).
export function RowOptionsMenu({ items, label, className }: RowOptionsMenuProps) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    aria-label={label}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                    className={cn(
                        'hidden pointer-coarse:flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground active:bg-accent',
                        className,
                    )}
                >
                    <MoreHorizontal className="size-5" aria-hidden />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" collisionPadding={8} className="w-64 max-w-[calc(100vw-1rem)]">
                {items.map((item, index) => {
                    const Icon = item.icon;
                    return (
                        <DropdownMenuItem
                            key={index}
                            variant={item.variant}
                            disabled={item.disabled}
                            onClick={item.action}
                        >
                            {Icon && <Icon className="mr-2 h-4 w-4" />}
                            {item.label}
                        </DropdownMenuItem>
                    );
                })}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
