// Shared look of the table row and column handles and their menus.

/** A small grip just outside the table edge. Shaded while its menu is open. */
export const TABLE_HANDLE_CLASS =
  'rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground dark:hover:bg-muted data-[state=open]:bg-muted data-[state=open]:text-foreground';

export const TABLE_MENU_CLASS = 'w-auto p-1 flex gap-1 z-9999';

/** A pressed toggle reads as pressed in both themes (bg-muted barely shows on the light popover). */
export const TABLE_TOGGLE_CLASS = 'h-7 w-7 aria-pressed:bg-foreground/10 aria-pressed:text-foreground';

/** The dark --destructive is too dark to read on the popover, so dark mode uses a lighter red. */
export const TABLE_DESTRUCTIVE_CLASS =
  'h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10 dark:text-red-400 dark:hover:text-red-400 dark:hover:bg-red-400/10';
