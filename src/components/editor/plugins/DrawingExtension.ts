/**
 * Drawing Extension for TipTap
 * 
 * Creates a block-level drawing node with embedded canvas.
 * Supports pressure-sensitive strokes, shapes, and handwriting-to-text.
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { DrawingNodeView } from '../nodes/DrawingNodeView';

export interface DrawingOptions {
    HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        drawing: {
            /**
             * Insert a drawing canvas at the current position
             */
            insertDrawing: (options?: { width?: number; height?: number }) => ReturnType;
        };
    }
}

export const DrawingExtension = Node.create<DrawingOptions>({
    name: 'drawing',

    group: 'block',

    atom: true,

    draggable: true,

    addOptions() {
        return {
            HTMLAttributes: {},
        };
    },

    addAttributes() {
        return {
            // Drawing data stored as JSON string
            data: {
                default: JSON.stringify({
                    strokes: [],
                    shapes: [],
                    width: 600,
                    height: 400,
                    backgroundColor: 'transparent',
                }),
                parseHTML: element => element.getAttribute('data-drawing') || this.options.HTMLAttributes.data,
                renderHTML: attributes => {
                    return {
                        'data-drawing': attributes.data,
                    };
                },
            },
            // Canvas width
            width: {
                default: 600,
                parseHTML: element => parseInt(element.getAttribute('data-width') || '600', 10),
                renderHTML: attributes => ({
                    'data-width': attributes.width,
                }),
            },
            // Canvas height
            height: {
                default: 400,
                parseHTML: element => parseInt(element.getAttribute('data-height') || '400', 10),
                renderHTML: attributes => ({
                    'data-height': attributes.height,
                }),
            },
        };
    },

    parseHTML() {
        return [
            {
                tag: 'div[data-type="drawing"]',
            },
        ];
    },

    renderHTML({ HTMLAttributes }) {
        return ['div', mergeAttributes(
            { 'data-type': 'drawing' },
            this.options.HTMLAttributes,
            HTMLAttributes
        )];
    },

    addNodeView() {
        return ReactNodeViewRenderer(DrawingNodeView);
    },

    addCommands() {
        return {
            insertDrawing: (options = {}) => ({ commands }) => {
                const width = options.width || 600;
                const height = options.height || 400;

                return commands.insertContent({
                    type: this.name,
                    attrs: {
                        width,
                        height,
                        data: JSON.stringify({
                            strokes: [],
                            shapes: [],
                            width,
                            height,
                            backgroundColor: 'transparent',
                        }),
                    },
                });
            },
        };
    },

    addKeyboardShortcuts() {
        return {
            // Delete drawing when backspace is pressed on empty drawing
            Backspace: () => {
                const { selection } = this.editor.state;
                const node = this.editor.state.doc.nodeAt(selection.from);

                if (node?.type.name === 'drawing') {
                    // Check if drawing is empty
                    try {
                        const data = JSON.parse(node.attrs.data);
                        if (data.strokes.length === 0 && data.shapes.length === 0) {
                            return this.editor.commands.deleteSelection();
                        }
                    } catch {
                        // Invalid data, allow deletion
                        return this.editor.commands.deleteSelection();
                    }
                }

                return false;
            },
        };
    },
});
