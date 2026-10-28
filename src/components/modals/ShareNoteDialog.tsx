import { useState, type ReactNode } from 'react';
import { ExternalLink, Globe, Info, Loader2, Lock, Users } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/components/modals/ConfirmDialog';
import { SharePeopleSection } from '@/components/share/SharePeopleSection';
import { Notice, ShareGeneralAccess, ShareLinkPreview } from '@/components/share/ShareGeneralAccess';
import { useSheetMode } from '@/hooks/useSheetMode';
import { useShareAccess } from '@/hooks/useShareAccess';
import { useMakeNotesPublic } from '@/hooks/useMakeNotesPublic';
import { useMissingPermissions } from '@/hooks/auth/useMissingPermissions';
import { journalDriveRequest } from '@/hooks/auth/useYouAuthAuthorization';
import {
    COLLABORATION_PERMISSIONS,
    CONTACT_TARGET_DRIVE_REQUEST,
    JOURNAL_APP_ID,
    JOURNAL_APP_NAME,
} from '@/lib/homebase/config';

// Focus returns to the note row on close. The dialog opens from the row's context menu,
// which hands focus back to the row only as it finishes closing, sometimes after the
// dialog has opened. So track the element last focused outside menus and dialogs.
const isOutsideOverlays = (el: EventTarget | null): el is HTMLElement =>
    el instanceof HTMLElement && el !== document.body && !el.closest('[role="menu"], [role="dialog"]');
let lastFocusOutside = isOutsideOverlays(document.activeElement) ? document.activeElement : null;
document.addEventListener('focusin', (e) => {
    if (isOutsideOverlays(e.target)) lastFocusOutside = e.target;
});
document.addEventListener('focusout', (e) => {
    // Focus left for nowhere, so there is nothing to go back to.
    if (isOutsideOverlays(e.target) && !e.relatedTarget) lastFocusOutside = null;
});

const EXCLUSIVE = "A note can't be public and shared with people at the same time.";
const CONFIRMS = {
    public: {
        title: 'Make the note public?',
        description: `Anyone with the link will be able to view it, and the people and circles you shared it with lose access. ${EXCLUSIVE}`,
        confirmText: 'Make public',
    },
    people: {
        title: 'Share with people?',
        description: `The public link stops working, and only the people and circles you chose can open the note. ${EXCLUSIVE}`,
        confirmText: 'Share',
    },
    stop: {
        title: 'Stop sharing?',
        description: 'Everyone you shared the note with loses access. The note stays in its folder.',
        confirmText: 'Stop sharing',
    },
} as const;

interface ShareNoteDialogProps {
    isOpen: boolean;
    onClose: () => void;
    noteId: string;
    noteTitle: string;
    /** The note is in a shared folder (#618), so it is public and can't be shared with people. */
    inSharedFolder?: boolean;
}

/**
 * One Share dialog per note, like Google Docs (#682): the people and circles with access
 * and their roles, and the public link under "General access". The two can't be on
 * together, so switching from one to the other asks once. A full-screen sheet on phones.
 */
export default function ShareNoteDialog({ isOpen, onClose, noteId, noteTitle, inSharedFolder = false }: ShareNoteDialogProps) {
    const asSheet = useSheetMode();
    // After a permission grant the app reopens the dialog from this URL
    const returnUrl = `${window.location.origin}${window.location.pathname}?action=collaborate&noteId=${noteId}`;
    const grantPermissionsUrl = useMissingPermissions({
        appId: JOURNAL_APP_ID,
        drives: [journalDriveRequest, CONTACT_TARGET_DRIVE_REQUEST],
        permissions: COLLABORATION_PERMISSIONS,
        circleDrives: [journalDriveRequest, CONTACT_TARGET_DRIVE_REQUEST],
        returnUrl,
    })?.url;
    const access = useShareAccess(noteId, !grantPermissionsUrl && !inSharedFolder);
    const publishing = useMakeNotesPublic(noteId);
    const metadata = access.note?.metadata;
    const isPublic = !!metadata?.isPublic;

    const [confirm, setConfirm] = useState<keyof typeof CONFIRMS | null>(null);
    const [pendingPublic, setPendingPublic] = useState<string[]>([]);
    const [askingAboutLinks, setAskingAboutLinks] = useState(false);
    // Set after a share whose recipients got Read only: the dialog stays open to say so
    const [readOnlyDriveUrl, setReadOnlyDriveUrl] = useState<string>();
    const busy = access.isSaving || publishing.isMakingPublic || publishing.isMakingPrivate;

    const saveAndClose = async () => {
        const result = await access.save();
        if (!result.shared) return;
        if (result.readOnlyDriveUrl) setReadOnlyDriveUrl(result.readOnlyDriveUrl);
        else onClose();
    };

    const handleDone = () => {
        if (access.isDirty && isPublic && access.entries.length > 0) setConfirm('people');
        else void saveAndClose();
    };

    const handleMakePublic = (extraIds: string[]) => {
        if (!access.isShared) {
            void publishing.makePublic(extraIds);
            return;
        }
        setPendingPublic(extraIds);
        setConfirm('public');
    };

    const onConfirm = async () => {
        if (confirm === 'people') await saveAndClose();
        else if (confirm === 'stop') await access.stopSharing();
        else if (confirm === 'public' && (await access.stopSharing())) await publishing.makePublic(pendingPublic);
    };

    const handleOpenChange = (open: boolean) => {
        // A close request mid-save is ignored, so nothing is left half done
        if (!open && !busy) onClose();
    };

    const title = readOnlyDriveUrl ? 'Note shared' : 'Share Note';
    const description = readOnlyDriveUrl
        ? "People you share with can read this note but can't edit it yet."
        : `Share “${noteTitle || 'Untitled'}” with people or a public link`;
    const status = isPublic ? (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
            <Globe className="size-3" />
            Public
        </span>
    ) : access.isShared ? (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-collaborative/10 px-2 py-0.5 text-xs font-medium text-collaborative">
            <Users className="size-3" />
            Shared
        </span>
    ) : (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground">
            <Lock className="size-3" />
            Private
        </span>
    );

    const readOnlyNotice = (
        <div className="flex flex-col gap-4">
            <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                    To let them edit, open the Journal drive in Homebase and make {JOURNAL_APP_NAME} the app that owns it.
                </AlertDescription>
            </Alert>
            <div className="flex gap-2">
                <Button variant="outline" className="flex-1 max-sm:h-11" onClick={onClose}>
                    Done
                </Button>
                <Button asChild className="flex-1 max-sm:h-11">
                    <a
                        href={readOnlyDriveUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Open drive settings (opens Homebase)"
                        className="flex items-center gap-2"
                    >
                        Open drive settings <ExternalLink className="h-4 w-4" />
                    </a>
                </Button>
            </div>
        </div>
    );

    const controls = (
        <div className="flex min-w-0 flex-col gap-8">
            <div className="flex min-w-0 flex-col gap-3">
                {isPublic && !inSharedFolder && (
                    <Notice icon={Info}>The public link is on. Sharing with people turns it off. {EXCLUSIVE}</Notice>
                )}
                <SharePeopleSection
                    access={access}
                    grantPermissionsUrl={grantPermissionsUrl}
                    disabledReason={inSharedFolder
                        ? 'This note is in a shared folder, so it is public. Move it to a private folder to share it with people.'
                        : undefined}
                />
            </div>
            {/* Saving people disables the link controls too: one change at a time */}
            <fieldset disabled={access.isSaving} className="m-0 min-w-0 border-0 p-0">
                <ShareGeneralAccess
                    noteId={noteId}
                    metadata={metadata}
                    publishing={publishing}
                    onMakePublic={handleMakePublic}
                    askingAboutLinks={askingAboutLinks}
                    setAskingAboutLinks={setAskingAboutLinks}
                />
            </fieldset>
        </div>
    );

    const preview = <ShareLinkPreview noteId={noteId} noteTitle={noteTitle} isPublic={isPublic} />;

    const footer = readOnlyDriveUrl ? null : (
        <>
            {access.isShared && (
                // Apart from Done: the left end of the bar, or last on a phone
                <Button
                    variant="ghost"
                    className="text-red-700 hover:bg-red-500/10 hover:text-red-700 max-sm:order-last max-sm:h-11 sm:mr-auto dark:text-red-400 dark:hover:bg-red-400/10 dark:hover:text-red-400"
                    disabled={busy}
                    onClick={() => setConfirm('stop')}
                >
                    Stop sharing
                </Button>
            )}
            {/* Wide enough for "Saving…", so the button keeps its width while it saves */}
            <Button className="max-sm:h-11 sm:min-w-28" disabled={busy} onClick={handleDone}>
                {access.isSaving ? (
                    <>
                        <Loader2 className="animate-spin" />
                        Saving…
                    </>
                ) : (
                    'Done'
                )}
            </Button>
        </>
    );

    const onCloseAutoFocus = (e: Event) => {
        e.preventDefault();
        lastFocusOutside?.focus();
    };

    const confirmDialog = confirm && (
        <ConfirmDialog
            isOpen
            onClose={() => setConfirm(null)}
            onConfirm={() => void onConfirm()}
            {...CONFIRMS[confirm]}
        />
    );

    if (asSheet) {
        return (
            <Sheet open={isOpen} onOpenChange={handleOpenChange}>
                <SheetContent variant="full" className="share-ui" onCloseAutoFocus={onCloseAutoFocus}>
                    <SheetHeader>
                        <div className="flex min-w-0 items-center gap-3">
                            <SheetTitle className="font-serif text-xl leading-7 font-normal tracking-tight">{title}</SheetTitle>
                            {!readOnlyDriveUrl && status}
                        </div>
                        <SheetDescription className="truncate">{description}</SheetDescription>
                    </SheetHeader>
                    <SheetBody className="flex flex-col gap-6 py-4">
                        {readOnlyDriveUrl ? readOnlyNotice : (
                            <>
                                {preview}
                                {controls}
                            </>
                        )}
                    </SheetBody>
                    {footer && <SheetFooter className="border-t pb-3">{footer}</SheetFooter>}
                </SheetContent>
                {confirmDialog}
            </Sheet>
        );
    }

    return (
        <Dialog open={isOpen} onOpenChange={handleOpenChange}>
            {/* A wide dialog. The fixed height lives on the inner wrapper, not here: DialogContent
                is a grid, so a child sized to its content would never scroll. */}
            <DialogContent
                className="share-dialog share-ui max-h-none top-1/2 gap-0 overflow-hidden p-0 sm:max-w-[min(960px,calc(100vw-2rem))] sm:[&>[data-slot=dialog-close]]:top-5.5"
                onCloseAutoFocus={onCloseAutoFocus}
            >
                <div className="flex h-[min(640px,90dvh)] min-w-0 flex-col">
                    <DialogHeader className="shrink-0 gap-1.5 border-b px-6 py-4 pr-14 text-left">
                        <div className="flex min-w-0 items-center gap-3">
                            <DialogTitle className="font-serif text-xl leading-7 font-normal tracking-tight">{title}</DialogTitle>
                            {!readOnlyDriveUrl && status}
                        </div>
                        <DialogDescription className="truncate">{description}</DialogDescription>
                    </DialogHeader>

                    {readOnlyDriveUrl ? (
                        <div className="p-6">{readOnlyNotice}</div>
                    ) : (
                        <ScrollColumns controls={controls} preview={preview} />
                    )}

                    {footer && (
                        <div className="flex shrink-0 items-center justify-end gap-2 border-t px-6 py-3">{footer}</div>
                    )}
                </div>
            </DialogContent>
            {confirmDialog}
        </Dialog>
    );
}

/** One scroll area below 880px, the preview stacked above; from 880px two columns that each scroll alone. */
function ScrollColumns({ controls, preview }: { controls: ReactNode; preview: ReactNode }) {
    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-contain min-[880px]:flex-row min-[880px]:overflow-hidden">
            <section
                aria-label="Sharing options"
                className="flex min-w-0 flex-col p-6 min-[880px]:min-h-0 min-[880px]:flex-1 min-[880px]:overflow-y-auto min-[880px]:overscroll-contain"
            >
                {controls}
            </section>
            <section
                aria-labelledby="share-preview-heading"
                className="order-first flex min-w-0 shrink-0 flex-col p-6 pb-0 min-[880px]:order-last min-[880px]:w-[548px] min-[880px]:overflow-y-auto min-[880px]:overscroll-contain min-[880px]:border-l min-[880px]:bg-muted/30 min-[880px]:pb-6"
            >
                {preview}
            </section>
        </div>
    );
}
