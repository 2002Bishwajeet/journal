import { describe, it, expect } from 'vitest';
import { slashCommandItems, filterCommands } from '@/components/editor/plugins/SlashCommands/slashCommandItems';

describe('Slash Command Items', () => {
  it('should include H1-H6 headings', () => {
    const headings = slashCommandItems.filter(item => item.title.startsWith('Heading'));
    expect(headings).toHaveLength(6);
    expect(headings.map(h => h.title)).toEqual([
      'Heading 1', 'Heading 2', 'Heading 3',
      'Heading 4', 'Heading 5', 'Heading 6',
    ]);
  });

  it('should include subscript and superscript', () => {
    const sub = slashCommandItems.find(item => item.title === 'Subscript');
    const sup = slashCommandItems.find(item => item.title === 'Superscript');
    expect(sub).toBeDefined();
    expect(sup).toBeDefined();
    expect(sub!.group).toBe('formatting');
    expect(sup!.group).toBe('formatting');
  });

  it('should include duplicate block', () => {
    const dup = slashCommandItems.find(item => item.title === 'Duplicate Block');
    expect(dup).toBeDefined();
    expect(dup!.group).toBe('formatting');
    expect(dup!.description).toContain('Cmd+Shift+D');
  });

  it('should have both formatting and ai groups', () => {
    const groups = new Set(slashCommandItems.map(item => item.group));
    expect(groups).toContain('formatting');
    expect(groups).toContain('ai');
  });

  it('all items should have required fields', () => {
    for (const item of slashCommandItems) {
      expect(item.title).toBeTruthy();
      expect(item.description).toBeTruthy();
      expect(item.icon).toBeDefined();
      expect(typeof item.command).toBe('function');
    }
  });
});

describe('filterCommands', () => {
  it('should return all items for empty query', () => {
    expect(filterCommands(slashCommandItems, '')).toEqual(slashCommandItems);
    expect(filterCommands(slashCommandItems, '  ')).toEqual(slashCommandItems);
  });

  it('should filter by title', () => {
    const results = filterCommands(slashCommandItems, 'heading');
    expect(results.length).toBeGreaterThanOrEqual(6);
    results.forEach(r => {
      expect(r.title.toLowerCase()).toContain('heading');
    });
  });

  it('should filter by description', () => {
    const results = filterCommands(slashCommandItems, 'checklist');
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Task List');
  });

  it('should be case insensitive', () => {
    const lower = filterCommands(slashCommandItems, 'bullet');
    const upper = filterCommands(slashCommandItems, 'BULLET');
    const mixed = filterCommands(slashCommandItems, 'BuLLeT');
    expect(lower).toEqual(upper);
    expect(upper).toEqual(mixed);
  });

  it('should return empty for non-matching query', () => {
    const results = filterCommands(slashCommandItems, 'zzzznonexistent');
    expect(results).toHaveLength(0);
  });

  it('should match subscript and superscript', () => {
    const results = filterCommands(slashCommandItems, 'script');
    expect(results).toHaveLength(2);
    const titles = results.map(r => r.title);
    expect(titles).toContain('Subscript');
    expect(titles).toContain('Superscript');
  });
});
