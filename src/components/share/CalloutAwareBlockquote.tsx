/**
 * react-markdown `blockquote` override for the share page (#159). A quote whose
 * first paragraph starts with an Obsidian-style `[!info|warning|tip|error]`
 * marker (how the serializer writes callouts) renders as a styled aside with
 * the marker stripped; any other quote renders as a plain <blockquote>.
 */
import { Children, cloneElement, isValidElement, type ComponentProps, type ReactNode } from 'react';
import type { ExtraProps } from 'react-markdown';
import { cn } from '@/lib/utils';
import { CalloutIcon } from '@/components/editor/nodes/CalloutIcon';
import { CALLOUT_CLASSES, type CalloutVariant } from '@/components/editor/nodes/calloutVariants';

const MARKER = /^\[!(info|warning|tip|error)\]\s*/;

export function CalloutAwareBlockquote({ node, children, ...rest }: ComponentProps<'blockquote'> & ExtraProps) {
  // `node` is react-markdown's own extra prop, not a DOM attribute.
  void node;
  const items = Children.toArray(children);
  const index = items.findIndex((c) => isValidElement(c));
  const first = items[index];
  const [head, ...tail] = isValidElement<{ children?: ReactNode }>(first) && first.type === 'p'
    ? Children.toArray(first.props.children)
    : [];
  const match = typeof head === 'string' ? MARKER.exec(head) : null;

  if (!match || !isValidElement(first)) return <blockquote {...rest}>{children}</blockquote>;

  const variant = match[1] as CalloutVariant;
  const text = (head as string).slice(match[0].length);
  if (text || tail.length) items[index] = cloneElement(first, undefined, ...(text ? [text] : []), ...tail);
  else items.splice(index, 1);

  return (
    <aside
      role="note"
      data-variant={variant}
      className={cn('my-4 flex gap-2 rounded-md border-l-4 px-3', CALLOUT_CLASSES[variant])}
    >
      <CalloutIcon variant={variant} className="mt-4" />
      <div className="min-w-0 flex-1">{items}</div>
    </aside>
  );
}
