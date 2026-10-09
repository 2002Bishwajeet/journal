# Journal video

Launch videos built with [HyperFrames](https://hyperframes.heygen.com): HTML/CSS + a paused GSAP
timeline, rendered to MP4 in headless Chrome. Self-contained: own `package.json`, not part of the
app build.

`npm run sync` copies `../brand/tokens.css`, `../brand/logo/*.svg`, GSAP and the Inter / Playfair
Display fonts into `brand/` and `vendor/` (gitignored), because the HyperFrames server only serves
this folder. Every script below runs it first.

```bash
npm install
npm run dev                 # Studio preview on http://localhost:5174
npm run check               # lint, runtime, layout, motion, contrast
npm run render:logo-sting   # renders/logo-sting.mp4 (1920x1080, 30fps, 5s)
```

Snapshots for review: `npx hyperframes snapshot . --at 1,2.4,4.9` (writes `snapshots/`).

## Compositions

- `index.html`: logo sting. The quill inks in, "Journal" writes on, then "Private by design."

## Coming later

The full launch videos ("What Journal is", "Agents build artifacts in your notes", "Private by
design") wait for issues #556, #560, #561 and MCP 1.5.0. Add each as `compositions/<name>.html`
and render it with `hyperframes render . -c compositions/<name>.html -o renders/<name>.mp4`.
