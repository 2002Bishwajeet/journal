import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { shareProvider } from '@/lib/providers/ShareProvider';
import { createNoteFromMarkdownInDb } from '@/lib/notes/createNote';
import { MAIN_FOLDER_ID } from '@/lib/homebase';

// An identity is a hostname (optionally with a port); a file id is a GUID, with or without hyphens.
const IDENTITY = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?$/i;
const FILE_ID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

// `attachment://` images belong to the author's drive and are not copied; the alt text stays.
const ATTACHMENT_IMAGE = /!\[([^\]]*)\]\(attachment:\/\/[^)\s]*(?:\s+"[^"]*")?\)/g;

export const isValidShareLink = (identity: string | null, file: string | null): identity is string =>
    !!identity && !!file && IDENTITY.test(identity) && FILE_ID.test(file);

export interface CopiedNote {
    docId: string;
    folderId: string;
    title: string;
    hadImages: boolean;
}

/**
 * Copies a publicly shared note into the signed-in user's own Journal: a new
 * note "{title} (copy)" in the default folder, opening with a "Copied from" line.
 * Only guest reads reach the author's identity; the original is never touched.
 */
export async function copySharedNote(identity: string, file: string, origin: string): Promise<CopiedNote> {
    const note = await shareProvider.getPublicNote(identity, file);
    if (!note) throw new Error('This note is not shared any more, or the link is not right.');

    const body = note.content.replace(ATTACHMENT_IMAGE, '$1');
    const title = `${note.title} (copy)`;
    const shareUrl = `${origin}/share/${identity}/${file}`;
    const { docId, folderId } = await createNoteFromMarkdownInDb({
        title,
        content: `Copied from ${shareUrl}\n\n${body}`,
        folderId: MAIN_FOLDER_ID,
    });
    return { docId, folderId, title, hadImages: body !== note.content };
}

/**
 * Drives `/save-shared?identity=…&file=…`: validates the link, saves the copy
 * once, opens it and toasts. An unusable link or a failed read is an `error`
 * for the page to show; nothing is created then.
 */
export function useSaveSharedNote(): { error: string | null } {
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const [copyError, setCopyError] = useState<string | null>(null);
    const started = useRef(false);

    const identity = params.get('identity');
    const file = params.get('file');
    const valid = isValidShareLink(identity, file);

    useEffect(() => {
        // Strict mode runs effects twice; one visit must make one copy.
        if (!valid || started.current) return;
        started.current = true;
        copySharedNote(identity, file!, window.location.origin)
            .then((copy) => {
                toast.success(
                    copy.hadImages
                        ? `Saved "${copy.title}". Images were not copied; their descriptions are kept.`
                        : `Saved "${copy.title}"`,
                );
                navigate(`/${copy.folderId}/${copy.docId}`, { replace: true });
            })
            .catch((err: unknown) => {
                console.error('[useSaveSharedNote] Failed to save a copy:', err);
                setCopyError(err instanceof Error ? err.message : 'Could not save a copy of this note.');
            });
    }, [valid, identity, file, navigate]);

    return { error: valid ? copyError : 'This link is not a valid shared note link.' };
}
