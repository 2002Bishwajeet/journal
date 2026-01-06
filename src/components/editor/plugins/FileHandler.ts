/**
 * FileHandler Extension
 * 
 * Handles file drops and pastes in the editor.
 * Validates images (size, type) and queues them for upload.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { v4 as uuid } from 'uuid';
import { toast } from 'sonner';

export interface FileHandlerOptions {
    /** Maximum file size in MB */
    maxSizeMB: number;
    /** Allowed MIME types */
    allowedTypes: string[];
    /** Callback when an image is dropped/pasted */
    onImageDrop: (file: File, pendingId: string) => Promise<void>;
}

export const FileHandler = Extension.create<FileHandlerOptions>({
    name: 'fileHandler',

    addOptions() {
        return {
            maxSizeMB: 5,
            allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
            onImageDrop: async () => { },
        };
    },

    addProseMirrorPlugins() {
        const { maxSizeMB, allowedTypes, onImageDrop } = this.options;
        const editor = this.editor;

        const processFile = async (file: File): Promise<boolean> => {
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

            const pendingId = uuid();
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
                toast.success('Image added - will sync shortly');
            } catch (error) {
                console.error('[FileHandler] Failed to queue image:', error);
                toast.error('Failed to queue image for upload');
            }

            return true;
        };

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
                            allowedTypes.includes(f.type)
                        );

                        if (!imageFiles.length) return false;

                        event.preventDefault();

                        // Process each image file
                        for (const file of imageFiles) {
                            processFile(file);
                        }

                        return true;
                    },

                    handlePaste: (_view, event) => {
                        const items = event.clipboardData?.items;
                        if (!items) return false;

                        const imageItems = Array.from(items).filter(item =>
                            item.kind === 'file' && allowedTypes.includes(item.type)
                        );

                        if (!imageItems.length) return false;

                        event.preventDefault();

                        for (const item of imageItems) {
                            const file = item.getAsFile();
                            if (file) {
                                processFile(file);
                            }
                        }

                        return true;
                    },
                },
            }),
        ];
    },
});
