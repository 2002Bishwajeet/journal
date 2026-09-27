// Throwaway static HTTPS server for the spike (#240): serves dist/ with SPA fallback
// and the same COOP/COEP headers as public/_headers, using the per-run leaf cert.
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';

const [root, certFile, keyFile, port] = process.argv.slice(2);
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.woff2': 'font/woff2',
  '.data': 'application/octet-stream', '.txt': 'text/plain',
};

https
  .createServer({ cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) }, (req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'https://x').pathname);
    let file = path.resolve(root, '.' + urlPath);
    if (!file.startsWith(path.resolve(root)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.resolve(root, 'index.html');
    }
    res.writeHead(200, {
      'Content-Type': types[path.extname(file)] ?? 'application/octet-stream',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    });
    fs.createReadStream(file).pipe(res);
  })
  .listen(Number(port), () => console.log(`serving ${root} on :${port}`));
