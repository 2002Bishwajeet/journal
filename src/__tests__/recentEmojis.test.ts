// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { loadRecents, STORAGE_KEY } from '@/hooks/useRecentEmojis';

describe('Recent Emojis - loadRecents', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should return empty array when nothing stored', () => {
    expect(loadRecents()).toEqual([]);
  });

  it('should migrate bare array to versioned format', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['😀', '🎉', '🔥']));
    const result = loadRecents();
    expect(result).toEqual(['😀', '🎉', '🔥']);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored._v).toBe(1);
    expect(stored.items).toEqual(['😀', '🎉', '🔥']);
  });

  it('should load versioned format correctly', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ _v: 1, items: ['👍', '❤️'] }));
    expect(loadRecents()).toEqual(['👍', '❤️']);
  });

  it('should handle corrupted data gracefully', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json');
    expect(loadRecents()).toEqual([]);
  });

  it('should handle versioned format with missing items', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ _v: 1 }));
    expect(loadRecents()).toEqual([]);
  });
});
