import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

const page = (name: string) => resolve(import.meta.dirname, name)

// Every page shares one head, header and footer: `<!-- head -->`, `<!-- header -->` and `<!-- footer -->` are
// replaced from site/partials, the nav link named by <body data-page> is marked current, and
// a page's `<!-- credit: ... -->` (picture credits) moves into the footer.
function partials(): Plugin {
  const read = (name: string) => readFileSync(page(`partials/${name}.html`), 'utf8')
  return {
    name: 'site-partials',
    // 'pre': before Vite reads the page, so the shared head's script and the partials' pictures are bundled.
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const current = /<body data-page="(\w+)"/.exec(html)?.[1]
        const credit = /<!-- credit: ([\s\S]*?) -->\n?/.exec(html)
        const out = html
          .replace(credit?.[0] ?? '', '')
          .replace(/<!-- (head|header|footer) -->/g, (_, name) => read(name))
          .replace('<!-- credit -->', credit ? `<p class="wrap credit">${credit[1]}</p>` : '')
        return out.replaceAll(/ data-nav="(\w+)"/g, (_, nav) => (nav === current ? ' aria-current="page"' : ''))
      },
    },
  }
}

// The landing site: static pages of their own, built to site/dist for Cloudflare Pages.
// It shares the app's installed packages but none of its code or config.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [partials()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: { index: page('index.html'), agents: page('agents.html'), pricing: page('pricing.html') },
    },
    // Mermaid's diagram chunks (elk is the largest) load only when the playground is used.
    chunkSizeWarningLimit: 1600,
  },
  server: { host: '127.0.0.1', port: 5180, strictPort: true },
  preview: { host: '127.0.0.1', port: 5181, strictPort: true },
})
