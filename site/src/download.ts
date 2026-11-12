import { desktopOS } from './downloads'

// Moves the visitor's platform to the top of the list and makes its first link the primary button.
const os = desktopOS(navigator.userAgent)
const item = os && document.querySelector<HTMLElement>(`.dl-item[data-os="${os}"]`)
if (item) {
  item.parentElement!.prepend(item)
  item.querySelector('.btn')?.classList.replace('btn-secondary', 'btn-primary')
}
