import type { ConsentDescription } from '@cloudflare/workers-oauth-provider';

// The hosted server's only HTML: the consent page and its error pages. No script, no images: every
// string a client sent (its name, its redirect URI) is escaped, and nothing it sent is loaded.

const escape = (text: string) =>
    text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const STYLE = `body{font:16px/1.5 system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1.25rem;color:#1c1b1a;background:#faf9f7}
@media (prefers-color-scheme:dark){body{color:#ecebe8;background:#1c1b1a}input{background:#2a2927;color:inherit}}
h1{font-size:1.35rem;line-height:1.3}p.note{font-size:.9rem;opacity:.8}.warn{border-left:3px solid #c77d00;padding-left:.75rem}
label{display:block;font-weight:600;margin-top:1.25rem}input{width:100%;box-sizing:border-box;font:inherit;padding:.6rem .7rem;margin-top:.35rem;border:1px solid #8886;border-radius:.5rem}
.actions{display:flex;gap:.75rem;margin-top:1.5rem}button{font:inherit;padding:.6rem 1.1rem;border-radius:.5rem;border:1px solid #8886;cursor:pointer;background:transparent;color:inherit}
button.primary{background:#1c1b1a;color:#faf9f7;border-color:#1c1b1a}@media (prefers-color-scheme:dark){button.primary{background:#ecebe8;color:#1c1b1a}}`;

// No script or subresource; the form may post here, then be sent on to the user's Homebase identity.
export const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https:; base-uri 'none'";

function layout(title: string, body: string): string {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escape(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>`;
}

/** Who is asking, where the browser goes after, and the identity to sign in with. */
export function consentPage(consent: ConsentDescription, handle: string, action: string): string {
    const name = escape(consent.clientName);
    const origin = consent.clientDomain
        ? `<p>${name} is the app at <strong>${escape(consent.clientDomain)}</strong>.</p>`
        : `<p class="note">The app gave this name itself; Journal can't check it.</p>`;
    const loopback = consent.redirectIsLoopback
        ? `<p class="warn">This app runs on your own computer. Only go on if you just connected Journal from an app you trust there.</p>`
        : '';
    return layout(
        `Connect ${consent.clientName} to Journal`,
        `<h1>Connect ${name} to Journal?</h1>${origin}
<p>It will be able to read and edit the Journal notes you give AI agents in Journal → Settings → Agent access. After you approve it on your Homebase identity, you go back to <strong>${escape(consent.redirectHost)}</strong>.</p>${loopback}
<form method="post" action="${escape(action)}">
<input type="hidden" name="handle" value="${escape(handle)}">
<label for="identity">Your Homebase identity</label>
<input id="identity" name="identity" type="text" inputmode="url" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="you.dotyou.cloud" required>
<div class="actions"><button class="primary" type="submit" name="action" value="approve">Continue</button><button type="submit" name="action" value="deny" formnovalidate>Cancel</button></div>
</form>`
    );
}

export function messagePage(title: string, message: string): string {
    return layout(title, `<h1>${escape(title)}</h1><p>${escape(message)}</p>`);
}
