import { useCallback, memo } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { useCircle } from '@/hooks/circles/useCircle';
import type { CircleDefinition } from '@homebase-id/js-lib/network';
import { AuthorImage } from '@/components/author/AuthorImage';

interface CircleOptionProps {
    circle: CircleDefinition;
    isActive: boolean;
    onSelect: (circle: CircleDefinition, members: string[]) => void;
}

export const CircleOption = memo(function CircleOption({
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
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 transition-colors cursor-pointer ${
                isActive
                    ? 'bg-collaborative/10 ring-1 ring-collaborative/30'
                    : 'hover:bg-accent'
            } ${circle.disabled ? 'opacity-50 pointer-events-none' : ''}`}
        >
            <Checkbox
                checked={isActive}
                className="pointer-events-none data-[state=checked]:bg-collaborative data-[state=checked]:border-collaborative"
                disabled={circle.disabled}
            />

            <div className="flex flex-1 flex-col min-w-0 gap-1">
                <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium truncate ${circle.disabled ? 'text-muted-foreground' : ''}`}>
                        {circle.name}
                    </span>
                    {circle.disabled && (
                        <span className="text-xs text-muted-foreground">(disabled)</span>
                    )}
                    {members && members.length > 0 && (
                        <span className="text-xs text-muted-foreground ml-auto shrink-0">
                            {members.length} member{members.length !== 1 ? 's' : ''}
                        </span>
                    )}
                </div>

                {members && members.length > 0 && (
                    <div className="flex -space-x-1.5">
                        {members.slice(0, 5).map((member) => (
                            <AuthorImage
                                key={member.domain}
                                odinId={member.domain}
                                className="h-5 w-5 rounded-full border-2 border-background"
                            />
                        ))}
                        {members.length > 5 && (
                            <div className="h-5 w-5 rounded-full bg-muted border-2 border-background flex items-center justify-center">
                                <span className="text-[9px] text-muted-foreground font-medium">
                                    +{members.length - 5}
                                </span>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
});
