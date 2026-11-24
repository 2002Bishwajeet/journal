import { cpuArch, desktopOS, layoutDownloads, showArch, type Arch } from './downloads'

// Shows the visitor's OS as the one download and folds the others under "Other platforms". Without script,
// or on a phone or an unknown agent, the page keeps the plain list of all of them.
type UAData = { getHighEntropyValues(hints: string[]): Promise<{ architecture?: string; bitness?: string }> }

async function detectArch(): Promise<Arch | null> {
  // Only Chromium exposes it. Elsewhere the CPU stays unknown rather than guessed.
  const data = (navigator as Navigator & { userAgentData?: UAData }).userAgentData
  return cpuArch((await data?.getHighEntropyValues(['architecture', 'bitness']).catch(() => null)) ?? null, navigator.userAgent)
}

// The page holds its first paint for this layout (blocking="render" in Chromium, see vite.config.ts), so the
// cards never jump to one. The CPU comes a moment later; only an ARM visitor's card changes then, to the ARM64 build.
const shown = layoutDownloads(document, desktopOS(navigator.userAgent))
if (shown) void detectArch().then((arch) => showArch(shown, arch))
