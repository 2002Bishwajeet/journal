// What the site tells search engines and language models, built from the pages themselves so it stays in sync:
// a canonical link and JSON-LD in each page's head, plus llms.txt, llms-full.txt, robots.txt and sitemap.xml.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// The site's public origin: the landing page is the root of journal.cloudx.run (the app lives at /app). SITE_URL overrides it.
export const SITE_URL = (process.env.SITE_URL ?? 'https://journal.cloudx.run').replace(/\/$/, '')
const APP_URL = 'https://journal.cloudx.run/app/'
const GITHUB = 'https://github.com/2002Bishwajeet/journal'

export const PAGES = [
  { id: 'home', file: 'index.html', path: '/', name: 'Home' },
  { id: 'agents', file: 'agents.html', path: '/agents', name: 'Agents' },
  { id: 'pricing', file: 'pricing.html', path: '/pricing', name: 'Pricing' },
] as const

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' }
const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e: string) => ENTITIES[e])
const plain = (html: string) => decode(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
const absolute = (href: string) => (href.startsWith('/') ? SITE_URL + href : href)
const meta = (html: string, name: string) => decode(new RegExp(`<meta name="${name}" content="([^"]*)"`).exec(html)?.[1] ?? '')

function faq(html: string) {
  return [...html.matchAll(/<details class="faq-item"[^>]*>\s*<summary><span>([\s\S]*?)<\/span>[\s\S]*?<\/summary>\s*<p>([\s\S]*?)<\/p>/g)].map(
    ([, q, a]) => ({ '@type': 'Question', name: plain(q), acceptedAnswer: { '@type': 'Answer', text: plain(a) } }),
  )
}

/** The canonical link, og:url and JSON-LD for one page, to go at the end of its head. */
export function headTags(id: string, html: string): string {
  const p = PAGES.find((x) => x.id === id)!
  const url = SITE_URL + p.path
  const data: object[] = []
  if (id === 'home') {
    data.push({
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: 'Journal',
      url: APP_URL,
      description: meta(html, 'description'),
      applicationCategory: 'ProductivityApplication',
      operatingSystem: 'Any, in a web browser',
      isAccessibleForFree: true,
      license: `${GITHUB}/blob/main/LICENSE`,
      sameAs: [GITHUB],
    })
  } else {
    data.push({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL + '/' },
        { '@type': 'ListItem', position: 2, name: p.name, item: url },
      ],
    })
  }
  const questions = faq(html)
  if (questions.length) data.push({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: questions })
  const json = data.map((d) => `<script type="application/ld+json">${JSON.stringify(d).replace(/</g, '\\u003c')}</script>`)
  return [`<link rel="canonical" href="${url}" />`, `<meta property="og:url" content="${url}" />`, ...json].join('\n')
}

/** A page's <main> as markdown-ish plain text: headings, lists, links, code and picture descriptions. */
function toText(html: string): string {
  const main = /<main[^>]*>([\s\S]*?)<\/main>/.exec(html)?.[1] ?? ''
  const blocks: string[] = []
  const keep = (s: string) => `\uE000${blocks.push(s) - 1}\uE000`
  return main
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(svg|button|script)\b[\s\S]*?<\/\1>/g, '')
    .replace(/<picture class="only-dark">[\s\S]*?<\/picture>/g, '')
    .replace(/<video[^>]*only-dark[\s\S]*?<\/video>/g, '')
    .replace(/<img[^>]*only-dark[^>]*>/g, '')
    .replace(/<p[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/p>/g, '') // decorative demos
    .replace(/<span[^>]*>/g, ' ')
    .replace(/<video[^>]*aria-label="([^"]*)"[\s\S]*?<\/video>/g, (_, a: string) => `\n[Video: ${a}]\n`)
    .replace(/<img[^>]*alt="([^"]*)"[^>]*>/g, (_, a: string) => (a ? `\n[Image: ${a}]\n` : ''))
    .replace(/<pre([^>]*)>([\s\S]*?)<\/pre>/g, (_, attrs: string, code: string) => {
      const label = /aria-label="([^"]*)"/.exec(attrs)?.[1]
      return keep(`\n${label ? label + ':\n' : ''}\`\`\`\n${decode(code.replace(/<[^>]+>/g, ''))}\n\`\`\`\n`)
    })
    .replace(/<textarea[^>]*>([\s\S]*?)<\/textarea>/g, (_, code: string) => keep(`\n\`\`\`mermaid\n${decode(code)}\n\`\`\`\n`))
    .replace(/<h([1-4])[^>]*>/g, (_, n: string) => `\n\n${'#'.repeat(Number(n))} `)
    .replace(/<\/h[1-4]>/g, '\n\n')
    .replace(/<summary[^>]*>/g, '\n\n### ')
    .replace(/<\/summary>/g, '\n')
    .replace(/<(li|dt)[^>]*>/g, '\n- ')
    .replace(/<dd[^>]*>/g, ': ')
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/g, '`$1`')
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/g, '**$1** ')
    .replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, (_, href: string, text: string) => `[${text}](${absolute(href)})`)
    .replace(/<\/?(p|div|section|figure|figcaption|blockquote|ol|ul|dl|details|br)\b[^>]*>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map((line) => decode(line).replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/^- *\n+(?=#)/gm, '') // a list item that holds a heading needs no bullet
    .replace(/^- *\n+/gm, '- ') // a list item that holds a block keeps its bullet on the first line
    .replace(/\uE000(\d+)\uE000/g, (_, i: string) => blocks[Number(i)])
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** The site's generated text files, from the pages as built (partials already in place). */
export function siteFiles(render: (html: string) => string, root: string): Record<string, string> {
  const pages = PAGES.map((p) => ({ ...p, html: render(readFileSync(resolve(root, p.file), 'utf8')) }))
  const full = pages.map((p) => {
    const title = plain(/<title>([\s\S]*?)<\/title>/.exec(p.html)?.[1] ?? p.name)
    return `# ${title}\n\nURL: ${SITE_URL}${p.path}\n\n${toText(p.html).replace(/^# .*\n+/, '')}`
  })
  const crawlers = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'anthropic-ai', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended', 'CCBot']
  return {
    'llms.txt': readFileSync(resolve(root, 'llms.txt'), 'utf8').replaceAll('{{SITE}}', SITE_URL),
    'llms-full.txt': `# Journal: the full text of ${SITE_URL}\n\n> Every page of the Journal site as plain text. The short index is ${SITE_URL}/llms.txt.\n\n${full.join('\n\n---\n\n')}\n`,
    'robots.txt': ['# Everyone is welcome, AI crawlers included.', 'User-agent: *', 'Allow: /', '', ...crawlers.flatMap((c) => [`User-agent: ${c}`, 'Allow: /', '']), `Sitemap: ${SITE_URL}/sitemap.xml`, ''].join('\n'),
    'sitemap.xml': `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${PAGES.map((p) => `  <url><loc>${SITE_URL}${p.path}</loc></url>`).join('\n')}\n</urlset>\n`,
  }
}
