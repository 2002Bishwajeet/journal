import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/auth';
import { useFolderSharing } from '@/hooks/useFolderSharing';
import { useFolderCardImage } from '@/hooks/useFolderCardImage';
import { usePublicAuthor } from '@/hooks/usePublicAuthor';
import { folderShareUrl } from '@/lib/share/sharedFolder';
import { folderShareDescription } from '../../functions/_lib/folderShare';

/** State and actions of the Share folder dialog (#631). */
export function useShareFolderDialog(folder: { id: string; name: string; isPublic?: boolean } | null) {
    const { getIdentity } = useAuth();
    const identity = getIdentity() || 'unknown';
    const author = usePublicAuthor(identity);
    const { setFolderShared, countPublicNotes } = useFolderSharing();
    const [publicNotes, setPublicNotes] = useState<number | null>(null);

    const [toShare, setToShare] = useState<number | null>(null);
    const folderId = folder?.id;
    const recount = (id: string) => countPublicNotes(id, true).then(setToShare).catch(() => {});
    useEffect(() => {
        if (!folderId) return;
        let stale = false;
        countPublicNotes(folderId, true).then((n) => !stale && setToShare(n)).catch(() => {});
        return () => { stale = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [folderId]);

    // The card shows the notes the folder has (or will have) public.
    const [publicCount, setPublicCount] = useState<number | null>(null);
    const isPublic = !!folder?.isPublic;
    useEffect(() => {
        if (!folderId || !isPublic) return;
        let stale = false;
        countPublicNotes(folderId).then((n) => !stale && setPublicCount(n)).catch(() => {});
        return () => { stale = true; };
        // Recounts when the share just finished (toShare changes then).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [folderId, isPublic, toShare]);
    const cardImage = useFolderCardImage(folder, isPublic ? publicCount : toShare);

    const url = folder ? folderShareUrl(window.location.origin, identity, folder.id) : '';
    // The same text the folder page serves as og:description.
    const description = folder ? folderShareDescription(folder.name, author.name) : '';

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(url);
            toast.success('Link copied');
        } catch (err) {
            console.error('Failed to copy folder link:', err);
            toast.error('Failed to copy link');
        }
    };

    return {
        url,
        description,
        /** The folder's link card as an object URL; undefined while it loads or can't be drawn. */
        cardImage,
        /** Notes that sharing would make public; null until counted. */
        toShare,
        copy,
        // Recount once the notes have changed: the folder flag flips before they do.
        share: async () => { if (!folder) return; await setFolderShared(folder.id, true); await recount(folder.id); },
        /** Asks first: loads the count the confirmation shows. */
        askToStop: async () => folder && setPublicNotes(await countPublicNotes(folder.id)),
        /** Notes that would become private; null while not asking. */
        publicNotes,
        cancelStop: () => setPublicNotes(null),
        stop: async () => { if (!folder) return; await setFolderShared(folder.id, false); await recount(folder.id); },
    };
}
