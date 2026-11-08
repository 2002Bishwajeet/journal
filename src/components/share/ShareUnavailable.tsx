import { Link } from 'react-router-dom';
import { ArrowLeft, FileText, Lock, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ShareHeader } from '@/components/share/ShareHeader';

interface ShareUnavailableProps {
    /** `noAccess`: the note exists but this viewer can't read it (a 403); `notFound`: there is no such note. */
    reason: 'noAccess' | 'notFound';
    /** Shown on `noAccess` for a signed-out viewer: signing in opens the note if it was shared with them. */
    signInHref?: string;
}

/** The share page when a link shows nothing: no access, or no such note (#1002). */
export function ShareUnavailable({ reason, signInHref }: ShareUnavailableProps) {
    const noAccess = reason === 'noAccess';
    const Icon = noAccess ? Lock : FileText;
    return (
        <div className="min-h-svh bg-background flex flex-col">
            <ShareHeader />
            {/* `m-auto`: centred in the space below the header. */}
            <div className="m-auto px-4 py-16 text-center space-y-4">
                <Icon className="h-16 w-16 text-muted-foreground/50 mx-auto" />
                <h1 className="text-2xl font-semibold">{noAccess ? "You don't have access to this note" : 'Note not found'}</h1>
                <p className="text-muted-foreground text-pretty">
                    {noAccess
                        ? signInHref
                            ? 'If it was shared with you, sign in to open it.'
                            : 'Ask its owner to share it with you.'
                        : 'This note may have been deleted, or the link is not right.'}
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                    {signInHref && (
                        <Button asChild>
                            <Link to={signInHref}>
                                <LogIn />
                                Sign in
                            </Link>
                        </Button>
                    )}
                    <Button asChild variant="outline">
                        <Link to="/">
                            <ArrowLeft />
                            Go to Journal
                        </Link>
                    </Button>
                </div>
            </div>
        </div>
    );
}
