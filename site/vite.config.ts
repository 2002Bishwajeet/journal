import { readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, searchForWorkspaceRoot, type Plugin } from 'vite'
import { headTags, siteFiles } from './seo.ts'

const page = (name: string) => resolve(import.meta.dirname, name)

// Every page shares one head, header and footer: `<!-- head -->`, `<!-- header -->` and `<!-- footer -->` are
// replaced from site/partials, the nav link named by <body data-page> is marked current, and
// a page's `<!-- credit: ... -->` (picture credits) moves into the footer.
const read = (name: string) => readFileSync(page(`partials/${name}.html`), 'utf8')

// Buying the native apps is off until billing production and the app downloads are live: the buy page
// then shows "coming soon" instead of its buy and renew buttons. Turn it on with VITE_BILLING_LIVE=true
// in the build's environment (deploy-cloudflare.yml, or `VITE_BILLING_LIVE=true npm run site:build`).
export const BILLING_LIVE = process.env.VITE_BILLING_LIVE === 'true'
// The download page's installer links stay off ("coming soon") until the first desktop release is out
// (desktop-release.yml). Turn them on with VITE_DOWNLOADS_LIVE=true, like VITE_BILLING_LIVE.
export const DOWNLOADS_LIVE = process.env.VITE_DOWNLOADS_LIVE === 'true'

/** Keeps a page's `<!-- <flag>-live -->…<!-- /<flag>-live -->` parts when the flag is on, its `<flag>-soon` parts when it is off. */
export function flagBlocks(html: string, flag: string, live: boolean): string {
  const drop = live ? `${flag}-soon` : `${flag}-live`
  return html.replace(new RegExp(`<!-- ${drop} -->[\\s\\S]*?<!-- /${drop} -->\\n?`, 'g'), '')
}

export const billingBlocks = (html: string, live: boolean): string => flagBlocks(html, 'billing', live)

function render(html: string): string {
  const current = /<body data-page="(\w+)"/.exec(html)?.[1]
  const credit = /<!-- credit: ([\s\S]*?) -->\n?/.exec(html)
  const out = flagBlocks(billingBlocks(html, BILLING_LIVE), 'downloads', DOWNLOADS_LIVE)
    .replace(credit?.[0] ?? '', '')
    .replace(/<!-- (head|header|footer) -->/g, (_, name) => read(name))
    .replace('<!-- credit -->', credit ? `<p class="wrap credit">${credit[1]}</p>` : '')
    .replaceAll(/ data-nav="(\w+)"/g, (_, nav) => (nav === current ? ' aria-current="page"' : ''))
  // The page's canonical link and structured data close its head (see seo.ts).
  return out.replace('</head>', `${headTags(current ?? 'home', out)}\n</head>`)
}

function partials(): Plugin {
  return {
    name: 'site-partials',
    // 'pre': before Vite reads the page, so the shared head's script and the partials' pictures are bundled.
    transformIndexHtml: { order: 'pre', handler: render },
  }
}

// llms.txt, llms-full.txt, robots.txt and sitemap.xml: written into the build, and served as-is in dev.
function textFiles(): Plugin {
  const files = () => siteFiles(render, import.meta.dirname)
  const types: Record<string, string> = { txt: 'text/plain; charset=utf-8', xml: 'application/xml; charset=utf-8' }
  return {
    name: 'site-text-files',
    generateBundle() {
      for (const [fileName, source] of Object.entries(files())) this.emitFile({ type: 'asset', fileName, source })
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.slice(1).split('?')[0] ?? ''
        const body = files()[name]
        if (body === undefined) return next()
        res.setHeader('Content-Type', types[name.split('.').pop()!])
        res.end(body)
      })
    },
  }
}

// The billing Worker (#300) the buy page talks to once BILLING_LIVE is on. Dodo test mode everywhere
// except a build with `--mode live`, which the production deploy uses (deploy-cloudflare.yml).
const BILLING_URL = { test: 'https://journal-billing-test.cloudx.run', live: 'https://journal-billing.cloudx.run' }

// The landing site: static pages of their own, built to site/dist for Cloudflare Pages.
// It shares the app's installed packages but none of its code or config. The app is the root of
// the origin, so the site is served under /landing/; functions/index.ts serves its home page at /
// to a visitor who is not signed in (#913).
export default defineConfig(({ mode }) => ({
  root: import.meta.dirname,
  base: '/landing/',
  plugins: [partials(), textFiles()],
  define: { __BILLING_URL__: JSON.stringify(mode === 'live' ? BILLING_URL.live : BILLING_URL.test) },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: { index: page('index.html'), agents: page('agents.html'), pricing: page('pricing.html'), buy: page('buy.html'), download: page('download.html'), contact: page('contact.html') },
    },
    // Mermaid's diagram chunks (elk is the largest) load only when the playground is used.
    chunkSizeWarningLimit: 1600,
  },
  server: {
    host: '127.0.0.1', port: 5180, strictPort: true,
    // A worktree's node_modules can be a symlink to another checkout; let the dev server read through it.
    fs: { allow: [searchForWorkspaceRoot(import.meta.dirname), realpathSync(resolve(import.meta.dirname, '../node_modules'))] },
  },
  preview: { host: '127.0.0.1', port: 5181, strictPort: true },
}))
