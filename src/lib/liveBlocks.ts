/** Code-block languages that render a live preview in the editor. */
export type LiveBlockKind = 'mermaid' | 'svg' | 'html' | 'react';

const BLOCK_ID_TOKEN = /^id=[a-z0-9]{4,12}$/;

/**
 * A code block's `language` attribute holds the fence's whole info string, so an html
 * block's id rides in it (```html id=k3f9, #410) through export, import and agent edits.
 * This splits it: the language is the first word, the id an `id=<4–12 of a-z0-9>` word.
 */
export function parseCodeInfo(info: string | null): { language: string | null; id: string | null } {
  const [language, ...rest] = (info ?? '').trim().split(/\s+/);
  const token = rest.find((word) => BLOCK_ID_TOKEN.test(word));
  return { language: language || null, id: token ? token.slice('id='.length) : null };
}

/** The info string with an id added, for a block that saves its state the first time. */
export function withBlockId(info: string, id: string): string {
  return `${info.trim()} id=${id}`;
}

/**
 * The live-preview kind for a code block's language (the info string's first word), or
 * null for an ordinary code block. `jsx` and `tsx` stay ordinary code, so a code sample never runs.
 */
export function liveBlockKind(language: string | null): LiveBlockKind | null {
  const lang = parseCodeInfo(language).language?.toLowerCase();
  return lang === 'mermaid' || lang === 'svg' || lang === 'html' || lang === 'react' ? lang : null;
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

// What a frame tells the app unasked: how tall its document is, whenever that changes (#412).
const HEIGHT_REPORT_SCRIPT =
  "<script>new ResizeObserver(() => parent.postMessage({ journalLiveBlock: 1, height: Math.ceil(document.documentElement.getBoundingClientRect().height) }, '*')).observe(document.documentElement)</script>";

// `journal.storage` (#410): get and set ask the app for this block's saved state over the
// same bridge, and the app answers each request by its number. The app decides everything
// (which block, the limits); the frame only matches replies to its own requests. It comes
// before the source, so the source can use it as it loads.
const STORAGE_SCRIPT =
  '<script>(function () {' +
  'var next = 0, waiting = {};' +
  "addEventListener('message', function (event) {" +
  'var data = event.data, wait = waiting[data && data.reply];' +
  'if (!wait || event.source !== parent || data.journalLiveBlock !== 1) return;' +
  'delete waiting[data.reply];' +
  'if (data.error !== undefined) wait.reject(new Error(data.error)); else wait.resolve(data.value);' +
  '});' +
  'function ask(storage, key, value) {' +
  'return new Promise(function (resolve, reject) {' +
  'var request = ++next;' +
  'waiting[request] = { resolve: resolve, reject: reject };' +
  "parent.postMessage({ journalLiveBlock: 1, storage: storage, request: request, key: key, value: value }, '*');" +
  '});' +
  '}' +
  'window.journal = { storage: {' +
  "get: function (key) { return ask('get', key); }," +
  "set: function (key, value) { return ask('set', key, value); }" +
  '} };' +
  '})();</script>';

/** The theme tokens an `html` block's frame gets as `:root` variables, under the app's own names. */
export const FRAME_TOKENS = [
  '--background',
  '--foreground',
  '--muted',
  '--muted-foreground',
  '--border',
  '--accent',
  '--secondary',
  '--primary',
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

/**
 * The document for an `html` block's sandboxed frame. The CSP meta comes first,
 * so it is in force before anything in the (untrusted) source is parsed. Then
 * one style gives the page the note's look; it comes before the source, so the
 * block's own CSS wins. Then `journal.storage`, so the source can use it as it
 * loads. The height report comes last.
 *
 * The page is only see-through while its colour scheme is that of the app
 * around it: a browser paints a frame of the other scheme opaque.
 */
export function buildSrcdoc(source: string, theme: FrameTheme): string {
  const tokens = FRAME_TOKENS.map((name) => `${name}:${theme.tokens[name]};`).join('');
  const style =
    `:root{${tokens}color-scheme:${theme.colorScheme}}` +
    '*,*::before,*::after{box-sizing:border-box}' +
    'html,body{background:transparent}' +
    `body{margin:0;color:var(--foreground);font-family:${theme.fontFamily};line-height:${theme.lineHeight}}` +
    'a{color:inherit}' +
    CONTROL_STYLE +
    // A table like the note's own (`.prose table` in src/index.css).
    'table{border-collapse:collapse}' +
    'th,td{border:1px solid var(--border);padding:0.5rem 0.75rem;text-align:left}' +
    'img{max-width:100%}';
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${HTML_BLOCK_CSP}"><style>${style}</style>${STORAGE_SCRIPT}${source}${HEIGHT_REPORT_SCRIPT}`;
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

/** Hooks a react block can use without the `React.` prefix. */
const BARE_HOOKS = ['useState', 'useEffect', 'useRef', 'useMemo', 'useReducer'];

// Runs the compiled block in a scope of its own (so it may declare the same names as this
// one) and renders the App it defines, or else its default export, inside an error boundary
// that hands a render error to the error box.
const componentScript = (code: string) =>
  '(function () {' +
  `var ${BARE_HOOKS.map((hook) => `${hook} = React.${hook}`).join(', ')};` +
  'var module = { exports: {} }, exports = module.exports;' +
  "function require(name) { if (name === 'react') return React; throw new Error('A react block can import only react, not ' + name + '.'); }" +
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

/**
 * The page of a `react` block (#426), for buildSrcdoc to wrap: a root, the app's own React
 * (`runtime`, a script that sets window.React and window.ReactDOM) and the block's `code`,
 * compiled by compileReactBlock. Every script is inline, which the frame's CSP allows.
 */
export function reactBlockDocument(runtime: string, code: string): string {
  return `<div id="root"></div>${REACT_ERROR_BOX}${inlineScript(REACT_ERROR_SCRIPT)}${inlineScript(runtime)}${inlineScript(componentScript(code))}`;
}

/** The least height a framed (html or react) block's box is fitted to. */
export const MIN_FRAME_HEIGHT = 120;
const MAX_FRAME_HEIGHT = 1600;

/**
 * The height to give an `html` block, from a `message` event: the height its
 * own frame reported, clamped (taller content scrolls inside the frame). Null
 * for anything else. `frame` is the block's `iframe.contentWindow`. The frame's
 * source is untrusted and can post any message it likes, so the most a block
 * can do with one is pick its own height within the clamp.
 */
export function frameHeightFromMessage(event: Pick<MessageEvent<unknown>, 'source' | 'data'>, frame: Window | null): number | null {
  if (!frame || event.source !== frame) return null;
  const data = event.data as { journalLiveBlock?: unknown; height?: unknown } | null | undefined;
  if (data?.journalLiveBlock !== 1 || typeof data.height !== 'number' || !Number.isFinite(data.height)) return null;
  return Math.min(Math.max(data.height, MIN_FRAME_HEIGHT), MAX_FRAME_HEIGHT);
}

/** A `journal.storage` call from a block's frame (#410). `key` and `value` are not checked yet. */
export interface StorageRequest {
  request: number;
  storage: 'get' | 'set';
  key: unknown;
  value?: unknown;
}

/**
 * The storage request in a `message` event, or null for anything else. As with
 * frameHeightFromMessage, the block is known by `frame` (its `iframe.contentWindow`)
 * alone: a message from any other window is no request of this block's, and gets no reply.
 */
export function storageRequestFromMessage(event: Pick<MessageEvent<unknown>, 'source' | 'data'>, frame: Window | null): StorageRequest | null {
  if (!frame || event.source !== frame) return null;
  const data = event.data as { journalLiveBlock?: unknown; storage?: unknown; request?: unknown; key?: unknown; value?: unknown } | null | undefined;
  if (data?.journalLiveBlock !== 1 || (data.storage !== 'get' && data.storage !== 'set')) return null;
  if (typeof data.request !== 'number' || !Number.isFinite(data.request)) return null;
  return { request: data.request, storage: data.storage, key: data.key, value: data.value };
}
