import { REACT_BLOCK_IMPORTS, REACT_BLOCK_LIBRARIES } from './reactBlockLibraries';

/** Code-block languages that render a live preview in the editor. */
export type LiveBlockKind = 'mermaid' | 'svg' | 'html' | 'react';

const BLOCK_ID_TOKEN = /^id=[a-z0-9]{4,12}$/;

/**
 * A code block's `language` attribute holds the fence's whole info string, so an html
 * block's id rides in it (```html id=k3f9, #410) through export, import and agent edits.
 * This splits it: the language is the first word, the id an `id=<4–12 of a-z0-9>` word,
 * and `wide` a word of its own (```react wide id=k3f9, #557).
 */
export function parseCodeInfo(info: string | null): { language: string | null; id: string | null; wide: boolean } {
  const [language, ...rest] = (info ?? '').trim().split(/\s+/);
  const token = rest.find((word) => BLOCK_ID_TOKEN.test(word));
  return { language: language || null, id: token ? token.slice('id='.length) : null, wide: rest.includes('wide') };
}

/** The info string with `id` in place of any id it had: for a block that saves its state the first time, or a copy of another block (#950). */
export function withBlockId(info: string, id: string): string {
  const [language, ...rest] = info.trim().split(/\s+/);
  return [language, ...rest.filter((word) => !BLOCK_ID_TOKEN.test(word)), `id=${id}`].join(' ');
}

/**
 * The live-preview kind for a code block's language (the info string's first word), or
 * null for an ordinary code block. `jsx` and `tsx` stay ordinary code, so a code sample never runs.
 */
export function liveBlockKind(language: string | null): LiveBlockKind | null {
  const lang = parseCodeInfo(language).language?.toLowerCase();
  return lang === 'mermaid' || lang === 'svg' || lang === 'html' || lang === 'react' ? lang : null;
}

/**
 * Only the signed-in identity can have written the note's live blocks: the note is its own and no
 * one else (an agent, a collaborator) edited it last. A link a block in any other note opens shows
 * where it goes first, and its frame gets an edge (#975).
 */
export function ownerWroteNote(metadata: { authorOdinId?: string; lastEditedBy?: string }, editorOdinId: string | undefined): boolean {
  const shared = !!metadata.authorOdinId && metadata.authorOdinId !== editorOdinId;
  return !shared && (!metadata.lastEditedBy || metadata.lastEditedBy === editorOdinId);
}

/** SVG source as an `<img>`-safe data URI. Loaded as an image, scripts never run. */
export function svgDataUri(source: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
}

/**
 * The only hosts an `html` block may load scripts, styles and fonts from (#409).
 * Each sends `Cross-Origin-Resource-Policy: cross-origin`, which the app's COEP
 * (inherited by the frame) requires of a cross-origin subresource.
 */
export const HTML_BLOCK_CDN_HOSTS = ['https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com', 'https://unpkg.com'];

const CDN = HTML_BLOCK_CDN_HOSTS.join(' ');

// Inline script and style, plus scripts, styles and fonts from the CDN hosts. Nothing else
// is reachable: no connect-src, so script has no network (fetch, XHR, WebSocket), and no
// external images, media or form posts.
const HTML_BLOCK_CSP = `default-src 'none'; script-src 'unsafe-inline' ${CDN}; style-src 'unsafe-inline' ${CDN}; img-src data: blob:; font-src data: ${CDN}; media-src data: blob:; form-action 'none'; base-uri 'none'`;

/**
 * How far a framed (html or react) block's frame reaches past its box on each side, in px.
 * The page inside is padded by as much, so its content sits where the box is, and a focus
 * ring, an outline or a shadow at its edge is not cut off. Anything that reaches further
 * than this (a shadow-xl, say) is still cut at the frame's edge.
 */
export const FRAME_BLEED = 12;

// Everything that crosses between a frame and the app goes over one MessageChannel (#945). The
// window can't carry it: a block can navigate its own frame, and the page that lands there has
// the same window, so `event.source` would still say "the block's frame". The frame makes the
// channel, not the app, because this script is sure to be the page's first code; a port the app
// sent on `load` would go to whatever page is there by then. Only a page that holds `token` is
// given a hearing, and the script leaves the document before the source can read it.
//
// Over the port the frame sends how tall its content is, without the bleed, whenever that changes
// (#412), from the end of parsing as a report at the end of the page would, and again when the frame
// is resized (the user dragged the box); `journal.storage` calls
// (#410), which the app answers by number, deciding everything itself (which block, the limits);
// and a clicked web or mail link, because a sandboxed frame can't open a tab. Only a click the user
// made opens one: the block's own script can click a link too, and the app would open it (#947). A
// link from a block the user may not have written shows its URL before it opens (#975).
// Any other link (an in-page `#anchor`) behaves as before. The app sends a mermaid page the note's look (#946), which
// stays on `journal.look` because it can arrive before the page's own script is parsed. The app
// also says whether the frame shows all of the page (#1045): only when it does not (`clamped`) may
// the page scroll, so a touch on a block that fits scrolls the note, not the frame.
const bridgeScript = (token: string) =>
  '<script>(function () {' +
  'document.currentScript.remove();' +
  'var channel = new MessageChannel(), port = channel.port1, next = 0, waiting = {};' +
  `parent.postMessage({ journalLiveBlock: 1, bridge: '${token}' }, '*', [channel.port2]);` +
  'port.onmessage = function (event) {' +
  'var data = event.data, wait = waiting[data && data.reply];' +
  "if (data && data.journalLiveBlock === 1 && data.look) { journal.look = data.look; dispatchEvent(new Event('journal-look')); return; }" +
  "if (data && data.journalLiveBlock === 1 && 'clamped' in data) { document.documentElement.toggleAttribute('data-journal-scroll', data.clamped === true); return; }" +
  'if (!wait || data.journalLiveBlock !== 1) return;' +
  'delete waiting[data.reply];' +
  'if (data.error !== undefined) wait.reject(new Error(data.error)); else wait.resolve(data.value);' +
  '};' +
  'function ask(storage, key, value) {' +
  'return new Promise(function (resolve, reject) {' +
  'var request = ++next;' +
  'waiting[request] = { resolve: resolve, reject: reject };' +
  'port.postMessage({ journalLiveBlock: 1, storage: storage, request: request, key: key, value: value });' +
  '});' +
  '}' +
  'window.journal = { storage: {' +
  "get: function (key) { return ask('get', key); }," +
  "set: function (key, value) { return ask('set', key, value); }" +
  '} };' +
  `function report() { port.postMessage({ journalLiveBlock: 1, height: Math.ceil(document.documentElement.getBoundingClientRect().height) - ${2 * FRAME_BLEED} }); }` +
  "addEventListener('DOMContentLoaded', function () { new ResizeObserver(report).observe(document.documentElement); });" +
  "addEventListener('resize', report);" +
  "addEventListener('click', function (event) {" +
  "var link = event.target.closest && event.target.closest('a');" +
  // An svg link's `href` is an object, and a mermaid node's link is one.
  'var href = link && (link.href.baseVal || link.href);' +
  'if (!href || !/^(https?|mailto):/i.test(href)) return;' +
  'event.preventDefault();' +
  'if (event.isTrusted) port.postMessage({ journalLiveBlock: 1, link: href });' +
  '});' +
  '})();</script>';

/** The theme tokens an `html` block's frame gets as `:root` variables, under the app's own names. */
export const FRAME_TOKENS = [
  '--background',
  '--foreground',
  '--card',
  '--card-foreground',
  '--popover',
  '--popover-foreground',
  '--muted',
  '--muted-foreground',
  '--border',
  '--input',
  '--accent',
  '--accent-foreground',
  '--secondary',
  '--secondary-foreground',
  '--primary',
  '--primary-foreground',
  '--destructive',
  '--destructive-foreground',
  '--ring',
  '--radius',
  '--chart-1',
  '--chart-2',
  '--chart-3',
  '--chart-4',
  '--chart-5',
] as const;

// Form controls the way the app draws its own (#424): the outline button of
// src/components/ui/button.tsx and the field of src/components/ui/input.tsx. Every
// selector is inside `:where()`, so it has no specificity and any rule of the block wins.
const BUTTONS = 'button,input:is([type=button],[type=submit],[type=reset])';
const FIELDS = 'input:not([type=button],[type=submit],[type=reset],[type=checkbox],[type=radio],[type=range],[type=color],[type=file],[type=image]),select';
const CONTROL_STYLE =
  ':where(button,input,select,textarea){font:inherit}' +
  `:where(${BUTTONS},${FIELDS},textarea){border:1px solid var(--border);border-radius:var(--radius);background:transparent;color:var(--foreground)}` +
  `:where(${BUTTONS}){height:2.25rem;padding:0 1rem;font-size:0.875rem;font-weight:500;cursor:pointer}` +
  `:where(${BUTTONS}):where(:hover:not(:disabled)){background:var(--muted)}` +
  `:where(${FIELDS}){height:2.25rem;padding:0.25rem 0.75rem}` +
  ':where(textarea){padding:0.5rem 0.75rem}' +
  ':where(input,textarea)::placeholder{color:var(--muted-foreground);opacity:1}' +
  // Checkbox, radio, range and progress.
  ':where(input,progress){accent-color:var(--primary)}' +
  ':where(button,input,select,textarea):where(:disabled){opacity:0.5;cursor:not-allowed}' +
  ':where(button,input,select,textarea):where(:focus-visible){outline:2px solid var(--ring);outline-offset:2px}';

/** The look an `html` block's frame takes from the note around it (#420). */
export interface FrameTheme {
  colorScheme: 'light' | 'dark';
  tokens: Record<(typeof FRAME_TOKENS)[number], string>;
  fontFamily: string;
  lineHeight: string;
}

/** The rule of a frame's style that follows the note's theme. */
export function frameRootStyle(theme: FrameTheme): string {
  const tokens = FRAME_TOKENS.map((name) => `${name}:${theme.tokens[name]};`).join('');
  // The font is also a variable, for a react block's `font-sans` (#427), and its shadows
  // are softer in the dark theme (#559).
  return `:root{${tokens}--font-sans:${theme.fontFamily};--shadow-strength:${theme.colorScheme === 'dark' ? 0.6 : 1};color-scheme:${theme.colorScheme}}`;
}

/**
 * The document for an `html` block's sandboxed frame. The CSP meta comes first,
 * so it is in force before anything in the (untrusted) source is parsed. Then
 * one style gives the page the note's look; it comes before the source, so the
 * block's own CSS wins. Then the bridge to the app, so the source can use
 * `journal.storage` as it loads. `bridgeToken` is what the app knows this page by.
 *
 * The page is only see-through while its colour scheme is that of the app
 * around it: a browser paints a frame of the other scheme opaque.
 */
export function buildSrcdoc(source: string, theme: FrameTheme, bridgeToken: string): string {
  const style =
    frameRootStyle(theme) +
    // The bleed is on the root, so a block's own `body` margin or padding still adds to it.
    `html{padding:${FRAME_BLEED}px}` +
    // The page does not scroll by itself (#1045): on iOS a frame whose page can scroll takes the
    // touch, and the note under the finger stops scrolling. Only on the root, so a sticky element
    // keeps the frame as its scroller and a box of the block's own (`overflow-x: auto`) still
    // scrolls. The app lets the page scroll when the frame can't show all of it (the bridge).
    'html{overflow:hidden}' +
    'html[data-journal-scroll]{overflow:auto;overscroll-behavior:contain}' +
    '*,*::before,*::after{box-sizing:border-box}' +
    'html,body{background:transparent}' +
    `body{margin:0;color:var(--foreground);font-family:${theme.fontFamily};line-height:${theme.lineHeight}}` +
    'a{color:inherit}' +
    CONTROL_STYLE +
    // A table like the note's own (`.prose table` in src/index.css).
    'table{border-collapse:collapse}' +
    'th,td{border:1px solid var(--border);padding:0.5rem 0.75rem;text-align:left}' +
    'img{max-width:100%}';
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${HTML_BLOCK_CSP}"><style>${style}</style>${bridgeScript(bridgeToken)}${source}`;
}

// A script's text ends at the first `</script`, and `<!--` can move that end. `\x3C` is `<`
// in a string, a template or a regular expression, the places code can hold either.
const inlineScript = (js: string) => `<script>${js.replace(/<(\/script|!--)/gi, '\\x3C$1')}</script>`;

// Shows every error on the page, so a react block never goes blank: a render error (the error
// boundary below passes it on), a syntax error the compiler let through, a missing App, an
// error in an event handler. Its script runs before anything that can fail. It is laid out
// like the app's error callout, in the theme variables the frame has.
const REACT_ERROR_BOX =
  '<div id="journal-react-error" role="alert" hidden style="margin:1rem;padding:0.5rem 0.75rem;border-left:4px solid var(--muted-foreground);border-radius:var(--radius);background:var(--muted);font-size:0.875rem">' +
  '<div style="font-weight:500">Couldn’t run this component.</div>' +
  '<pre style="margin:0.25rem 0 0;white-space:pre-wrap;font:0.75rem/1.5 ui-monospace,SFMono-Regular,Menlo,monospace"></pre></div>';
const REACT_ERROR_SCRIPT =
  "addEventListener('error', function (event) { var box = document.getElementById('journal-react-error'); box.hidden = false; box.lastChild.textContent = event.error ? String(event.error) : event.message; });";

const REACT_BLOCK_IMPORTS_TEXT = `${REACT_BLOCK_IMPORTS.slice(0, -1).join(', ')} and ${REACT_BLOCK_IMPORTS.at(-1)}`;

/** Hooks a react block can use without the `React.` prefix. */
const BARE_HOOKS = ['useState', 'useEffect', 'useRef', 'useMemo', 'useReducer'];

// Runs the compiled block in a scope of its own (so it may declare the same names as this
// one) and renders the App it defines, or else its default export, inside an error boundary
// that hands a render error to the error box.
const componentScript = (code: string) =>
  '(function () {' +
  `var ${BARE_HOOKS.map((hook) => `${hook} = React.${hook}`).join(', ')};` +
  'var module = { exports: {} }, exports = module.exports;' +
  // The allow-list (#427). Each library is on the page only when the block imports it.
  `var libraries = ${JSON.stringify(REACT_BLOCK_LIBRARIES)};` +
  'function require(name) {' +
  "if (name === 'react') return React;" +
  'if (Object.prototype.hasOwnProperty.call(libraries, name) && window[libraries[name]]) return window[libraries[name]];' +
  `throw new Error(${JSON.stringify(`A react block can import only ${REACT_BLOCK_IMPORTS_TEXT}, not `)} + name + '.'); }` +
  `var App = (function () {\n${code}\n;return typeof App === 'undefined' ? module.exports.default : App;\n})();` +
  "if (App === undefined) throw new Error('Define a component named App, or export one as default.');" +
  'class Boundary extends React.Component {' +
  'state = { failed: false };' +
  'static getDerivedStateFromError() { return { failed: true }; }' +
  "componentDidCatch(error) { dispatchEvent(new ErrorEvent('error', { error: error, message: String(error) })); }" +
  'render() { return this.state.failed ? null : this.props.children; }' +
  '}' +
  "ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Boundary, null, React.createElement(App)));" +
  '})();';

/** What a react block's page is made of, besides its own code; each is built by build/pieces.ts. */
export interface ReactBlockRuntime {
  /** The app's own React: a script that sets window.React and window.ReactDOM (#426). */
  react: string;
  /** The Tailwind stylesheet in Journal's theme (#427). */
  tailwind: string;
  /** The scripts of the libraries the block imports, each setting its global in REACT_BLOCK_LIBRARIES. */
  libraries?: string[];
}

/**
 * The page of a `react` block (#426), for buildSrcdoc to wrap: the Tailwind sheet (right after
 * buildSrcdoc's theme style, before anything the block renders), a root, the runtime and the
 * block's `code`, compiled by compileReactBlock. After the sheet, the block's own Tailwind
 * (#559), if compileBlockTailwind found any. Everything is inline, which the frame's CSP allows.
 */
export function reactBlockDocument(runtime: ReactBlockRuntime, code: string, blockTailwind = ''): string {
  const libraries = (runtime.libraries ?? []).map(inlineScript).join('');
  // A class's arbitrary value can hold `</style`, which would end the style element.
  const blockStyle = blockTailwind && `<style id="journal-block-tailwind">${blockTailwind.replace(/<\/style/gi, '<\\/style')}</style>`;
  return `<style>${runtime.tailwind}</style>${blockStyle}<div id="root"></div>${REACT_ERROR_BOX}${inlineScript(REACT_ERROR_SCRIPT)}${inlineScript(runtime.react)}${libraries}${inlineScript(componentScript(code))}`;
}

// The diagram's place on a mermaid block's page, and the error that takes it when the source
// can't be drawn, laid out like the app's error callout (PreviewError).
const MERMAID_BOX = '<div id="journal-mermaid"><span style="margin:auto">Rendering diagram…</span></div>';
const MERMAID_ERROR_BOX =
  '<div id="journal-mermaid-error" role="alert" hidden style="margin:1rem;padding:0.5rem 0.75rem;border-left:4px solid var(--destructive);border-radius:var(--radius);background:color-mix(in srgb,var(--destructive) 10%,transparent);font-size:0.875rem">' +
  '<div style="font-weight:500">Couldn’t render this diagram. Check its syntax.</div>' +
  // Mermaid points at the failing column with a caret on its own line: keep the line breaks and a fixed pitch.
  '<pre style="margin:0.25rem 0 0;white-space:pre-wrap;word-break:break-word;font:0.75rem/1.5 ui-monospace,SFMono-Regular,Menlo,monospace"></pre></div>';
// Mermaid sizes its svg as width: 100% with an inline max-width of the diagram's natural width,
// which shrinks a wide diagram until it is unreadable. Asking for more width than any column has
// leaves that max-width in charge, so the diagram keeps its natural size: centred when it fits,
// scrolled sideways in its box when it does not. Mermaid draws in a box of its own at the end of
// <body> and copies the result: out of the flow, so the page keeps its height through a redraw.
const MERMAID_STYLE =
  '#journal-mermaid{display:flex;overflow-x:auto;padding:1rem;color:var(--muted-foreground);font-size:0.875rem}' +
  '#journal-mermaid svg[style*="max-width"]{flex:none;width:10000px;margin:0 auto}' +
  '#journal-mermaid::-webkit-scrollbar{height:6px}' +
  '#journal-mermaid::-webkit-scrollbar-thumb{background:var(--border);border-radius:var(--radius)}' +
  'body>[id^="dmermaid-"]{position:absolute;left:0;right:0;visibility:hidden}';

// Draws the diagram on the page in each look the app sends (the bridge script), one drawing at a
// time. Mermaid sizes each node from its measured label, so the label font must be loaded first.
// `classic` is mermaid's flat look: no gradient borders or drop shadows. Each drawing has an id of
// its own: mermaid first takes an element of that id off the page, and the diagram stays until
// its next drawing is ready.
const mermaidScript = (source: string) =>
  '(function () {' +
  "var box = document.getElementById('journal-mermaid'), style = document.getElementById('journal-mermaid-look');" +
  'var drawing = Promise.resolve(), drawn = 0;' +
  'function draw() {' +
  'var look = journal.look;' +
  'if (!look) return;' +
  'style.textContent = look.style;' +
  'drawing = drawing.then(async function () {' +
  "var id = 'mermaid-' + ++drawn, themeVariables = JSON.parse(look.themeVariables);" +
  'try {' +
  "await document.fonts.load('14px ' + themeVariables.fontFamily);" +
  `mermaid.initialize(Object.assign(${JSON.stringify({ startOnLoad: false, securityLevel: 'strict', look: 'classic', theme: 'base' })}, { themeVariables: themeVariables }));` +
  `box.innerHTML = (await mermaid.render(id, ${JSON.stringify(source)})).svg;` +
  '} catch (error) {' +
  // Mermaid leaves its error diagram attached to <body> on a parse failure.
  "var left = document.getElementById('d' + id);" +
  'if (left) left.remove();' +
  "var alert = document.getElementById('journal-mermaid-error');" +
  'box.remove();' +
  'alert.hidden = false;' +
  'alert.lastChild.textContent = (error && error.message) || String(error);' +
  '}' +
  '});' +
  '}' +
  "addEventListener('journal-look', draw);" +
  'draw();' +
  '})();';

/**
 * The page of a `mermaid` block (#946), for buildSrcdoc to wrap. Mermaid runs here and nowhere
 * else, so what it makes of an untrusted source never meets the app's DOM, and its strict mode
 * and DOMPurify are not all that stands between that source and the app's origin. `runtime` is
 * built by build/pieces.ts and sets window.mermaid. The note's look comes over the port, in every
 * theme: the runtime is too big to load the page again for a new one.
 */
export function mermaidBlockDocument(runtime: string, source: string): string {
  return `<style>${MERMAID_STYLE}</style><style id="journal-mermaid-look"></style>${MERMAID_BOX}${MERMAID_ERROR_BOX}${inlineScript(runtime)}${inlineScript(mermaidScript(source))}`;
}

/** The least height a framed (html, react or mermaid) block's box is fitted to. */
export const MIN_FRAME_HEIGHT = 120;
const MAX_FRAME_HEIGHT = 1600;
// A `wide` block (#557) is for a dashboard, a game or a simulation, which need room both ways.
const MAX_WIDE_FRAME_HEIGHT = 2400;

/**
 * The port a frame's bridge script hands over (#945), from a `message` event on the app's
 * window, or null for anything else. `frame` is the block's `iframe.contentWindow`, and
 * `token` what its page was built with: a page that was navigated to has the window but not
 * the token. Everything else a block says comes in on this port, so it needs no other check
 * of who sent it.
 */
export function bridgePortFromMessage(event: Pick<MessageEvent<unknown>, 'source' | 'data' | 'ports'>, frame: Window | null, token: string): MessagePort | null {
  if (!frame || event.source !== frame) return null;
  const data = event.data as { journalLiveBlock?: unknown; bridge?: unknown } | null | undefined;
  if (data?.journalLiveBlock !== 1 || data.bridge !== token) return null;
  return event.ports[0] ?? null;
}

/**
 * The height to give an `html` block, from a message on its port: the height it
 * reported, rounded up so the frame is never a pixel short, and clamped; a `wide`
 * block may be taller. `clamped` when the content is taller than that, so it scrolls
 * inside the frame (#1045). Null for anything else. The frame's source is untrusted
 * and can send any message it likes, so the most a block can do with one is pick its
 * own height within the clamp.
 */
export function frameHeightFromMessage(message: unknown, wide = false): { height: number; clamped: boolean } | null {
  const data = message as { journalLiveBlock?: unknown; height?: unknown } | null | undefined;
  if (data?.journalLiveBlock !== 1 || typeof data.height !== 'number' || !Number.isFinite(data.height)) return null;
  const max = wide ? MAX_WIDE_FRAME_HEIGHT : MAX_FRAME_HEIGHT;
  const height = Math.ceil(data.height);
  return { height: Math.min(Math.max(height, MIN_FRAME_HEIGHT), max), clamped: height > max };
}

/** A `journal.storage` call from a block's frame (#410). `key` and `value` are not checked yet. */
export interface StorageRequest {
  request: number;
  storage: 'get' | 'set';
  key: unknown;
  value?: unknown;
}

/** The storage request in a message on a block's port, or null for anything else. */
export function storageRequestFromMessage(message: unknown): StorageRequest | null {
  const data = message as { journalLiveBlock?: unknown; storage?: unknown; request?: unknown; key?: unknown; value?: unknown } | null | undefined;
  if (data?.journalLiveBlock !== 1 || (data.storage !== 'get' && data.storage !== 'set')) return null;
  if (typeof data.request !== 'number' || !Number.isFinite(data.request)) return null;
  return { request: data.request, storage: data.storage, key: data.key, value: data.value };
}

/**
 * The link a block asks the app to open, from a message on its port, or null for anything
 * else. The source is untrusted, so only http(s) and mailto URLs pass: never a `javascript:`
 * one. The browser still blocks the tab unless the user just clicked.
 */
export function linkFromMessage(message: unknown): string | null {
  const data = message as { journalLiveBlock?: unknown; link?: unknown } | null | undefined;
  if (data?.journalLiveBlock !== 1 || typeof data.link !== 'string') return null;
  try {
    const url = new URL(data.link);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
