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
import { prepareImageForUpload, UnsupportedImageError } from '@/lib/images/imageIngest';

export interface FileHandlerOptions {
    /** Maximum file size in MB */
    maxSizeMB: number;
    /** Allowed MIME types */
    allowedTypes: string[];
    /** Callback when an image is dropped/pasted */
    onImageDrop: (file: File, pendingId: string) => Promise<void>;
    /** True when images can't be added (a note shared with you: no peer upload yet) */
    imagesReadOnly: boolean;
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
    const { maxSizeMB, allowedTypes, onImageDrop, imagesReadOnly } = options;

    // Otherwise the upload would be queued and could never succeed
    if (imagesReadOnly) {
        toast.error("Images can't be added to notes shared with you yet");
        return false;
    }

    // Validate file type
    if (!allowedTypes.includes(file.type)) {
        toast.error(`Unsupported file type: ${file.type}`);
        return false;
    }

    // Downscale, re-orient and strip EXIF before the file is sized, queued or shown
    let processed: File;
    try {
        processed = await prepareImageForUpload(file);
    } catch (error) {
        if (error instanceof UnsupportedImageError) {
            toast.error("This browser can't read HEIC images — export the photo as JPEG");
        } else {
            console.error('[FileHandler] Failed to process image:', error);
            toast.error('Failed to process image');
        }
        return false;
    }

    // Validate file size (against the processed bytes)
    if (processed.size > maxSizeMB * 1024 * 1024) {
        toast.error(`File too large. Maximum size is ${maxSizeMB}MB`);
        return false;
    }

    const pendingId = getNewId();

    // Queue before inserting: the node renders from the queued bytes, and a node
    // without its queue row reads as another device's upload.
    try {
        await onImageDrop(processed, pendingId);
    } catch (error) {
        console.error('[FileHandler] Failed to queue image:', error);
        toast.error('Failed to queue image for upload');
        return false;
    }
    if (editor.isDestroyed) return false;

    editor.chain().focus().insertContent({
        type: 'image',
        attrs: {
            src: URL.createObjectURL(processed),
            'data-pending-id': pendingId,
        },
    }).run();

    return true;
}

export const FileHandler = Extension.create<FileHandlerOptions>({
    name: 'fileHandler',

    addOptions() {
        return {
            maxSizeMB: 20,
            allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif'],
            onImageDrop: async () => { },
            imagesReadOnly: false,
        };
    },

    addCommands() {
        return {
            // Each insert lands after its queue write, outside this command's transaction.
            insertImageFiles: (files: File[]) => () => {
                for (const file of files) void processImageFile(this.editor, this.options, file);
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

                        event.preventDefault();

                        // Check if any file is an image
                        const imageFiles = Array.from(files).filter(f =>
                            allowedTypesSet.has(f.type)
                        );

                        if (!imageFiles.length) {
                            toast.error('Unsupported image type');
                            return true;
                        }

                        // Process each image file
                        for (const file of imageFiles) {
                            processImageFile(editor, options, file);
                        }

                        return true;
                    },

                    handlePaste: (_view, event) => {
                        const items = event.clipboardData?.items;
                        if (!items) return false;

                        let hasFile = false;
                        const imageItems: DataTransferItem[] = [];
                        for (const item of items) {
                            if (item.kind !== 'file') continue;
                            hasFile = true;
                            if (allowedTypesSet.has(item.type)) imageItems.push(item);
                        }
                        if (!hasFile) return false;

                        if (!imageItems.length) {
                            toast.error('Unsupported image type');
                            return true;
                        }

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
