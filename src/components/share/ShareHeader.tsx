import { Link } from 'react-router-dom';
import { ArrowUpRight, CopyPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useHasScrolled } from '@/hooks/useHasScrolled';
import { cn } from '@/lib/utils';

interface ShareHeaderProps {
    /** The in-app route that saves a copy of the note; the action is left out without one. */
    saveHref?: string;
}

/** The share page's sticky bar: the logo and wordmark, then the actions. */
export function ShareHeader({ saveHref }: ShareHeaderProps) {
    const scrolled = useHasScrolled();

    return (
        <header
            data-scrolled={scrolled}
            className={cn(
                'sticky top-0 z-40 border-b bg-background/75 backdrop-blur-md transition-colors',
                scrolled ? 'border-border' : 'border-transparent',
            )}
        >
            <div className="max-w-2xl mx-auto h-14 px-4 sm:px-6 flex items-center justify-between gap-3">
                <Link
                    to="/"
                    className="flex items-center gap-2 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                    {/* The logo's tile, without the square it sits on. */}
                    <span className="size-6 shrink-0 overflow-hidden rounded-md">
                        <img src="/logo.webp" alt="" className="size-full scale-[1.6]" />
                    </span>
                    <span className="font-serif text-xl leading-none tracking-tight">Journal</span>
                </Link>
                <div className="flex items-center gap-1.5">
                    {saveHref && (
                        // Signed out, the app's guard sends the visitor through sign-in and back here.
                        <Button asChild size="sm">
                            <Link to={saveHref}>
                                <CopyPlus aria-hidden />
                                Save a copy
                            </Link>
                        </Button>
                    )}
                    <Button asChild variant="ghost" size="sm" className="max-sm:px-2">
                        <Link to="/">
                            <span className="sr-only sm:not-sr-only">Open Journal</span>
                            <ArrowUpRight aria-hidden />
                        </Link>
                    </Button>
                </div>
            </div>
        </header>
    );
}
