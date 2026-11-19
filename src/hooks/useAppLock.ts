import { useEffect, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
    getLockAfterMinutes,
    getSecurityStatus,
    lockApp,
    setAppLock,
    setLockAfterMinutes,
    subscribeLockAfter,
} from '@/lib/appLock';
import { getBootProgress, PHASE_PROGRESS, subscribeBootProgress } from '@/lib/bootProgress';
import { usesEncryptedDatabase } from '@/lib/db/databaseKey';
import { appLockOn, subscribeNotesVisibility } from '@/lib/native/bridge';

const SECURITY_STATUS_KEY = ['security-status'];
const MINUTE = 60_000;

/** Settings -> Security in the native app (#1363, #1364): encryption, the app lock and its timeout. */
export function useSecuritySettings() {
    const encrypted = usesEncryptedDatabase();
    const queryClient = useQueryClient();
    const { data: status } = useQuery({
        queryKey: SECURITY_STATUS_KEY,
        queryFn: getSecurityStatus,
        enabled: encrypted,
        meta: { persist: false },
    });
    const lockAfter = useSyncExternalStore(subscribeLockAfter, getLockAfterMinutes);
    const toggle = useMutation({
        mutationFn: setAppLock,
        onSuccess: (result) => {
            if (result === 'failed') toast.error("Couldn't confirm it's you, so the app lock stays off");
        },
        onError: (err) => {
            console.error('[useSecuritySettings] The app lock did not change:', err);
            toast.error("Couldn't change the app lock");
        },
        onSettled: () => queryClient.invalidateQueries({ queryKey: SECURITY_STATUS_KEY }),
    });

    return {
        encrypted,
        status,
        changingLock: toggle.isPending,
        setLockOn: (on: boolean) => toggle.mutate(on),
        lockAfter,
        setLockAfter: setLockAfterMinutes,
        lockNow: () => {
            lockApp().catch((err: unknown) => {
                console.error('[useSecuritySettings] Lock now failed:', err);
                toast.error("Couldn't lock the app");
            });
        },
    };
}

/**
 * True while the app lock is on and the database isn't open yet: the layout shows the splash
 * (and the lock screen over it) instead of notes the query cache restored.
 */
export function useAppLockGate(): boolean {
    const lockOn = useSyncExternalStore(subscribeNotesVisibility, appLockOn);
    const progress = useSyncExternalStore(subscribeBootProgress, getBootProgress);
    return usesEncryptedDatabase() && lockOn && progress < PHASE_PROGRESS['db-ready'];
}

/** "Lock after N minutes hidden": locks once the app has been hidden that long. */
export function useLockWhenHidden(): void {
    useEffect(() => {
        if (!usesEncryptedDatabase()) return;
        let hiddenAt: number | null = null;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const lockAfter = () => {
            const minutes = appLockOn() ? getLockAfterMinutes() : null;
            return minutes === null ? null : minutes * MINUTE;
        };
        const lock = () => {
            lockApp().catch((err: unknown) => console.error('[useLockWhenHidden] Lock failed:', err));
        };
        const onVisibility = () => {
            clearTimeout(timer);
            const after = lockAfter();
            if (document.visibilityState === 'hidden') {
                hiddenAt = Date.now();
                if (after !== null) timer = setTimeout(lock, after);
                return;
            }
            // A timer in a hidden page can run late: check the time on the way back too.
            if (after !== null && hiddenAt !== null && Date.now() - hiddenAt >= after) lock();
            hiddenAt = null;
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            clearTimeout(timer);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, []);
}
