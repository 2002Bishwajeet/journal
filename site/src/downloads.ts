// The download page (#305) puts the visitor's own desktop first. The links themselves are plain HTML in
// download.html, so they work without script.

export type DesktopOS = 'mac' | 'windows' | 'linux'

/** The visitor's desktop OS from the user agent, or null on a phone, a tablet or anything unknown. */
export function desktopOS(userAgent: string): DesktopOS | null {
  if (/iPhone|iPad|iPod|Android/i.test(userAgent)) return null
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'mac'
  if (/Windows/i.test(userAgent)) return 'windows'
  if (/Linux|X11/i.test(userAgent)) return 'linux'
  return null
}
