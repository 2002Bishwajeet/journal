import { useSyncExternalStore } from 'react';
import { isNativeApp } from '@/lib/native';

/**
 * Whether this device may write notes and folders (#1176). The native app answers from
 * `@premium`'s `useEntitlement().canEdit` (CanEditReporter in components/license/License.tsx):
 * false only after its trial ends without an unlock. Reading, search and export never check it.
 * `undefined` while the native app reads its sources; the web app is always `true`.
 */
let answer: boolean | undefined | null = null; // null: not set yet
const listeners = new Set<() => void>();

const getAnswer = () => (answer === null ? (isNativeApp() ? undefined : true) : answer);
// Server rendering (tests) has no native app.
const getServerAnswer = () => (answer === null ? true : answer);

/** Called only by CanEditReporter (and tests). */
export function setCanEdit(value: boolean | undefined): void {
    if (value === answer) return;
    answer = value;
    listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

/** For write paths outside React (event listeners). Editing stays on until the answer is known. */
export const getCanEdit = (): boolean => getAnswer() !== false;

/** Editing stays on while the native app reads its entitlement: the web app is free. */
export function useCanEdit(): boolean {
    return useSyncExternalStore(subscribe, getAnswer, getServerAnswer) !== false;
}

/**
 * The answer itself, `undefined` until it is known. Only for a write that runs by itself on
 * mount (saving a shared note's copy), which must wait for it.
 */
export function useCanEditAnswer(): boolean | undefined {
    return useSyncExternalStore(subscribe, getAnswer, getServerAnswer);
}
