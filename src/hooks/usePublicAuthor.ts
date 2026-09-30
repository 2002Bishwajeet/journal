import { useEffect, useState } from 'react';
import { GetProfileCard } from '@homebase-id/js-lib/public';

export interface PublicAuthor {
    name: string;
    avatarUrl?: string;
}

/**
 * The public profile name and avatar of a share page's author, read anonymously
 * from the identity's `/pub/profile` and `/pub/image`. The avatar is loaded as a
 * Blob and shown via an object URL (a cross-origin <img> can be blocked by our
 * COEP header), revoked on cleanup. Local state, not react-query: the query
 * cache is persisted to IndexedDB, and Blobs/object URLs must not be.
 * Any failure falls back to the identity as the name, with no avatar.
 */
export function usePublicAuthor(identity: string | undefined): PublicAuthor {
    const [loaded, setLoaded] = useState<(PublicAuthor & { identity: string }) | null>(null);

    useEffect(() => {
        if (!identity) return;
        let cancelled = false;
        let url: string | undefined;

        (async () => {
            const [card, image] = await Promise.all([
                GetProfileCard(identity).catch(() => undefined),
                // Not js-lib's GetProfileImage: it builds the Blob with Node's `Buffer`,
                // which doesn't exist in the browser, so it always fails there.
                fetch(`https://${identity}/pub/image`)
                    .then((r) => (r.ok ? r.blob() : undefined))
                    .catch(() => undefined),
            ]);
            if (cancelled) return;
            if (image) url = URL.createObjectURL(image);
            setLoaded({ identity, name: card?.name || identity, avatarUrl: url });
        })();

        return () => {
            cancelled = true;
            if (url) URL.revokeObjectURL(url);
        };
    }, [identity]);

    // Ignore a result loaded for a previous identity.
    if (loaded && loaded.identity === identity) {
        return { name: loaded.name, avatarUrl: loaded.avatarUrl };
    }
    return { name: identity ?? '' };
}
