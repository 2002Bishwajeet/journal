/**
 * plain_text_content is prose first, then code-block / live-block text after this
 * separator. The note list takes LEFT(…, 150), so it starts with prose; search still
 * matches the code. Display surfaces call `proseOnly` so code never shows as preview.
 */
export const CODE_SEPARATOR = '\u001F';

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

export function joinPreviewText(prose: string, code: string): string {
  const p = collapse(prose);
  const c = collapse(code);
  return c ? `${p}${CODE_SEPARATOR}${c}` : p;
}

export function proseOnly(text: string): string {
  const i = text.indexOf(CODE_SEPARATOR);
  return (i === -1 ? text : text.slice(0, i)).trim();
}
