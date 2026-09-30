import { useEffect, useState } from "react";

export interface StorageInfo {
    /** Bytes this origin is using (IndexedDB, caches, …), or null if unknown. */
    usage: number | null;
    /** Bytes the browser will let this origin use, or null if unknown. */
    quota: number | null;
    /** Whether the browser promised not to evict this origin's data, or null if unknown. */
    persisted: boolean | null;
    /** Ask the browser for persistent storage; resolves to whether it was granted. */
    requestPersist: () => Promise<boolean>;
}

const UNITS = ["B", "KB", "MB", "GB", "TB"];

/** Human-readable size, e.g. `1.2 GB`, `850 MB`, `12 KB`. */
export function formatBytes(n: number): string {
    let i = 0;
    while (n >= 1024 && i < UNITS.length - 1) {
        n /= 1024;
        i++;
    }
    const value = i > 0 && n < 10 ? Math.round(n * 10) / 10 : Math.round(n);
    return `${value} ${UNITS[i]}`;
}

/** Reads how much this browser is storing and whether it is protected from eviction. */
export function useStorageInfo(): StorageInfo {
    const [estimate, setEstimate] = useState<{ usage: number | null; quota: number | null }>({
        usage: null,
        quota: null,
    });
    const [persisted, setPersisted] = useState<boolean | null>(null);

    useEffect(() => {
        const storage = navigator.storage;
        let cancelled = false;
        storage?.estimate?.()
            .then(({ usage, quota }) => {
                if (!cancelled) setEstimate({ usage: usage ?? null, quota: quota ?? null });
            })
            .catch(() => {});
        storage?.persisted?.()
            .then((value) => {
                if (!cancelled) setPersisted(value);
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, []);

    const requestPersist = async () => {
        if (!navigator.storage?.persist) return false;
        const granted = await navigator.storage.persist();
        setPersisted(granted);
        return granted;
    };

    return { ...estimate, persisted, requestPersist };
}
