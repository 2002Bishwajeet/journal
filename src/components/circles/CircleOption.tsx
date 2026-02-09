import { useCallback } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { useCircle } from '@/hooks/circles/useCircle';
import type { CircleDefinition } from '@homebase-id/js-lib/network';
import { AuthorImage } from '@/components/author/AuthorImage';

interface CircleOptionProps {
    circle: CircleDefinition;
    isActive: boolean;
    onSelect: (circle: CircleDefinition, members: string[]) => void;
}

/**
 * CircleOption - Individual circle selection with member preview
 * Uses useCircle hook to efficiently fetch members
 */
export function CircleOption({
    circle,
    isActive,
    onSelect,
}: CircleOptionProps) {
    const { fetchMembers } = useCircle({ circleId: circle.id });
    const members = fetchMembers.data;

    const handleClick = useCallback(() => {
        onSelect(circle, (members || []).map(m => m.domain));
    }, [circle, members, onSelect]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
        }
    }, [handleClick]);

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            aria-disabled={circle.disabled}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-accent cursor-pointer ${
                isActive ? 'bg-primary/10 ring-1 ring-primary/30' : 'bg-background'
            } ${circle.disabled ? 'opacity-50 pointer-events-none' : ''}`}
        >
            <Checkbox
                checked={isActive}
                className="pointer-events-none"
                disabled={circle.disabled}
            />

            <div className="flex flex-1 items-center min-w-0">
                <span className={`text-sm font-medium truncate ${circle.disabled ? 'text-muted-foreground' : ''}`}>
                    {circle.name}
                    {circle.disabled && (
                        <span className="text-xs ml-2 text-muted-foreground">(disabled)</span>
                    )}
                </span>

                {members && members.length > 0 && (
                    <div className="ml-auto flex items-center shrink-0">
                        <div className="flex -space-x-2">
                            {members.slice(0, 4).map((member) => (
                                <AuthorImage
                                    key={member.domain}
                                    odinId={member.domain}
                                    className="h-6 w-6 rounded-full border-2 border-background"
                                />
                            ))}
                        </div>
                        {members.length > 4 && (
                            <span className="ml-1 text-xs text-muted-foreground">
                                +{members.length - 4}
                            </span>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
