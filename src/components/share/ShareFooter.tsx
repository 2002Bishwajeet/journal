import { Link } from 'react-router-dom';

interface ShareFooterProps {
    /** The author's identity, decoded. */
    identity: string;
}

/** What Journal is, a way in, and whose content the page is. */
export function ShareFooter({ identity }: ShareFooterProps) {
    return (
        <footer className="border-t mt-16">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 flex gap-3 text-sm text-muted-foreground">
                <span className="mt-0.5 size-5 shrink-0 overflow-hidden rounded">
                    <img src="/logo.webp" alt="" className="size-full scale-[1.6]" />
                </span>
                <div>
                    <p>
                        <span className="font-serif text-base text-foreground">Journal</span>: private notes you own, stored on your
                        Homebase identity.{' '}
                        <Link to="/" className="font-medium text-foreground underline underline-offset-4 decoration-border hover:decoration-foreground">
                            Start your journal
                        </Link>
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground/70">
                        Published by {identity}. Content is the author's own and is not reviewed by Journal.
                    </p>
                </div>
            </div>
        </footer>
    );
}
