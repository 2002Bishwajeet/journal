import { useSyncExternalStore } from "react";

// A focused text field means the on-screen keyboard is up on a phone; focus is
// the one signal that works whether the browser resizes the layout or not.
function subscribe(onChange: () => void) {
  document.addEventListener("focusin", onChange);
  document.addEventListener("focusout", onChange);
  return () => {
    document.removeEventListener("focusin", onChange);
    document.removeEventListener("focusout", onChange);
  };
}

export function isTextField(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement || (el as HTMLElement).isContentEditable) return true;
  return (
    el instanceof HTMLInputElement &&
    !["button", "checkbox", "radio", "range", "submit", "reset", "file", "color"].includes(el.type)
  );
}

/** True while a text input, textarea or contenteditable has focus. */
export function useTextFieldFocused(): boolean {
  return useSyncExternalStore(subscribe, () => isTextField(document.activeElement), () => false);
}
