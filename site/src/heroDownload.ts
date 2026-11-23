import { ALL_DOWNLOADS, downloadButton, visitorOS } from './downloads'

// The home page's download buttons (#1473) are a plain "Download" link to the download page in the HTML.
// This names the visitor's platform and links straight to its installer.
const button = downloadButton(visitorOS(navigator.userAgent, navigator.maxTouchPoints))
for (const link of document.querySelectorAll<HTMLAnchorElement>('a[data-download]')) {
  if (!button) {
    // An iPhone or iPad: the App Store badge beside the button is the download.
    if (link.closest('.hero-actions')?.querySelector('.store-badge')) link.hidden = true
    continue
  }
  link.textContent = button.label
  link.href = button.href
  // The "Other platforms" link under the button is only needed once the button goes to one installer.
  if (button !== ALL_DOWNLOADS) link.closest('.hero-actions')?.querySelector('.hero-other')?.removeAttribute('hidden')
}
