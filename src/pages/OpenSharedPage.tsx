import { Loader2 } from 'lucide-react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useOpenSharedNote } from '@/hooks/useOpenSharedNote';
import { ShareUnavailable } from '@/components/share/ShareUnavailable';

/** Opens a share link's note in the signed-in user's Journal, or says they don't have access (#1002). */
export default function OpenSharedPage() {
    useDocumentTitle('Shared note');
    const { invalid, noAccess } = useOpenSharedNote();

    if (invalid) return <ShareUnavailable reason="notFound" />;
    if (noAccess) return <ShareUnavailable reason="noAccess" />;
    return (
        <div role="status" className="min-h-svh bg-background flex flex-col items-center justify-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Opening the note...</p>
        </div>
    );
}
