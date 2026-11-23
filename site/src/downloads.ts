// The download page (#305) puts the visitor's own desktop first, and the home page's download button (#1473) fits
// the visitor's device. The links themselves are plain HTML, so they work without script.

export type DesktopOS = 'mac' | 'windows' | 'linux'
export type VisitorOS = DesktopOS | 'ios' | 'android'

/**
 * The visitor's OS from the user agent, or null when unknown. iPadOS Safari reports itself as a Macintosh,
 * so a Mac with a touch screen is an iPad.
 */
export function visitorOS(userAgent: string, maxTouchPoints = 0): VisitorOS | null {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios'
  if (/Android/i.test(userAgent)) return 'android'
  if (/Macintosh|Mac OS X/i.test(userAgent)) return maxTouchPoints > 1 ? 'ios' : 'mac'
  if (/Windows/i.test(userAgent)) return 'windows'
  if (/Linux|X11/i.test(userAgent)) return 'linux'
  return null
}

/** The visitor's desktop OS from the user agent, or null on a phone, a tablet or anything unknown. */
export function desktopOS(userAgent: string, maxTouchPoints = 0): DesktopOS | null {
  const os = visitorOS(userAgent, maxTouchPoints)
  return os === 'ios' || os === 'android' ? null : os
}

const RELEASE = 'https://github.com/2002Bishwajeet/journal/releases/latest/download/'
const INSTALLERS: Record<DesktopOS, { label: string; href: string }> = {
  mac: { label: 'Download for Mac', href: `${RELEASE}Journal-darwin-universal.dmg` },
  windows: { label: 'Download for Windows', href: `${RELEASE}Journal-windows-x64-setup.exe` },
  linux: { label: 'Download for Linux', href: `${RELEASE}Journal-linux-amd64.AppImage` },
}
export const ALL_DOWNLOADS = { label: 'All downloads', href: '/landing/download' }

/**
 * The label and link of the home page's download button for a visitor. An iPhone or iPad gets the App Store
 * badge instead (null: no installer button). Android and anything unknown get the download page.
 */
export function downloadButton(os: VisitorOS | null): { label: string; href: string } | null {
  if (os === 'ios') return null
  return os === 'mac' || os === 'windows' || os === 'linux' ? INSTALLERS[os] : ALL_DOWNLOADS
}

export type Arch = 'x64' | 'arm'

/** The CPU from userAgentData's high-entropy values, or null when not exposed (Safari, Firefox) or not x64 or ARM. */
export function cpuArch(values: { architecture?: string; bitness?: string } | null): Arch | null {
  if (values?.architecture === 'arm') return 'arm'
  return values?.architecture === 'x86' && values.bitness === '64' ? 'x64' : null
}

/**
 * A short note under the shown card for a CPU that needs one. A Mac needs no check, its build is universal.
 * Windows on ARM runs the x64 installer under emulation. Linux on ARM has no build yet, so `noBuild` is set.
 */
export function archNote(os: DesktopOS, arch: Arch | null): { text: string; noBuild?: true } | null {
  if (arch !== 'arm') return null
  if (os === 'windows') return { text: "Your PC has an ARM processor. The x64 installer runs under Windows' x64 emulation." }
  if (os === 'linux') return { text: 'There is no ARM build for Linux yet. Journal in the browser works on any computer.', noBuild: true }
  return null
}
