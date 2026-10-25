/**
 * Shows the edit the in-app agent proposes for the note as a preview in the note itself (#701):
 * added text is underlined in the success colour, removed text is struck through, a changed
 * block is outlined, and a bar below the change has the summary with Accept and Reject.
 * The note's content is not touched until Accept. Enter accepts and Escape rejects while the
 * bar has focus; the bar takes focus when it appears and gives it back to the editor.
 *
 * The decorations map through other changes (remote edits, typing) while the preview shows.
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { DOMSerializer, type Mark, type Node as PMNode } from '@tiptap/pm/model';
import { AddMarkStep, RemoveMarkStep, ReplaceStep } from '@tiptap/pm/transform';
import { toast } from 'sonner';
import { NOT_APPLIED_MESSAGE, acceptEdit, pendingEdits, rejectEdit, type PendingEdit } from '@/lib/agent/approveEdit';

interface PreviewState {
    item: PendingEdit | null;
    decorations: DecorationSet;
}

const previewKey = new PluginKey<PreviewState>('agentEditPreview');

const BUTTON =
    'inline-flex h-8 pointer-coarse:h-11 items-center rounded-md px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = label;
    el.className = `${BUTTON} ${className}`;
    el.addEventListener('click', onClick);
    return el;
}

/**
 * On wide screens the assistant panel floats over the right of the note. Sets
 * `--agent-edit-right` on the editor, the right inset of the preview's outline and bar
 * (index.css), so both end 12px before the panel. Without a panel beside the note they
 * reach 0.5rem past the text, as they do on the left.
 */
function fitBesidePanel(dom: HTMLElement) {
    const panel = document.querySelector('[role="region"][aria-label="Assistant"]')?.getBoundingClientRect();
    const rect = dom.getBoundingClientRect();
    const textRight = rect.right - parseFloat(getComputedStyle(dom).paddingRight);
    const covered = panel && panel.left > rect.left ? textRight - panel.left + 12 : 0;
    dom.style.setProperty('--agent-edit-right', covered > 0 ? `${covered}px` : '-0.5rem');
}

/** The tag the note renders `mark` with (strong for bold), so the preview shows the new formatting. */
function markTag(mark: Mark): string | undefined {
    const spec = mark.type.spec.toDOM?.(mark, true);
    return Array.isArray(spec) && typeof spec[0] === 'string' ? spec[0] : undefined;
}

/** The bar with the summary and Accept / Reject. It is a widget, so it scrolls with the note. */
function createBar(view: EditorView, item: PendingEdit): HTMLElement {
    const bar = document.createElement('div');
    bar.className =
        'agent-edit-bar flex flex-wrap items-center gap-2 rounded-lg border border-border bg-popover px-2 py-2 text-sm text-popover-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
    bar.tabIndex = 0;
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', `Review the assistant's edit: ${item.summary}`);

    const summary = document.createElement('span');
    // Summary first, then the buttons. The summary wraps above them when they don't fit on one line.
    summary.className = 'min-w-0 flex-auto line-clamp-3 break-words';
    summary.textContent = item.summary;
    summary.title = item.summary;

    const answer = async (accept: boolean) => {
        if (accept) {
            if (typeof (await acceptEdit(item)) === 'object') toast(NOT_APPLIED_MESSAGE);
        } else rejectEdit(item);
        view.focus();
    };
    const actions = document.createElement('div');
    actions.className = 'ml-auto flex shrink-0 gap-2';
    actions.append(
        button('Accept', 'bg-primary text-primary-foreground hover:bg-primary/90', () => void answer(true)),
        button('Reject', 'border border-border bg-background hover:bg-muted', () => void answer(false))
    );
    bar.append(summary, actions);
    bar.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            void answer(false);
        } else if (event.key === 'Enter' && event.target === bar) {
            event.preventDefault();
            void answer(true);
        }
    });
    requestAnimationFrame(() => bar.focus());
    return bar;
}

/** The new content, rendered as the note renders it. */
function createInserted(view: EditorView, content: PMNode['content'], block: boolean): HTMLElement {
    const el = document.createElement(block ? 'div' : 'span');
    el.className = block ? 'agent-edit-inserted agent-edit-inserted-block agent-edit-block' : 'agent-edit-inserted';
    el.appendChild(DOMSerializer.fromSchema(view.state.schema).serializeFragment(content));
    return el;
}

/**
 * The decorations for `tr`, built against `doc`: a Replace step shows its removed range
 * struck through (unless it swaps whole blocks, which are outlined) and its new content as
 * a widget after it; a mark step underlines its range. The changed top-level blocks are
 * outlined, and the bar goes after the last of them.
 */
export function previewDecorations(doc: PMNode, item: PendingEdit): DecorationSet {
    const bar = (pos: number) =>
        Decoration.widget(pos, (view) => createBar(view, item), { key: `agent-edit-bar-${item.id}`, side: 3, stopEvent: () => true, ignoreSelection: true });
    // The edit was built for another document (a note that changed while this one waited in line): show only the bar.
    if (!item.tr.before.eq(doc)) return DecorationSet.create(doc, [bar(doc.content.size)]);

    const decorations: Decoration[] = [];
    let barPos = 0;
    const outline = (from: number, to: number) => {
        doc.forEach((node, offset) => {
            const end = offset + node.nodeSize;
            if (offset >= to || end <= from) return;
            decorations.push(Decoration.node(offset, end, { class: 'agent-edit-block' }));
            barPos = Math.max(barPos, end);
        });
    };

    for (const step of item.tr.steps) {
        if (step instanceof ReplaceStep) {
            const { from, to, slice } = step;
            const $from = doc.resolve(from);
            const atTop = $from.depth === 0 && doc.resolve(to).depth === 0;
            const swapsBlocks = atTop && from < to && slice.size > 0;
            if (from < to && !swapsBlocks) decorations.push(Decoration.inline(from, to, { class: 'agent-edit-removed' }));
            if (from < to) outline(from, to);
            else if (atTop) barPos = Math.max(barPos, from);
            else outline($from.before(1), $from.after(1));
            if (slice.size > 0) {
                const block = !!slice.content.firstChild?.isBlock;
                const key = `agent-edit-new-${item.id}-${decorations.length}`;
                decorations.push(Decoration.widget(to, (view) => createInserted(view, slice.content, block), { key, side: block ? 1 : 2, ignoreSelection: true }));
            }
        } else if (step instanceof AddMarkStep) {
            // Wrap the text in the mark's tag, so a bold edit previews as bold.
            const nodeName = markTag(step.mark);
            decorations.push(Decoration.inline(step.from, step.to, { class: 'agent-edit-format', ...(nodeName && { nodeName }) }));
            outline(step.from, step.to);
        } else if (step instanceof RemoveMarkStep) {
            decorations.push(Decoration.inline(step.from, step.to, { class: 'agent-edit-format', 'data-unmark': step.mark.type.name }));
            outline(step.from, step.to);
        }
    }
    return DecorationSet.create(doc, [...decorations, bar(barPos)]);
}

function apply(tr: Transaction, value: PreviewState): PreviewState {
    const meta = tr.getMeta(previewKey) as { item: PendingEdit | null } | undefined;
    if (meta) return { item: meta.item, decorations: meta.item ? previewDecorations(tr.doc, meta.item) : DecorationSet.empty };
    return tr.docChanged ? { item: value.item, decorations: value.decorations.map(tr.mapping, tr.doc) } : value;
}

export const AgentEditPreview = Extension.create({
    name: 'agentEditPreview',

    addProseMirrorPlugins() {
        const { editor } = this;
        return [
            new Plugin<PreviewState>({
                key: previewKey,
                state: { init: () => ({ item: null, decorations: DecorationSet.empty }), apply },
                props: { decorations: (state) => previewKey.getState(state)?.decorations },
                view: (view) => {
                    const fit = () => fitBesidePanel(view.dom);
                    window.addEventListener('resize', fit);
                    const unsubscribe = pendingEdits.subscribe(() => {
                        const item = pendingEdits.current(editor);
                        if (item === previewKey.getState(view.state)?.item) return;
                        view.dispatch(view.state.tr.setMeta(previewKey, { item }).setMeta('addToHistory', false));
                        if (item) requestAnimationFrame(fit);
                    });
                    return {
                        destroy: () => {
                            unsubscribe();
                            window.removeEventListener('resize', fit);
                        },
                    };
                },
            }),
        ];
    },
});
