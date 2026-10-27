import { readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, searchForWorkspaceRoot, type Plugin } from 'vite'
import { headTags, SITE_URL, siteFiles } from './seo.ts'

const page = (name: string) => resolve(import.meta.dirname, name)

// Every page shares one head, header and footer: `<!-- head -->`, `<!-- header -->` and `<!-- footer -->` are
// replaced from site/partials, the nav link named by <body data-page> is marked current, and
// a page's `<!-- credit: ... -->` (picture credits) moves into the footer.
const read = (name: string) => readFileSync(page(`partials/${name}.html`), 'utf8')
function render(html: string): string {
  const current = /<body data-page="(\w+)"/.exec(html)?.[1]
  const credit = /<!-- credit: ([\s\S]*?) -->\n?/.exec(html)
  const out = html
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
    buildStart() {
      if (!process.env.SITE_URL) this.warn(`SITE_URL is not set; canonical links, the sitemap and llms.txt point at ${SITE_URL}.`)
    },
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

// The landing site: static pages of their own, built to site/dist for Cloudflare Pages.
// It shares the app's installed packages but none of its code or config.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [partials(), textFiles()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: { index: page('index.html'), agents: page('agents.html'), pricing: page('pricing.html') },
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
})
