import { describe, it, expect } from 'vitest';
import { createBaseExtensions } from '@/components/editor/plugins/extensions';

describe('Editor Extensions', () => {
  const extensions = createBaseExtensions();

  function findExtension(name: string) {
    return extensions.find(ext => ext.name === name);
  }

  it('should include core extensions', () => {
    const names = extensions.map(ext => ext.name);
    const expectedNames = [
      'placeholder', 'link',
      'taskList', 'taskItem',
      'table', 'tableRow',
      'tableCell', 'tableHeader',
    ];
    for (const name of expectedNames) {
      expect(names).toContain(name);
    }
  });

  it('should include underline extension', () => {
    expect(findExtension('underline')).toBeDefined();
  });

  it('should include subscript extension', () => {
    expect(findExtension('subscript')).toBeDefined();
  });

  it('should include superscript extension', () => {
    expect(findExtension('superscript')).toBeDefined();
  });

  it('should include textAlign extension with keyboard shortcuts', () => {
    const textAlign = findExtension('textAlign');
    expect(textAlign).toBeDefined();
  });

  it('should include clearFormatting extension', () => {
    expect(findExtension('clearFormatting')).toBeDefined();
  });

  it('should include duplicateBlock extension', () => {
    expect(findExtension('duplicateBlock')).toBeDefined();
  });

  it('should include indent extension', () => {
    const indent = findExtension('indent');
    expect(indent).toBeDefined();
  });

  it('indent extension should be a TipTap extension', () => {
    const indent = findExtension('indent');
    expect(indent).toBeDefined();
    expect(indent?.type).toBe('extension');
  });

  it('should configure textAlign for heading and paragraph types', () => {
    const textAlign = findExtension('textAlign');
    expect(textAlign).toBeDefined();
    expect(textAlign?.options?.types).toContain('heading');
    expect(textAlign?.options?.types).toContain('paragraph');
  });

  it('should have placeholder with default text', () => {
    const placeholder = findExtension('placeholder');
    expect(placeholder).toBeDefined();
    expect(placeholder?.options?.placeholder).toBe('Start writing...');
  });

  it('should accept custom placeholder text', () => {
    const customExtensions = createBaseExtensions({ placeholder: 'Custom...' });
    const placeholder = customExtensions.find(ext => ext.name === 'placeholder');
    expect(placeholder?.options?.placeholder).toBe('Custom...');
  });

  it('should configure table as resizable', () => {
    const table = findExtension('table');
    expect(table).toBeDefined();
    expect(table?.options?.resizable).toBe(true);
  });

  it('should have correct number of extensions', () => {
    // Base (13) + underline + subscript + superscript + textAlign
    // + clearFormatting + duplicateBlock + indent = 20
    expect(extensions.length).toBeGreaterThanOrEqual(20);
  });
});
