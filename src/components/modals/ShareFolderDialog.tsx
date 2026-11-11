import { Copy, ExternalLink, Globe, Lock } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useSheetMode } from '@/hooks/useSheetMode';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import ConfirmDialog from '@/components/modals/ConfirmDialog';
import { ShareCardPreview } from '@/components/share/ShareCardPreview';
import { useShareFolderDialog } from '@/hooks/useShareFolderDialog';
import { publicOrigin } from '@/lib/native';

interface ShareFolderDialogProps {
    folder: { id: string; name: string; isPublic?: boolean } | null;
    onClose: () => void;
}

/** Share a folder, or stop (#631): its state, link and the preview people see, laid out like the note Share dialog. */
export default function ShareFolderDialog({ folder, onClose }: ShareFolderDialogProps) {
    const { url, description, cardImage, toShare, copy, share, askToStop, publicNotes, cancelStop, stop } = useShareFolderDialog(folder);
    const isPublic = !!folder?.isPublic;
    const asSheet = useSheetMode();

    const status = (
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${isPublic ? 'bg-primary text-primary-foreground' : 'border text-muted-foreground'}`}>
            {isPublic ? <Globe className="size-3" /> : <Lock className="size-3" />}
            {isPublic ? 'Public' : 'Private'}
        </span>
    );
    const subtitle = `Share “${folder?.name}” with a public link`;

    const shareButton = (
        <Button size="lg" className="w-full max-sm:h-11" onClick={share}>
            <Globe />
            Share folder
        </Button>
    );

    const options = !isPublic ? (
        <p className="flex gap-3 rounded-lg border bg-muted/40 px-4 py-3 text-sm leading-relaxed text-pretty">
            <Globe className="mt-1 size-4 shrink-0 text-muted-foreground" />
            <span>{toShare === null ? 'The notes' : `${toShare} ${toShare === 1 ? 'note' : 'notes'}`} in this folder will become public, and new notes in this folder start public.</span>
        </p>
    ) : (
        <>
            <Input readOnly value={url} aria-label="Folder link" className="min-w-0 bg-muted/40 pointer-fine:text-sm max-sm:h-11" />
            <div className="flex gap-2">
                <Button variant="outline" className="flex-1 max-sm:h-11" onClick={copy}>
                    <Copy />
                    Copy link
                </Button>
                <Button variant="outline" className="flex-1 max-sm:h-11" onClick={() => window.open(url, '_blank')}>
                    <ExternalLink />
                    Open in New Tab
                </Button>
            </div>
            <div className="mt-auto border-t pt-3">
                <Button
                    variant="ghost"
                    className="w-full justify-start text-red-700 hover:bg-red-500/10 hover:text-red-700 max-sm:h-11 dark:text-red-400 dark:hover:bg-red-400/10 dark:hover:text-red-400"
                    onClick={askToStop}
                >
                    <Lock />
                    Stop sharing (make private)
                </Button>
            </div>
        </>
    );

    const preview = (
        <div className="flex w-full max-w-[500px] flex-col gap-3">
            <h3 id="share-folder-preview-heading" className="text-sm leading-5 font-medium text-muted-foreground">Link preview</h3>
            <ShareCardPreview
                title={folder?.name ?? ''}
                description={description}
                domain={new URL(publicOrigin()).host}
                image={<img src={cardImage ?? '/banner.webp'} alt="" className="h-full w-full object-cover" />}
            />
        </div>
    );

    return (
        <>
            {asSheet ? (
                <Sheet open={!!folder} onOpenChange={(open) => !open && onClose()}>
                    <SheetContent variant="full" className="share-ui">
                        <SheetHeader>
                            <div className="flex min-w-0 items-center gap-3">
                                <SheetTitle className="font-serif text-xl leading-7 font-normal tracking-tight">Share Folder</SheetTitle>
                                {status}
                            </div>
                            <SheetDescription className="truncate">{subtitle}</SheetDescription>
                        </SheetHeader>
                        <SheetBody className="flex flex-col gap-5 py-5">
                            <section aria-labelledby="share-folder-preview-heading">{preview}</section>
                            <section aria-label="Sharing options" className="flex min-w-0 flex-col gap-4">{options}</section>
                        </SheetBody>
                        {!isPublic && <SheetFooter className="border-t pb-3">{shareButton}</SheetFooter>}
                    </SheetContent>
                </Sheet>
            ) : (
                <Dialog open={!!folder} onOpenChange={(open) => !open && onClose()}>
                    <DialogContent className="share-dialog max-h-none top-1/2 gap-0 overflow-hidden p-0 sm:max-w-[min(960px,calc(100vw-2rem))] sm:[&>[data-slot=dialog-close]]:top-5.5">
                        <div className="flex h-[min(520px,90dvh)] min-w-0 flex-col">
                            <DialogHeader className="shrink-0 gap-1.5 border-b px-6 py-4 pr-14 text-left">
                                <div className="flex min-w-0 items-center gap-3">
                                    <DialogTitle className="font-serif text-xl leading-7 font-normal tracking-tight">Share Folder</DialogTitle>
                                    {status}
                                </div>
                                <DialogDescription className="truncate">{subtitle}</DialogDescription>
                            </DialogHeader>

                            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-contain min-[880px]:flex-row min-[880px]:overflow-hidden">
                                <section aria-label="Sharing options" className="flex min-w-0 flex-col gap-4 p-6 min-[880px]:min-h-0 min-[880px]:flex-1 min-[880px]:overflow-y-auto">
                                    {options}
                                    {!isPublic && shareButton}
                                </section>

                                <section
                                    aria-labelledby="share-folder-preview-heading"
                                    className="order-first flex min-w-0 shrink-0 flex-col p-6 pb-0 min-[880px]:order-last min-[880px]:w-[548px] min-[880px]:overflow-y-auto min-[880px]:border-l min-[880px]:bg-muted/30 min-[880px]:pb-6"
                                >
                                    {preview}
                                </section>
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>
            )}

            <ConfirmDialog
                isOpen={publicNotes !== null}
                onClose={cancelStop}
                onConfirm={stop}
                title="Stop sharing folder?"
                description={`${publicNotes ?? 0} ${publicNotes === 1 ? 'note' : 'notes'} will become private, and new notes in this folder will stay private.`}
                confirmText="Stop sharing"
            />
        </>
    );
}
