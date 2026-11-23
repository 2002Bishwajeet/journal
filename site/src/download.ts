import { applyArchNote, cpuArch, desktopOS, layoutDownloads, type Arch } from './downloads'

// Shows the visitor's OS as the one download and folds the other two under "Other platforms". Without script,
// or on a phone or an unknown agent, the page keeps the plain list of all three.
type UAData = { getHighEntropyValues(hints: string[]): Promise<{ architecture?: string; bitness?: string }> }

async function detectArch(): Promise<Arch | null> {
  // Only Chromium exposes it. Elsewhere the CPU stays unknown rather than guessed.
  const data = (navigator as Navigator & { userAgentData?: UAData }).userAgentData
  return cpuArch((await data?.getHighEntropyValues(['architecture', 'bitness']).catch(() => null)) ?? null)
}

const os = desktopOS(navigator.userAgent)
const shown = layoutDownloads(document, os)

if (os && shown) void detectArch().then((arch) => applyArchNote(shown, os, arch))
