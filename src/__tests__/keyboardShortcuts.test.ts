// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';

function fireKeydown(key: string, modifiers: { metaKey?: boolean; ctrlKey?: boolean } = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    metaKey: modifiers.metaKey ?? false,
    ctrlKey: modifiers.ctrlKey ?? false,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(event);
  return event;
}

type ShortcutHandler = {
  onSearch?: () => void;
  onNewNote?: () => void;
  onSave?: () => void;
  onKeyboardHelp?: () => void;
};

function attachShortcuts(config: ShortcutHandler) {
  const handleKeyDown = (e: KeyboardEvent) => {
    const isMod = e.metaKey || e.ctrlKey;
    if (!isMod) return;

    switch (e.key.toLowerCase()) {
      case 'k': config.onSearch?.(); break;
      case 'n': config.onNewNote?.(); break;
      case 's': config.onSave?.(); break;
      case '/': config.onKeyboardHelp?.(); break;
    }
  };

  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}

describe('Keyboard Shortcuts', () => {
  let cleanup: () => void;

  afterEach(() => {
    cleanup?.();
    vi.restoreAllMocks();
  });

  it('should call onSearch on Cmd+K', () => {
    const onSearch = vi.fn();
    cleanup = attachShortcuts({ onSearch });
    fireKeydown('k', { metaKey: true });
    expect(onSearch).toHaveBeenCalledOnce();
  });

  it('should call onNewNote on Cmd+N', () => {
    const onNewNote = vi.fn();
    cleanup = attachShortcuts({ onNewNote });
    fireKeydown('n', { metaKey: true });
    expect(onNewNote).toHaveBeenCalledOnce();
  });

  it('should call onSave on Cmd+S', () => {
    const onSave = vi.fn();
    cleanup = attachShortcuts({ onSave });
    fireKeydown('s', { metaKey: true });
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('should call onKeyboardHelp on Cmd+/', () => {
    const onKeyboardHelp = vi.fn();
    cleanup = attachShortcuts({ onKeyboardHelp });
    fireKeydown('/', { metaKey: true });
    expect(onKeyboardHelp).toHaveBeenCalledOnce();
  });

  it('should also work with Ctrl modifier', () => {
    const onSearch = vi.fn();
    const onKeyboardHelp = vi.fn();
    cleanup = attachShortcuts({ onSearch, onKeyboardHelp });
    fireKeydown('k', { ctrlKey: true });
    fireKeydown('/', { ctrlKey: true });
    expect(onSearch).toHaveBeenCalledOnce();
    expect(onKeyboardHelp).toHaveBeenCalledOnce();
  });

  it('should not fire without modifier key', () => {
    const onSearch = vi.fn();
    const onSave = vi.fn();
    cleanup = attachShortcuts({ onSearch, onSave });
    fireKeydown('k');
    fireKeydown('s');
    expect(onSearch).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('should not fire for unregistered callbacks', () => {
    const onSearch = vi.fn();
    cleanup = attachShortcuts({ onSearch });
    fireKeydown('n', { metaKey: true });
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('should clean up listener on detach', () => {
    const onSearch = vi.fn();
    cleanup = attachShortcuts({ onSearch });
    cleanup();
    fireKeydown('k', { metaKey: true });
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('should be case insensitive', () => {
    const onSearch = vi.fn();
    cleanup = attachShortcuts({ onSearch });
    fireKeydown('K', { metaKey: true });
    expect(onSearch).toHaveBeenCalledOnce();
  });
});
