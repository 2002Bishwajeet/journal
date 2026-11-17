import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAutoOpenInApp, useOpenInApp } from '@/hooks/useOpenInApp';
import { DOWNLOAD_URL } from '@/lib/billing';

/**
 * "Open in app": hands `route` to the desktop app through `journal://`. Desktop browsers
 * never pass https links to an app. Renders nothing on phones or in the app, and is hidden
 * below `sm` so a narrow window keeps the phone layout. If the page stays in view after a
 * click, a quiet download link appears under the button.
 */
export function OpenInJournal({ route }: { route: string }) {
    const { href, missing, onOpen } = useOpenInApp(route);
    if (!href) return null;

    return (
        <span className="relative flex items-center gap-1.5 max-sm:hidden">
            <Button asChild variant="outline" size="sm">
                <a href={href} onClick={onOpen}>
                    <ExternalLink aria-hidden />
                    Open in app
                </a>
            </Button>
            {missing && (
                <a
                    href={DOWNLOAD_URL}
                    className="absolute right-0 top-full z-10 mt-2 whitespace-nowrap rounded-md border bg-background px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                >
                    Don't have the app? Download Journal
                </a>
            )}
        </span>
    );
}

/**
 * One muted line under the share header after an automatic launch (a browser where the app
 * opened before); "Stay in browser" turns that off and hides the line.
 */
export function AutoOpenedNotice({ route }: { route: string }) {
    const { autoOpened, stayInBrowser } = useAutoOpenInApp(route);
    if (!autoOpened) return null;

    return (
        <p className="w-full max-w-4xl mx-auto px-4 sm:px-6 pt-2 text-xs text-muted-foreground">
            Opened in the Journal app ·{' '}
            <button
                type="button"
                onClick={stayInBrowser}
                className="rounded-sm underline underline-offset-4 decoration-border outline-none hover:text-foreground hover:decoration-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
                Stay in browser
            </button>
        </p>
    );
}
