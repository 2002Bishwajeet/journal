/**
 * FileHandler Extension
 *
 * Handles file drops and pastes in the editor.
 * Validates images (size, type) and queues them for upload.
 */

import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { yUndoPluginKey } from 'y-prosemirror';
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
            /** Swap the file of the image node at `pos` in place: width, align and alt stay. */
            replaceImageFile: (pos: number, file: File) => ReturnType;
        };
    }
}

/** Validate, process and queue a file; null (after a toast) when it can't be used. */
async function queueImageFile(options: FileHandlerOptions, file: File): Promise<{ processed: File; pendingId: string } | null> {
    const { maxSizeMB, allowedTypes, onImageDrop, imagesReadOnly } = options;

    // Otherwise the upload would be queued and could never succeed
    if (imagesReadOnly) {
        toast.error("Images can't be added to notes shared with you yet");
        return null;
    }

    // Validate file type
    if (!allowedTypes.includes(file.type)) {
        toast.error(`Unsupported file type: ${file.type}`);
        return null;
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
        return null;
    }

    // Validate file size (against the processed bytes)
    if (processed.size > maxSizeMB * 1024 * 1024) {
        toast.error(`File too large. Maximum size is ${maxSizeMB}MB`);
        return null;
    }

    const pendingId = getNewId();

    // Queue before inserting: the node renders from the queued bytes, and a node
    // without its queue row reads as another device's upload.
    try {
        await onImageDrop(processed, pendingId);
    } catch (error) {
        console.error('[FileHandler] Failed to queue image:', error);
        toast.error('Failed to queue image for upload');
        return null;
    }
    return { processed, pendingId };
}

async function processImageFile(editor: Editor, options: FileHandlerOptions, file: File, pos?: number): Promise<boolean> {
    const queued = await queueImageFile(options, file);
    if (!queued || editor.isDestroyed) return false;
    const { processed, pendingId } = queued;

    const content = {
        type: 'image',
        attrs: {
            src: URL.createObjectURL(processed),
            'data-pending-id': pendingId,
        },
    };

    if (pos !== undefined) {
        editor.chain().focus().insertContentAt(pos, content).run();
    } else {
        editor.chain().focus().insertContent(content).run();
    }

    return true;
}

async function replaceImageFile(editor: Editor, options: FileHandlerOptions, pos: number, file: File): Promise<void> {
    const oldSrc = editor.state.doc.nodeAt(pos)?.attrs.src;
    const queued = await queueImageFile(options, file);
    if (!queued || editor.isDestroyed) return;

    // The doc may have changed while the file was processed
    const node = editor.state.doc.nodeAt(pos);
    if (node?.type.name !== 'image' || node.attrs.src !== oldSrc) {
        toast.error('The image moved; replace it again');
        return;
    }

    // One undo step of its own, so undo brings the old image back (the deletion tracker waits for that).
    const undoManager = yUndoPluginKey.getState(editor.state)?.undoManager;
    undoManager?.stopCapturing();
    editor.view.dispatch(
        editor.state.tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            src: URL.createObjectURL(queued.processed),
            'data-pending-id': queued.pendingId,
        }),
    );
    undoManager?.stopCapturing();
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
            replaceImageFile: (pos: number, file: File) => () => {
                void replaceImageFile(this.editor, this.options, pos, file);
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
                    handleDrop: (view, event, _slice, moved) => {
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

                        // Insert at the drop point, not wherever the cursor happens to be
                        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;

                        // Await each insert in turn, so with several files they land in drop order
                        void (async () => {
                            let insertAt = pos;
                            for (const file of imageFiles) {
                                const inserted = await processImageFile(editor, options, file, insertAt);
                                if (inserted && insertAt !== undefined) insertAt = editor.state.selection.to;
                            }
                        })();

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
