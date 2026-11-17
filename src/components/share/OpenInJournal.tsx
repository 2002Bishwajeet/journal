import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useOpenInApp } from '@/hooks/useOpenInApp';
import { DOWNLOAD_URL } from '@/lib/billing';

/**
 * "Open in app": hands `route` to the desktop app through `journal://`. Desktop browsers
 * never pass https links to an app. Renders nothing on phones or in the app, and is hidden
 * below `sm` so a narrow window keeps the phone layout. If the page stays in view after a
 * click, a quiet download link appears under the button. After an automatic launch (a
 * browser where the app opened before), "Stay in browser" turns that off.
 */
export function OpenInJournal({ route }: { route: string }) {
    const { href, missing, autoOpened, onOpen, stayInBrowser } = useOpenInApp(route);
    if (!href) return null;

    return (
        <span className="relative flex items-center gap-1.5 max-sm:hidden">
            <Button asChild variant="outline" size="sm">
                <a href={href} onClick={onOpen}>
                    <ExternalLink aria-hidden />
                    Open in app
                </a>
            </Button>
            {autoOpened && (
                <Button variant="ghost" size="sm" onClick={stayInBrowser}>
                    Stay in browser
                </Button>
            )}
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
