import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFolders } from '@/hooks/useFolders';
import { useFolderLockState } from '@/hooks/useNoteLock';
import { nativePlatform, type NativePlatform } from '@/lib/native';

/** What Unlock asks for (src-tauri/src/app_lock.rs). A Mac otherwise. */
const UNLOCK_WITH: Partial<Record<NativePlatform, string>> = {
    windows: 'Windows Hello',
    ios: 'Face ID',
    android: 'your fingerprint',
};

const unlockWith = () => {
    const platform = nativePlatform();
    return (platform && UNLOCK_WITH[platform]) ?? 'Touch ID';
};

/** The editor of a locked note (#1427): nothing of the note but its title until Unlock. */
export function LockedNotePanel({
    title,
    canUnlock,
    onUnlock,
    onBack,
}: {
    title: string;
    canUnlock: boolean;
    onUnlock: () => void;
    /** Touch layouts: the note screen's header isn't there, so the panel has the way back. */
    onBack?: () => void;
}) {
    return (
        <div
            role="region"
            aria-label="Locked note"
            className="flex h-full flex-col items-center justify-center gap-4 px-6 pt-[env(safe-area-inset-top)] text-center"
        >
            <div className="flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Lock className="size-6" aria-hidden />
            </div>
            <div className="max-w-xs space-y-1.5">
                <h2 className="text-base font-semibold text-foreground">This note is locked</h2>
                <p className="truncate text-sm font-medium text-foreground/80">{title || 'Untitled'}</p>
                <p className="text-sm text-muted-foreground text-pretty">
                    {canUnlock
                        ? `Unlock it with ${unlockWith()} to read and edit it.`
                        : 'Open Journal on a device with Touch ID, Face ID or a fingerprint to unlock it.'}
                </p>
            </div>
            <div className="flex flex-col items-center gap-2">
                {canUnlock && (
                    <Button className="min-h-11 min-w-32 md:min-h-9" onClick={onUnlock}>
                        Unlock
                    </Button>
                )}
                {onBack && (
                    <Button variant="ghost" className="min-h-11" onClick={onBack}>
                        Back to list
                    </Button>
                )}
            </div>
        </div>
    );
}

/** Above a locked folder's note list (#1427): one Unlock opens all its notes. */
export function LockedFolderNotice({ folderId }: { folderId?: string }) {
    const {
        get: { data: folders },
    } = useFolders();
    const { locked, canUnlock, unlock } = useFolderLockState(folders.find((f) => f.id === folderId));
    if (!locked) return null;
    return (
        <div
            role="region"
            aria-label="Locked folder"
            className="mx-3 mt-2 flex items-center gap-3 rounded-xl border bg-card px-4 py-3 pointer-coarse:mx-4"
        >
            <Lock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">This folder is locked</p>
                <p className="text-xs text-muted-foreground text-pretty">
                    {canUnlock ? 'Unlock once to open all its notes.' : 'Unlock it in the Journal app.'}
                </p>
            </div>
            {canUnlock && (
                <Button variant="outline" size="sm" className="min-h-11 shrink-0 md:min-h-8" onClick={unlock}>
                    Unlock
                </Button>
            )}
        </div>
    );
}
