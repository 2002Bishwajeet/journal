import { useEffect, useState } from 'react';
import type { SettingsSectionId } from '@/components/settings/sections';

export const OPEN_SETTINGS_EVENT = 'journal:open-settings';

/**
 * Open Settings on a section from anywhere in the app (e.g. the sync status popover
 * opening Diagnostics, #800). JournalLayout owns the dialog and listens for this.
 */
export function openSettings(section: SettingsSectionId): void {
    window.dispatchEvent(new CustomEvent<SettingsSectionId>(OPEN_SETTINGS_EVENT, { detail: section }));
}

/** Settings dialog state for the layout: opened by `open()` or by `openSettings(section)` elsewhere. */
export function useSettingsOpener() {
    const [isOpen, setIsOpen] = useState(false);
    const [section, setSection] = useState<SettingsSectionId | undefined>();

    useEffect(() => {
        const onOpen = (event: Event) => {
            setSection((event as CustomEvent<SettingsSectionId>).detail);
            setIsOpen(true);
        };
        window.addEventListener(OPEN_SETTINGS_EVENT, onOpen);
        return () => window.removeEventListener(OPEN_SETTINGS_EVENT, onOpen);
    }, []);

    return {
        isOpen,
        /** The section asked for by the opener; undefined to keep the dialog's last one. */
        section,
        open: () => {
            setSection(undefined);
            setIsOpen(true);
        },
        close: () => setIsOpen(false),
    };
}
