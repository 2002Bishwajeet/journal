import { ArrowUpRight, CopyPlus, Library } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useHasScrolled } from '@/hooks/useHasScrolled';
import { cn } from '@/lib/utils';

interface ShareHeaderProps {
    /** The app's URL that saves a copy of the note; the action is left out without one. */
    saveHref?: string;
    /** The author's index, `/share/<identity>` (#515); left out without one. */
    authorIndexHref?: string;
}

/** The share page's sticky bar: the logo and wordmark, then the actions. */
export function ShareHeader({ saveHref, authorIndexHref }: ShareHeaderProps) {
    const scrolled = useHasScrolled();

    return (
        <header
            data-scrolled={scrolled}
            className={cn(
                'sticky top-0 z-40 border-b bg-background/75 backdrop-blur-md transition-colors',
                scrolled ? 'border-border' : 'border-transparent',
            )}
        >
            <div className="max-w-4xl mx-auto h-14 px-4 sm:px-6 flex items-center justify-between gap-3">
                {/* Plain links (#913): a share page is outside the app's routes, at the root. */}
                <a
                    href="/"
                    className="flex items-center gap-2 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                    {/* The logo's tile, without the square it sits on. */}
                    <span className="size-6 shrink-0 overflow-hidden rounded-md">
                        <img src={`${import.meta.env.BASE_URL}logo.webp`} alt="" className="size-full scale-[1.6]" />
                    </span>
                    <span className="font-serif text-xl leading-none tracking-tight">Journal</span>
                </a>
                <div className="flex items-center gap-1.5">
                    {authorIndexHref && (
                        // A plain link: the Pages Function renders the index, not the SPA.
                        <Button asChild variant="ghost" size="sm" className="max-sm:px-2">
                            <a href={authorIndexHref}>
                                <Library aria-hidden />
                                <span className="sr-only sm:not-sr-only">More notes</span>
                            </a>
                        </Button>
                    )}
                    {saveHref && (
                        // Signed out, the app's guard sends the visitor through sign-in and back here.
                        <Button asChild size="sm">
                            <a href={saveHref}>
                                <CopyPlus aria-hidden />
                                Save a copy
                            </a>
                        </Button>
                    )}
                    <Button asChild variant="ghost" size="sm" className="max-sm:px-2">
                        <a href={import.meta.env.BASE_URL}>
                            <span className="sr-only sm:not-sr-only">Open Journal</span>
                            <ArrowUpRight aria-hidden />
                        </a>
                    </Button>
                </div>
            </div>
        </header>
    );
}
