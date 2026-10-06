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
            <div className="aspect-[1200/630] w-full overflow-hidden border-b bg-muted">
                {image ?? (
                    <div className="flex h-full w-full items-center justify-center">
                        <img src="/logo.webp" alt="" width={80} height={80} className="size-20 rounded-2xl" />
                    </div>
                )}
            </div>
            <div className="space-y-1 px-4 py-3">
                <p className="truncate text-xs uppercase tracking-wide text-muted-foreground">{domain}</p>
                <p className="line-clamp-2 wrap-anywhere font-semibold leading-snug">{title}</p>
                <p className="line-clamp-2 wrap-anywhere text-sm text-muted-foreground">{description}</p>
            </div>
        </div>
    );
}
