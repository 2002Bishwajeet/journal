import { useLocation, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { OpenInJournal } from '@/components/share/OpenInJournal';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useOpenSharedNote } from '@/hooks/useOpenSharedNote';
import { ShareUnavailable } from '@/components/share/ShareUnavailable';
import { ExtendPermissionDialog } from '@/components/modals/ExtendPermissionDialog';

/**
 * Opens a share link's note in the signed-in user's Journal, or says they don't have access (#1002).
 * Without peer read it offers the permission grant, which comes back here (#1494).
 */
export default function OpenSharedPage() {
    useDocumentTitle('Shared note');
    const { invalid, noAccess, needsPermission } = useOpenSharedNote();
    const { pathname, search } = useLocation();
    const navigate = useNavigate();

    if (invalid) return <ShareUnavailable reason="notFound" />;
    if (noAccess) return <ShareUnavailable reason="noAccess" />;
    if (needsPermission) {
        return (
            <ExtendPermissionDialog
                onNotNow={() => navigate('/', { replace: true })}
                fallback={<ShareUnavailable reason="noAccess" />}
            />
        );
    }
    return (
        <div role="status" className="min-h-svh bg-background flex flex-col items-center justify-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Opening the note...</p>
            <OpenInJournal route={`${pathname}${search}`} />
        </div>
    );
}
