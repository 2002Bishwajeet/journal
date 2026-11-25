import type { ConsentDescription } from '@cloudflare/workers-oauth-provider';
import { MAX_IMAGE_BYTES } from '@/lib/images/imageBytes';

// The hosted server's only HTML: the consent page, the image upload page (#1506) and their message pages.
// No images, and script only on the upload page, under a per-response nonce: every string a client or
// agent sent (its name, its redirect URI, a file name) is escaped, and nothing it sent is loaded.

const escape = (text: string) =>
    text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const STYLE = `body{font:16px/1.5 system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1.25rem;color:#1c1b1a;background:#faf9f7}
@media (prefers-color-scheme:dark){body{color:#ecebe8;background:#1c1b1a}input{background:#2a2927;color:inherit}}
h1{font-size:1.35rem;line-height:1.3}p.note{font-size:.9rem;opacity:.8}.warn{border-left:3px solid #c77d00;padding-left:.75rem}
label{display:block;font-weight:600;margin-top:1.25rem}input{width:100%;box-sizing:border-box;font:inherit;padding:.6rem .7rem;margin-top:.35rem;border:1px solid #8886;border-radius:.5rem}
.actions{display:flex;gap:.75rem;margin-top:1.5rem}button{font:inherit;padding:.6rem 1.1rem;border-radius:.5rem;border:1px solid #8886;cursor:pointer;background:transparent;color:inherit}
button.primary{background:#1c1b1a;color:#faf9f7;border-color:#1c1b1a}@media (prefers-color-scheme:dark){button.primary{background:#ecebe8;color:#1c1b1a}}
.drop{display:flex;flex-direction:column;align-items:center;gap:.75rem;padding:2rem 1rem;border:2px dashed #8888;border-radius:.75rem;text-align:center;cursor:pointer}
.drop input{width:auto;border:0;padding:0;background:transparent}`;

// No script or subresource; the form may post here, then be sent on to the user's Homebase identity.
export const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https:; base-uri 'none'";

/** An HTML response, never cached, under `csp`. */
export const html = (body: string, status: number, headers = new Headers(), csp = PAGE_CSP) => {
    headers.set('Content-Type', 'text/html; charset=utf-8');
    headers.set('Cache-Control', 'no-store');
    headers.set('Referrer-Policy', 'no-referrer');
    headers.append('Content-Security-Policy', csp);
    return new Response(body, { status, headers });
};

/** The upload page's: its own script, and fetch back to this server. */
export const uploadPageCsp = (nonce: string) =>
    `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`;

function layout(title: string, body: string): string {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escape(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>`;
}

// Uploads the picked, dropped or pasted image as soon as there is one. One over the limit, or a type the
// server refuses that the browser can decode (HEIC on Safari), is sent as a JPEG at most 2560 px wide.
const UPLOAD_SCRIPT = `const input=document.getElementById('file'),out=document.getElementById('status');
async function fit(file){
if(file.size<=${MAX_IMAGE_BYTES}&&['image/png','image/jpeg','image/webp'].includes(file.type))return file;
const bitmap=await createImageBitmap(file),scale=Math.min(1,2560/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
const blob=await new Promise((done)=>canvas.toBlob(done,'image/jpeg',0.9));
if(!blob)throw new Error('toBlob');
return new File([blob],'image.jpg',{type:'image/jpeg'});
}
async function send(file){
if(!file)return;
out.textContent='Uploading…';
try{
const data=new FormData();data.append('file',await fit(file));
const response=await fetch(location.href,{method:'POST',body:data});
const result=await response.json();
if(response.ok){input.form.remove();out.textContent='Uploaded. Go back to your chat and tell your agent the image is there.';}
else out.textContent=result.error;
}catch{out.textContent='That image could not be read. Try a PNG, JPEG or WebP image.';}
}
input.addEventListener('change',()=>send(input.files[0]));
input.form.addEventListener('submit',(e)=>{e.preventDefault();send(input.files[0]);});
addEventListener('paste',(e)=>send(e.clipboardData&&e.clipboardData.files[0]));
addEventListener('dragover',(e)=>e.preventDefault());
addEventListener('drop',(e)=>{e.preventDefault();send(e.dataTransfer&&e.dataTransfer.files[0]);});`;

/** The page a person opens from an upload URL (#1506) when their agent can't POST the image itself. */
export function uploadPage(filename: string, nonce: string): string {
    return layout(
        'Add an image to Journal',
        `<h1>Add an image to Journal</h1>
<p>Your agent asked for <strong>${escape(filename)}</strong>. Choose, take, drop or paste a photo (PNG, JPEG or WebP). It goes straight to your agent's Journal connection, which can then add it to a note.</p>
<form method="post" enctype="multipart/form-data">
<label class="drop">Choose or take a photo, or drop or paste one here<input id="file" name="file" type="file" accept="image/png,image/jpeg,image/webp" required></label>
<noscript><div class="actions"><button class="primary" type="submit">Upload</button></div></noscript>
</form>
<p id="status" role="status"></p>
<p class="note">This link works once, within 15 minutes of your agent asking.</p>
<script nonce="${nonce}">${UPLOAD_SCRIPT}</script>`
    );
}

/** Who is asking, where the browser goes after, and the identity to sign in with; `problem` with the last one typed. */
export function consentPage(consent: ConsentDescription, handle: string, action: string, problem?: string): string {
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
<p>It will be able to read and edit the Journal notes you give AI agents in Journal → Settings → Agent access. After you approve it on your Homebase identity, you go back to <strong>${escape(consent.redirectHost)}</strong>.</p>${loopback}${problem ? `<p class="warn">${escape(problem)}</p>` : ''}
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
