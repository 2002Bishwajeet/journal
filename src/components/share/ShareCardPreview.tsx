import type { ReactNode } from 'react';

interface ShareCardPreviewProps {
    title: string;
    description: string;
    domain: string;
    imageUrl?: string;
    /** An image element to show instead of `imageUrl` (e.g. a drive image that loads itself). */
    image?: ReactNode;
}

/** How a public note's link looks when pasted into a chat or social app. */
export function ShareCardPreview({ title, description, domain, imageUrl, image }: ShareCardPreviewProps) {
    return (
        <div className="w-full overflow-hidden rounded-lg border bg-card text-card-foreground">
            <div className="aspect-[1.91/1] w-full overflow-hidden bg-muted">
                {image ?? (imageUrl ? (
                    <img src={imageUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                    <div className="flex h-full w-full items-center justify-center">
                        <img src="/logo.webp" alt="" className="h-16 w-16 opacity-80" />
                    </div>
                ))}
            </div>
            <div className="space-y-1 p-3">
                <p className="truncate text-xs uppercase text-muted-foreground">{domain}</p>
                <p className="line-clamp-2 wrap-anywhere font-semibold">{title}</p>
                <p className="line-clamp-2 wrap-anywhere text-sm text-muted-foreground">{description}</p>
            </div>
        </div>
    );
}
