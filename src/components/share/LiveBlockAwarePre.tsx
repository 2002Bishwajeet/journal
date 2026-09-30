/**
 * react-markdown `pre` override for the share page (#390). A fenced `mermaid`,
 * `svg` or `html` block renders as a preview by default, with a View source
 * toggle for the highlighted code; any other code block renders as a plain <pre>.
 *
 * The preview is built from the code block's text, never from raw HTML in the
 * markdown: the sanitizer has already dropped iframes, scripts and styles.
 */
import { useState, type ComponentProps } from 'react';
import type { Element, ElementContent } from 'hast';
import type { ExtraProps } from 'react-markdown';
import { LiveBlockFrame, LiveBlockToggle } from '@/components/liveBlocks/LiveBlockFrame';
import { liveBlockKind } from '@/lib/liveBlocks';

function textOf(node: ElementContent): string {
  if (node.type === 'text') return node.value;
  if (node.type === 'element') return node.children.map(textOf).join('');
  return '';
}

function liveBlockOf(node: Element | undefined) {
  const code = node?.children.find((c): c is Element => c.type === 'element' && c.tagName === 'code');
  if (!code) return null;
  const classes = code.properties.className;
  const language = Array.isArray(classes)
    ? classes.map(String).find((c) => c.startsWith('language-'))?.slice('language-'.length)
    : undefined;
  const kind = liveBlockKind(language ?? null);
  return kind ? { kind, source: code.children.map(textOf).join('') } : null;
}

export function LiveBlockAwarePre({ node, children, ...rest }: ComponentProps<'pre'> & ExtraProps) {
  const [showSource, setShowSource] = useState(false);
  const live = liveBlockOf(node);
  if (!live) return <pre {...rest}>{children}</pre>;

  return (
    <LiveBlockFrame
      kind={live.kind}
      source={live.source}
      preview={!showSource}
      toggles={
        <LiveBlockToggle pressed={showSource} onClick={() => setShowSource((v) => !v)}>
          View source
        </LiveBlockToggle>
      }
    >
      {showSource && <pre {...rest}>{children}</pre>}
    </LiveBlockFrame>
  );
}
