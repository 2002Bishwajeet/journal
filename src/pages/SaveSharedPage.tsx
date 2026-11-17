import { Link, useLocation } from 'react-router-dom';
import { OpenInJournal } from '@/components/share/OpenInJournal';
import { ArrowLeft, FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useSaveSharedNote } from '@/hooks/useSaveSharedNote';

/** Saves a shared note into the signed-in user's Journal, then opens the copy. */
export default function SaveSharedPage() {
    useDocumentTitle('Save a copy');
    const { error } = useSaveSharedNote();
    const { pathname, search } = useLocation();

    return (
        <div className="min-h-svh bg-background flex items-center justify-center px-4">
            {error ? (
                <div role="alert" className="text-center space-y-4">
                    <FileText className="h-16 w-16 text-muted-foreground/70 mx-auto" />
                    <h1 className="text-2xl font-semibold">Couldn't save a copy</h1>
                    <p className="text-muted-foreground">{error}</p>
                    <Button asChild variant="outline">
                        <Link to="/">
                            <ArrowLeft className="mr-2 h-4 w-4" />
                            Go to Journal
                        </Link>
                    </Button>
                    <OpenInJournal route={`${pathname}${search}`} />
                </div>
            ) : (
                <div role="status" className="flex flex-col items-center gap-4">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Saving a copy to your Journal...</p>
                    <OpenInJournal route={`${pathname}${search}`} />
                </div>
            )}
        </div>
    );
}
