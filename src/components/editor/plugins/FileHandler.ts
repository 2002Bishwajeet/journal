/**
 * FileHandler Extension
 *
 * Handles file drops and pastes in the editor.
 * Validates images (size, type) and queues them for upload.
 */

import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { toast } from 'sonner';
import { getNewId } from '@homebase-id/js-lib/helpers';

export interface FileHandlerOptions {
    /** Maximum file size in MB */
    maxSizeMB: number;
    /** Allowed MIME types */
    allowedTypes: string[];
    /** Callback when an image is dropped/pasted */
    onImageDrop: (file: File, pendingId: string) => Promise<void>;
    /** True when images can't be added (a note shared with you: no peer upload yet) */
    isReadOnlyForImages: () => boolean;
}

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        fileHandler: {
            /** Validate, insert and queue image files — the same path as drop/paste. */
            insertImageFiles: (files: File[]) => ReturnType;
        };
    }
}

async function processImageFile(editor: Editor, options: FileHandlerOptions, file: File): Promise<boolean> {
    const { maxSizeMB, allowedTypes, onImageDrop, isReadOnlyForImages } = options;

    // Otherwise the upload would be queued and could never succeed
    if (isReadOnlyForImages()) {
        toast.error("Images can't be added to notes shared with you yet");
        return false;
    }

    // Validate file type
    if (!allowedTypes.includes(file.type)) {
        toast.error(`Unsupported file type: ${file.type}`);
        return false;
    }

    // Validate file size
    if (file.size > maxSizeMB * 1024 * 1024) {
        toast.error(`File too large. Maximum size is ${maxSizeMB}MB`);
        return false;
    }

    const pendingId = getNewId();
    const blobUrl = URL.createObjectURL(file);

    // Insert image with pending marker
    editor.chain().focus().insertContent({
        type: 'image',
        attrs: {
            src: blobUrl,
            'data-pending-id': pendingId,
        },
    }).run();

    // Queue for upload
    try {
        await onImageDrop(file, pendingId);
    } catch (error) {
        console.error('[FileHandler] Failed to queue image:', error);
        toast.error('Failed to queue image for upload');
    }

    return true;
}

export const FileHandler = Extension.create<FileHandlerOptions>({
    name: 'fileHandler',

    addOptions() {
        return {
            maxSizeMB: 20,
            allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
            onImageDrop: async () => { },
            isReadOnlyForImages: () => false,
        };
    },

    addCommands() {
        return {
            insertImageFiles: (files: File[]) => () => {
                // Deferred: processImageFile dispatches its own transaction, which
                // must not run inside this command's.
                void Promise.resolve().then(async () => {
                    for (const file of files) await processImageFile(this.editor, this.options, file);
                });
                return true;
            },
        };
    },

    addProseMirrorPlugins() {
        const allowedTypesSet = new Set(this.options.allowedTypes);
        const editor = this.editor;
        const options = this.options;

        return [
            new Plugin({
                key: new PluginKey('fileHandler'),
                props: {
                    handleDrop: (_view, event, _slice, moved) => {
                        // Ignore if it's a move within the editor
                        if (moved) return false;

                        const files = event.dataTransfer?.files;
                        if (!files?.length) return false;

                        // Check if any file is an image
                        const imageFiles = Array.from(files).filter(f =>
                            allowedTypesSet.has(f.type)
                        );

                        if (!imageFiles.length) return false;

                        event.preventDefault();

                        // Process each image file
                        for (const file of imageFiles) {
                            processImageFile(editor, options, file);
                        }

                        return true;
                    },

                    handlePaste: (_view, event) => {
                        const items = event.clipboardData?.items;
                        if (!items) return false;

                        const imageItems = Array.from(items).filter(item =>
                            item.kind === 'file' && allowedTypesSet.has(item.type)
                        );

                        if (!imageItems.length) return false;

                        event.preventDefault();

                        for (const item of imageItems) {
                            const file = item.getAsFile();
                            if (file) {
                                processImageFile(editor, options, file);
                            }
                        }

                        return true;
                    },
                },
            }),
        ];
    },
});
