# Edge specs (Cloudflare Pages)

`npm run e2e:edge` runs `e2e/edge/*.spec.ts` against the app as Cloudflare Pages serves it: `public/_headers`, `public/_redirects` and `./functions`, via `wrangler@3.90.0 pages dev dist-e2e` on `http://127.0.0.1:8788` (pinned to the deploy's version). `E2E_EDGE_BASE_URL=https://… npm run e2e:edge` targets a deployed URL instead; then only `request`-based tests run and browser tests skip.

## Writing a Pages Function spec

Use the `request` fixture — no browser needed to check what the edge returns:

```ts
import { test, expect } from '../fixtures';

test('/share serves OG meta to link-preview bots', async ({ request }) => {
  const html = await (await request.get('/share/<id>/<note>', {
    headers: { 'User-Agent': 'Twitterbot/1.0' },
  })).text();
  expect(html).toContain('property="og:title"');
  expect(html).toContain('property="og:description"');
  expect(html).toContain('property="og:image"');
});
```

Assert the other side too: the same URL with a browser UA returns the unchanged SPA shell (`id="root"`, no injected OG tags).

## Functions that fetch Homebase

Take the upstream base URL from an env binding (`--binding HOMEBASE_URL=…` on `wrangler pages dev`), never a hard-coded host. A spec then points it at either:

- a static server replaying a recorded real response (layer 2, same scrubbed-HAR rules as the recorded layer, #202), or
- a real identity (layer 3) — never a hand-written fake response.
