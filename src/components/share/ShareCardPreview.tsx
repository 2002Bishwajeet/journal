import type { ReactNode } from 'react';

interface ShareCardPreviewProps {
    title: string;
    description: string;
    domain: string;
    /** The 1200×630 card image (og:image). Falls back to the logo. */
    image?: ReactNode;
}

/** How a public note's link looks when pasted into a chat or social app. */
export function ShareCardPreview({ title, description, domain, image }: ShareCardPreviewProps) {
    return (
        <div className="w-full overflow-hidden rounded-lg border bg-card text-card-foreground">
            <div className="aspect-[1200/630] w-full overflow-hidden bg-muted">
                {image ?? (
                    <div className="flex h-full w-full items-center justify-center">
                        <img src="/logo.webp" alt="" className="h-16 w-16 opacity-80" />
                    </div>
                )}
            </div>
            <div className="space-y-1 p-3">
                <p className="truncate text-xs uppercase text-muted-foreground">{domain}</p>
                <p className="line-clamp-2 wrap-anywhere font-semibold">{title}</p>
                <p className="line-clamp-2 wrap-anywhere text-sm text-muted-foreground">{description}</p>
            </div>
        </div>
    );
}
