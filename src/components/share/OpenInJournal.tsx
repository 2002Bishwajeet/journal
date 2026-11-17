import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useOpenInApp } from '@/hooks/useOpenInApp';
import { DOWNLOAD_URL } from '@/lib/billing';

/**
 * "Open in Journal": hands `route` to the desktop app through `journal://`, on a click only.
 * Desktop browsers never pass https links to an app. Renders nothing on phones or in the
 * app. If the page stays in view afterwards, a quiet download link appears under the button.
 */
export function OpenInJournal({ route }: { route: string }) {
    const { show, href, missing, onOpen } = useOpenInApp(route);
    if (!show || !href) return null;

    return (
        <span className="relative">
            <Button asChild variant="outline" size="sm">
                <a href={href} onClick={onOpen} className="max-sm:px-2">
                    <ExternalLink aria-hidden />
                    <span className="max-sm:sr-only">Open in Journal</span>
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
