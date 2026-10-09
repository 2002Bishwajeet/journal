// Copies brand tokens/logos and font/GSAP runtime files into this project so the
// HyperFrames server (which only serves video/) can reach them. Outputs are gitignored.
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const copy = (from, to) => cpSync(join(root, from), join(root, to), { recursive: true })

for (const dir of ['brand', 'vendor']) rmSync(join(root, dir), { recursive: true, force: true })
mkdirSync(join(root, 'vendor'))

copy('../brand/tokens.css', 'brand/tokens.css')
copy('../brand/logo', 'brand/logo')
copy('node_modules/gsap/dist/gsap.min.js', 'vendor/gsap.min.js')
copy('node_modules/@fontsource-variable/inter', 'vendor/inter')
copy('node_modules/@fontsource-variable/playfair-display', 'vendor/playfair-display')
