import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
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
        <ContextMenu>
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
