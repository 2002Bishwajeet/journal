import { archNote, cpuArch, desktopOS, type Arch } from './downloads'

// Shows the visitor's OS as the one download and folds the other two under "Other platforms". Without script,
// or on a phone or an unknown agent, the page keeps the plain list of all three.
type UAData = { getHighEntropyValues(hints: string[]): Promise<{ architecture?: string; bitness?: string }> }

async function detectArch(): Promise<Arch | null> {
  // Only Chromium exposes it. Elsewhere the CPU stays unknown rather than guessed.
  const data = (navigator as Navigator & { userAgentData?: UAData }).userAgentData
  return cpuArch((await data?.getHighEntropyValues(['architecture', 'bitness']).catch(() => null)) ?? null)
}

const os = desktopOS(navigator.userAgent)
const list = document.querySelector<HTMLElement>('.dl-list')
const shown = os && list?.querySelector<HTMLElement>(`.dl-item[data-os="${os}"]`)

if (os && list && shown) {
  const rest = document.createElement('ul')
  rest.className = 'dl-list'
  rest.append(...list.querySelectorAll(`.dl-item:not([data-os="${os}"])`))
  const details = document.createElement('details')
  details.className = 'dl-other'
  details.innerHTML = '<summary>Other platforms</summary>'
  details.append(rest)
  list.after(details)
  shown.querySelector('.btn')?.classList.replace('btn-secondary', 'btn-primary')

  void detectArch().then((arch) => {
    const note = archNote(os, arch)
    if (!note) return
    const p = document.createElement('p')
    p.className = 'small'
    p.textContent = note.text
    shown.firstElementChild!.append(p)
    if (note.noBuild) {
      const btn = shown.querySelector<HTMLAnchorElement>('.btn')!
      btn.href = '/welcome'
      btn.textContent = 'Open Journal in the browser'
      btn.classList.replace('btn-primary', 'btn-secondary')
    }
  })
}
