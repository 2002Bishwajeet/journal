import { useState } from 'react';
import { ChevronDown, ListTree } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { scrollToHeading, type OutlineHeading } from '@/hooks/useShareOutline';
import { cn } from '@/lib/utils';

interface ShareOutlineProps {
    headings: OutlineHeading[];
    activeId: string | undefined;
    hidden: boolean;
    onToggleHidden: () => void;
}

const INDENT: Record<number, string> = { 2: '', 3: 'pl-3', 4: 'pl-6' };

function OutlineList({ headings, activeId, onPick, tall }: { headings: OutlineHeading[]; activeId: string | undefined; onPick: (id: string) => void; tall?: boolean }) {
    return (
        <ul className="m-0 list-none p-0">
            {headings.map((h) => (
                <li key={h.id}>
                    <a
                        href={`#${h.id}`}
                        aria-current={h.id === activeId ? 'location' : undefined}
                        onClick={(e) => {
                            e.preventDefault();
                            onPick(h.id);
                        }}
                        className={cn(
                            'flex items-center border-l-2 py-1 pr-2 text-sm leading-snug no-underline outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
                            tall && 'min-h-11',
                            h.id === activeId ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground',
                        )}
                    >
                        <span className={cn('pl-2', INDENT[h.level])}>{h.text}</span>
                    </a>
                </li>
            ))}
        </ul>
    );
}

/** The sections of a shared note (#643): a side panel from `xl`, an inline toggle below it. */
export function ShareOutline({ headings, activeId, hidden, onToggleHidden }: ShareOutlineProps) {
    const [open, setOpen] = useState(false);
    if (headings.length === 0) return null;

    return (
        <>
            {/* Side panel: sits in the margin right of the article, which keeps its width. */}
            <aside aria-label="On this page" className="not-prose absolute top-0 left-full ml-6 hidden h-full w-44 xl:block">
                <div className="sticky top-20 flex max-h-[calc(100vh-6rem)] flex-col gap-2">
                    <div className="flex items-center justify-between gap-1">
                        {!hidden && <p className="m-0 text-xs font-semibold tracking-wide text-muted-foreground uppercase">On this page</p>}
                        <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-expanded={!hidden}
                            aria-controls={hidden ? undefined : 'share-outline-list'}
                            aria-label={hidden ? 'Show contents' : 'Hide contents'}
                            title={hidden ? 'Show contents' : 'Hide contents'}
                            onClick={onToggleHidden}
                        >
                            <ListTree aria-hidden />
                        </Button>
                    </div>
                    {!hidden && (
                        <nav id="share-outline-list" aria-label="On this page" className="overflow-y-auto">
                            <OutlineList headings={headings} activeId={activeId} onPick={scrollToHeading} />
                        </nav>
                    )}
                </div>
            </aside>

            {/* Below xl: collapsed above the article body. */}
            <div className="not-prose mb-8 rounded-lg border xl:hidden">
                <button
                    type="button"
                    aria-expanded={open}
                    aria-controls="share-outline-inline"
                    onClick={() => setOpen(!open)}
                    className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-3 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                    On this page
                    <ChevronDown aria-hidden className={cn('size-4 transition-transform', open && 'rotate-180')} />
                </button>
                {open && (
                    <nav id="share-outline-inline" aria-label="On this page" className="px-3 pb-2">
                        <OutlineList
                            headings={headings}
                            activeId={activeId}
                            tall
                            onPick={(id) => {
                                setOpen(false);
                                scrollToHeading(id);
                            }}
                        />
                    </nav>
                )}
            </div>
        </>
    );
}
